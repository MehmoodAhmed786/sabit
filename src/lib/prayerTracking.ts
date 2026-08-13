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

/** Isha ends at next Fajr — reconcile recent days so missed Isha reaches Qada. */
const RECONCILE_LOOKBACK_DAYS = 7

export async function reconcileMissedPrayers(userId: string, now = new Date()): Promise<string[]> {
  const newlyMissed: string[] = []
  const today = parseLocalDate(todayDateString(now))
  const datesToCheck = new Set<string>()

  for (let i = RECONCILE_LOOKBACK_DAYS; i >= 0; i--) {
    datesToCheck.add(localDateString(addDays(today, -i)))
  }

  for (const dateStr of datesToCheck) {
    const schedule = await getPrayerScheduleForDate(parseLocalDate(dateStr))
    const records = await fetchTodayPrayerRecords(userId, dateStr)
    const toMiss = prayersNeedingMissCheck(schedule, records, now)

    for (const p of toMiss) {
      try {
        const isNew = await markPrayerMissed(userId, p, dateStr)
        if (isNew) newlyMissed.push(p.name)
      } catch (e) {
        console.error('reconcile miss failed', dateStr, p.key, e)
      }
    }
  }

  const repaired = await backfillQadaFromMissedRecords(userId)
  if (repaired > 0 && newlyMissed.length === 0) {
    newlyMissed.push('Qada')
  }

  return newlyMissed
}

/** Max ms until next Fajr after Isha — allow overnight timer (Isha → Fajr). */
export const MAX_PRAYER_WINDOW_MS = 36 * 60 * 60 * 1000

export function toListPrayer(p: PrayerSchedule) {
  return {
    key: p.key,
    name: p.name,
    time: p.time,
    status: p.status as PrayerStatus,
  }
}
