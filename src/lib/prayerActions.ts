import { supabase } from './supabaseClient'
import { notifyLaqabUnlocked } from './notifications'
import { tryIncrementStreakForToday } from './streaks'
import {
  getPrayerScheduleForDate,
  parseLocalDate,
  resolvePrayerStatus,
  todayDateString,
  toDisplayPrayerName,
  type PrayerSchedule,
} from '../utils/prayerUtils'

export type PrayerDisplayStatus = 'upcoming' | 'current' | 'completed' | 'missed' | 'made_up'

export type PrayerDetail = {
  recordId: string | null
  prayerKey: string
  prayerName: string
  date: string
  dateLabel: string
  dayLabel: string
  time: string
  startsAt: Date
  endsAt: Date
  status: PrayerDisplayStatus
  dbStatus: 'upcoming' | 'completed' | 'missed' | null
  completedAt: string | null
  isToday: boolean
  isFuture: boolean
  canMarkCompleted: boolean
  canMarkMissed: boolean
  canChangeStatus: boolean
  qada: {
    id: string
    status: 'pending' | 'made_up'
    madeUpAt: string | null
    originalDate: string
  } | null
}

export type LaqabUnlock = { id: string; name: string; requirement_days: number; meaning?: string }

function formatDateLabel(dateStr: string) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDayLabel(dateStr: string) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: 'long' })
}

function deriveDisplayStatus(
  dbStatus: string | null | undefined,
  qadaStatus: 'pending' | 'made_up' | null,
  liveStatus: ReturnType<typeof resolvePrayerStatus>,
): PrayerDisplayStatus {
  if (qadaStatus === 'made_up') return 'made_up'
  if (dbStatus === 'completed') return 'completed'
  if (dbStatus === 'missed') return 'missed'
  return liveStatus
}

export async function loadPrayerDetail(
  userId: string,
  date: string,
  prayerKey: string,
): Promise<PrayerDetail | null> {
  const schedule = await getPrayerScheduleForDate(parseLocalDate(date))
  const slot = schedule.find((p) => p.key === prayerKey.toLowerCase())
  if (!slot) return null

  const [{ data: record }, { data: qada }] = await Promise.all([
    supabase
      .from('prayer_records')
      .select('id,status,completed_at,scheduled_time')
      .eq('user_id', userId)
      .eq('date', date)
      .eq('prayer_name', prayerKey.toLowerCase())
      .maybeSingle(),
    supabase
      .from('qada_records')
      .select('id,status,made_up_at,original_date')
      .eq('user_id', userId)
      .eq('original_date', date)
      .eq('prayer_name', prayerKey.toLowerCase())
      .maybeSingle(),
  ])

  const now = new Date()
  const today = todayDateString()
  const isToday = date === today
  const isFuture = date > today
  const dbStatus = (record?.status as PrayerDetail['dbStatus']) ?? null
  const qadaStatus = (qada?.status as 'pending' | 'made_up') ?? null
  const liveStatus = resolvePrayerStatus(slot, dbStatus ?? undefined, isToday ? now : parseLocalDate(date))
  const status = deriveDisplayStatus(dbStatus, qadaStatus, liveStatus)

  const canMarkCompleted =
    !isFuture &&
    status !== 'completed' &&
    status !== 'made_up' &&
    (isToday ? now >= slot.startsAt : true)

  const canMarkMissed =
    !isFuture &&
    status !== 'missed' &&
    status !== 'made_up' &&
    status !== 'completed'

  const canChangeStatus = !isFuture && status === 'missed'

  return {
    recordId: record?.id ?? null,
    prayerKey: slot.key,
    prayerName: slot.name,
    date,
    dateLabel: formatDateLabel(date),
    dayLabel: formatDayLabel(date),
    time: slot.time,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    status,
    dbStatus,
    completedAt: record?.completed_at ?? null,
    isToday,
    isFuture,
    canMarkCompleted,
    canMarkMissed,
    canChangeStatus,
    qada: qada
      ? {
          id: qada.id,
          status: qada.status as 'pending' | 'made_up',
          madeUpAt: qada.made_up_at,
          originalDate: qada.original_date,
        }
      : null,
  }
}

