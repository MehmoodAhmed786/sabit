import { supabase } from './supabaseClient'
import {
  type PrayerSchedule,
  type PrayerStatus,
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
export async function markPrayerMissed(
  userId: string,
  prayer: PrayerSchedule,
  date = todayDateString(),
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('prayer_records')
    .select('status')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('prayer_name', prayer.key)
    .maybeSingle()

  if (existing?.status === 'completed' || existing?.status === 'missed') return false

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

  const { data: recordRow } = await supabase
    .from('prayer_records')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('prayer_name', prayer.key)
    .single()

  const { error: qError } = await supabase.from('qada_records').upsert(
    {
      user_id: userId,
      original_prayer_record_id: recordRow?.id ?? null,
      original_date: date,
      prayer_name: prayer.key,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,original_date,prayer_name' },
  )
  if (qError) throw qError

  return true
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

export function toListPrayer(p: PrayerSchedule) {
  return {
    key: p.key,
    name: p.name,
    time: p.time,
    status: p.status as PrayerStatus,
  }
}
