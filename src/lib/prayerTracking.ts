import { supabase } from './supabaseClient'
import {
  type PrayerSchedule,
  type PrayerStatus,
  addDays,
  getPrayerScheduleForDate,
  localDateString,
  parseLocalDate,
  resolvePrayerStatus,
  todayDateString,
} from '../utils/prayerUtils'

export type DbPrayerStatus = 'upcoming' | 'completed' | 'missed'

export async function fetchTodayPrayerRecords(userId: string, date = todayDateString()) {
  const { data, error } = await supabase
    .from('prayer_records')
    .select('prayer_name, status')
    .eq('user_id', userId)
    .eq('date', date)
  if (error) throw error
  const map = new Map<string, DbPrayerStatus>()
  for (const row of data ?? []) {
    map.set(row.prayer_name.toLowerCase(), row.status as DbPrayerStatus)
  }
  return map
}

export function mergeScheduleWithRecords(
  schedule: PrayerSchedule[],
  records: Map<string, DbPrayerStatus>,
  now = new Date(),
): PrayerSchedule[] {
  return schedule.map((p) => ({
    ...p,
    status: resolvePrayerStatus(p, records.get(p.key), now),
  }))
}

export async function markPrayerCompleted(
  userId: string,
  prayer: PrayerSchedule,
  date = todayDateString(),
) {
  const { error } = await supabase.from('prayer_records').upsert(
    {
      user_id: userId,
      date,
      prayer_name: prayer.key,
      scheduled_time: prayer.startsAt.toISOString(),
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,date,prayer_name' },
  )
  if (error) throw error
}

/** Returns true if this call newly marked the prayer missed (not already completed/missed). */
async function upsertQadaRecord(
  userId: string,
  date: string,
  prayerKey: string,
  recordId: string | null,
) {
  const { error } = await supabase.from('qada_records').upsert(
    {
      user_id: userId,
      original_prayer_record_id: recordId,
      original_date: date,
      prayer_name: prayerKey,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,original_date,prayer_name' },
  )
  if (error) throw error
}

export async function markPrayerMissed(
  userId: string,
  prayer: PrayerSchedule,
  date = todayDateString(),
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('prayer_records')
    .select('id, status')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('prayer_name', prayer.key)
    .maybeSingle()

  if (existing?.status === 'completed') return false

  const wasAlreadyMissed = existing?.status === 'missed'

  if (!wasAlreadyMissed) {
    const { error: prError } = await supabase.from('prayer_records').upsert(
      {
        user_id: userId,
        date,
        prayer_name: prayer.key,
        scheduled_time: prayer.startsAt.toISOString(),
        status: 'missed',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date,prayer_name' },
    )
    if (prError) throw prError
  }

  let recordId = existing?.id ?? null
  if (!recordId) {
    const { data: recordRow } = await supabase
      .from('prayer_records')
      .select('id')
      .eq('user_id', userId)
      .eq('date', date)
      .eq('prayer_name', prayer.key)
      .maybeSingle()
    recordId = recordRow?.id ?? null
  }

  await upsertQadaRecord(userId, date, prayer.key, recordId)

  return !wasAlreadyMissed
}

/** Repair qada rows for prayers already marked missed in prayer_records. */
export async function backfillQadaFromMissedRecords(userId: string): Promise<number> {
  const { data: missed, error } = await supabase
    .from('prayer_records')
    .select('id, date, prayer_name')
    .eq('user_id', userId)
    .eq('status', 'missed')
  if (error) throw error

  let repaired = 0
  for (const row of missed ?? []) {
    const { data: qada } = await supabase
      .from('qada_records')
      .select('id')
      .eq('user_id', userId)
      .eq('original_date', row.date)
      .eq('prayer_name', row.prayer_name)
      .maybeSingle()
    if (qada) continue

    try {
      await upsertQadaRecord(userId, row.date, row.prayer_name, row.id)
      repaired++
    } catch (e) {
      console.error('qada backfill failed', row.date, row.prayer_name, e)
    }
  }
  return repaired
}

export function prayersNeedingMissCheck(
  schedule: PrayerSchedule[],
  records: Map<string, DbPrayerStatus>,
  now = new Date(),
): PrayerSchedule[] {
  return schedule.filter((p) => {
    const db = records.get(p.key)
    if (db === 'completed' || db === 'missed') return false
    return now >= p.endsAt
  })
}

/** Remove bulk auto-misses from the old 7-day reconcile (days before yesterday only). */
export async function cleanupBulkAutoMisses(userId: string, now = new Date()): Promise<number> {
  const todayStr = todayDateString(now)
  const yesterdayStr = localDateString(addDays(parseLocalDate(todayStr), -1))

  const { data: missed, error } = await supabase
    .from('prayer_records')
    .select('id, date, prayer_name')
    .eq('user_id', userId)
    .eq('status', 'missed')
  if (error) throw error

  let removed = 0
  for (const row of missed ?? []) {
    const dateStr = String(row.date)
    if (dateStr >= yesterdayStr) continue

    await supabase
      .from('qada_records')
      .delete()
      .eq('user_id', userId)
      .eq('original_date', dateStr)
      .eq('prayer_name', row.prayer_name)
      .eq('status', 'pending')

    await supabase.from('prayer_records').delete().eq('id', row.id)
    removed++
  }
  return removed
}

/**
 * Auto-miss:
 * - Today: prayers whose window has ended
 * - Yesterday: Isha only (window ends at midnight when the Today screen rolls to a new day)
 */
export async function reconcileMissedPrayers(userId: string, now = new Date()): Promise<string[]> {
  const newlyMissed: string[] = []
  const todayStr = todayDateString(now)
  const yesterdayStr = localDateString(addDays(parseLocalDate(todayStr), -1))

  await cleanupBulkAutoMisses(userId, now)

  const todaySchedule = await getPrayerScheduleForDate(parseLocalDate(todayStr))
  const todayRecords = await fetchTodayPrayerRecords(userId, todayStr)
  for (const p of prayersNeedingMissCheck(todaySchedule, todayRecords, now)) {
    try {
      const isNew = await markPrayerMissed(userId, p, todayStr)
      if (isNew) newlyMissed.push(p.name)
    } catch (e) {
      console.error('reconcile miss failed', todayStr, p.key, e)
    }
  }

  const ySchedule = await getPrayerScheduleForDate(parseLocalDate(yesterdayStr))
  const yIsha = ySchedule.find((p) => p.key === 'isha')
  if (yIsha) {
    const yRecords = await fetchTodayPrayerRecords(userId, yesterdayStr)
    if (prayersNeedingMissCheck([yIsha], yRecords, now).length) {
      try {
        const isNew = await markPrayerMissed(userId, yIsha, yesterdayStr)
        if (isNew) newlyMissed.push(yIsha.name)
      } catch (e) {
        console.error('reconcile miss failed', yesterdayStr, 'isha', e)
      }
    }
  }

  await backfillQadaFromMissedRecords(userId)

  return newlyMissed
}

/** Max ms for a prayer miss timer (Isha → midnight is the longest same-day window). */
export const MAX_PRAYER_WINDOW_MS = 36 * 60 * 60 * 1000

export function toListPrayer(p: PrayerSchedule) {
  return {
    key: p.key,
    name: p.name,
    time: p.time,
    status: p.status as PrayerStatus,
  }
}