async function upsertPrayerRecord(
  userId: string,
  slot: PrayerSchedule,
  date: string,
  patch: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from('prayer_records')
    .upsert(
      {
        user_id: userId,
        date,
        prayer_name: slot.key,
        scheduled_time: slot.startsAt.toISOString(),
        updated_at: new Date().toISOString(),
        ...patch,
      },
      { onConflict: 'user_id,date,prayer_name' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function checkLaqabUnlock(userId: string): Promise<LaqabUnlock | null> {
  const [{ data: streak }, { data: laqabs }, { data: unlocked }] = await Promise.all([
    supabase.from('streaks').select('current_streak').eq('user_id', userId).maybeSingle(),
    supabase.from('laqabs').select('id,name,meaning,requirement_days').order('requirement_days'),
    supabase.from('user_laqabs').select('laqab_id').eq('user_id', userId),
  ])
  const current = streak?.current_streak ?? 0
  const have = new Set((unlocked ?? []).map((u) => u.laqab_id))
  const next = (laqabs ?? []).find((l) => !have.has(l.id) && current >= l.requirement_days)
  if (!next) return null
  const { error } = await supabase.from('user_laqabs').insert({ user_id: userId, laqab_id: next.id })
  if (error) return null
  notifyLaqabUnlocked(next.name, next.requirement_days)
  return next
}

export function emitPrayerUpdated() {
  window.dispatchEvent(new Event('sabit-prayer-updated'))
}

export async function markPrayerCompletedAction(
  userId: string,
  date: string,
  prayerKey: string,
): Promise<{ streakIncremented: boolean; laqab: LaqabUnlock | null }> {
  const schedule = await getPrayerScheduleForDate(parseLocalDate(date))
  const slot = schedule.find((p) => p.key === prayerKey.toLowerCase())
  if (!slot) throw new Error('Prayer not found')

  await upsertPrayerRecord(userId, slot, date, {
    status: 'completed',
    completed_at: new Date().toISOString(),
  })

  const { data: qada } = await supabase
    .from('qada_records')
    .select('id,status')
    .eq('user_id', userId)
    .eq('original_date', date)
    .eq('prayer_name', slot.key)
    .maybeSingle()

  if (qada?.status === 'pending') {
    await supabase.from('qada_records').delete().eq('id', qada.id)
  }

  let streakIncremented = false
  if (date === todayDateString()) {
    streakIncremented = await tryIncrementStreakForToday(userId, date)
  }

  const laqab = streakIncremented ? await checkLaqabUnlock(userId) : null
  emitPrayerUpdated()
  return { streakIncremented, laqab }
}

export async function markPrayerMissedAction(userId: string, date: string, prayerKey: string) {
  const schedule = await getPrayerScheduleForDate(parseLocalDate(date))
  const slot = schedule.find((p) => p.key === prayerKey.toLowerCase())
  if (!slot) throw new Error('Prayer not found')

  const recordId = await upsertPrayerRecord(userId, slot, date, { status: 'missed', completed_at: null })

  const { error: qError } = await supabase.from('qada_records').upsert(
    {
      user_id: userId,
      original_prayer_record_id: recordId,
      original_date: date,
      prayer_name: slot.key,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,original_date,prayer_name' },
  )
  if (qError) throw qError

  emitPrayerUpdated()
}

export async function changePrayerStatusAction(
  userId: string,
  date: string,
  prayerKey: string,
  newStatus: 'completed' | 'missed',
) {
  if (newStatus === 'completed') {
    return markPrayerCompletedAction(userId, date, prayerKey)
  }
  await markPrayerMissedAction(userId, date, prayerKey)
  return { streakIncremented: false, laqab: null }
}

export { toDisplayPrayerName }
