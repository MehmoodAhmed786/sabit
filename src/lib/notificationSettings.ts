import { supabase } from './supabaseClient'

export type NotificationSettings = {
  notifications_enabled: boolean
  email_notifications: boolean
  fajr_notifications: boolean
  dhuhr_notifications: boolean
  asr_notifications: boolean
  maghrib_notifications: boolean
  isha_notifications: boolean
  pre_prayer_enabled: boolean
  pre_prayer_minutes: number
  incomplete_prayer_enabled: boolean
  incomplete_prayer_delay_minutes: number
  daily_completion_enabled: boolean
  qada_notifications: boolean
  streak_notifications: boolean
  laqab_notifications: boolean
  challenge_notifications: boolean
  friend_request_notifications: boolean
  timezone: string | null
  /** @deprecated use incomplete_prayer_enabled — kept for DB compat */
  missed_prayer_notifications?: boolean
}

export const PRE_PRAYER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
] as const

export const INCOMPLETE_DELAY_OPTIONS = [
  { value: 30, label: '30 minutes after prayer time' },
  { value: 60, label: '1 hour after prayer time' },
  { value: 90, label: '90 minutes after prayer time' },
] as const

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notifications_enabled: true,
  email_notifications: false,
  fajr_notifications: true,
  dhuhr_notifications: true,
  asr_notifications: true,
  maghrib_notifications: true,
  isha_notifications: true,
  pre_prayer_enabled: false,
  pre_prayer_minutes: 10,
  incomplete_prayer_enabled: true,
  incomplete_prayer_delay_minutes: 60,
  daily_completion_enabled: true,
  qada_notifications: true,
  streak_notifications: true,
  laqab_notifications: true,
  challenge_notifications: true,
  friend_request_notifications: true,
  timezone: null,
}

export type NotificationToggleKey = Exclude<keyof NotificationSettings, 'pre_prayer_minutes' | 'incomplete_prayer_delay_minutes' | 'timezone' | 'missed_prayer_notifications'>

export const NOTIFICATION_TOGGLES: { key: NotificationToggleKey; label: string; hint?: string }[] = [
  { key: 'notifications_enabled', label: 'Master notifications', hint: 'Master switch for all reminders' },
  { key: 'email_notifications', label: 'Email notifications', hint: 'Send reminders to your email inbox' },
  { key: 'fajr_notifications', label: 'Fajr prayer reminder' },
  { key: 'dhuhr_notifications', label: 'Dhuhr prayer reminder' },
  { key: 'asr_notifications', label: 'Asr prayer reminder' },
  { key: 'maghrib_notifications', label: 'Maghrib prayer reminder' },
  { key: 'isha_notifications', label: 'Isha prayer reminder' },
  { key: 'pre_prayer_enabled', label: 'Pre-prayer reminder', hint: 'Notify before prayer time (see timing below)' },
  { key: 'incomplete_prayer_enabled', label: 'Incomplete prayer reminder', hint: 'Gentle reminder if a prayer is still open' },
  { key: 'daily_completion_enabled', label: 'Daily completion reminder', hint: 'Near end of day if prayers remain' },
  { key: 'qada_notifications', label: 'Qada reminder' },
  { key: 'streak_notifications', label: 'Streak reminder', hint: 'Encouragement when you have an active streak' },
  { key: 'laqab_notifications', label: 'Laqab progress reminder' },
  { key: 'challenge_notifications', label: 'Friend challenge notifications' },
  { key: 'friend_request_notifications', label: 'Friend request notifications' },
]

const PRAYER_SETTING_KEYS: Record<string, keyof NotificationSettings> = {
  fajr: 'fajr_notifications',
  dhuhr: 'dhuhr_notifications',
  asr: 'asr_notifications',
  maghrib: 'maghrib_notifications',
  isha: 'isha_notifications',
}

let cached: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS }
let cachedUserId: string | null = null

export function getNotificationSettings() {
  return cached
}

export function prayerSettingKey(prayerNameOrKey: string): keyof NotificationSettings {
  const key = prayerNameOrKey.toLowerCase()
  return PRAYER_SETTING_KEYS[key] ?? 'fajr_notifications'
}

export function isNotificationEnabled(settingKey: NotificationToggleKey) {
  if (!cached.notifications_enabled && settingKey !== 'notifications_enabled') return false
  return !!cached[settingKey as keyof NotificationSettings]
}

function normalizeSettings(raw: Record<string, unknown>): NotificationSettings {
  const tz = (raw.timezone as string) || getDeviceTimezone()
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...raw,
    timezone: tz,
    pre_prayer_minutes: Number(raw.pre_prayer_minutes ?? DEFAULT_NOTIFICATION_SETTINGS.pre_prayer_minutes),
    incomplete_prayer_delay_minutes: Number(raw.incomplete_prayer_delay_minutes ?? DEFAULT_NOTIFICATION_SETTINGS.incomplete_prayer_delay_minutes),
  } as NotificationSettings
}

export function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

export async function loadNotificationSettings(userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error && !error.message.includes('does not exist')) throw error

  cached = normalizeSettings((data ?? {}) as Record<string, unknown>)
  cachedUserId = userId
  return cached
}

export async function saveNotificationSettings(userId: string, patch: Partial<NotificationSettings>) {
  const merged = { ...cached, ...patch, timezone: patch.timezone ?? cached.timezone ?? getDeviceTimezone() }
  const payload = {
    user_id: userId,
    ...merged,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' })
  if (error) throw error

  cached = merged
  cachedUserId = userId
  return cached
}

export async function ensureNotificationSettings(userId: string) {
  if (cachedUserId === userId && cached) return cached
  return loadNotificationSettings(userId)
}

export type NotificationScheduleStatus = {
  scheduled: number
  lastError: string | null
  lastScheduledAt: string | null
}

let scheduleStatus: NotificationScheduleStatus = { scheduled: 0, lastError: null, lastScheduledAt: null }

export function getNotificationScheduleStatus() {
  return scheduleStatus
}

export function setNotificationScheduleStatus(patch: Partial<NotificationScheduleStatus>) {
  scheduleStatus = { ...scheduleStatus, ...patch }
}
