import { supabase } from './supabaseClient'
import {
  getNotificationSettings,
  isNotificationEnabled,
  prayerSettingKey,
  setNotificationScheduleStatus,
} from './notificationSettings'
import {
  notifyChallengeEnding,
  notifyChallengeStarting,
  notifyDailyCompletionRemaining,
  notifyIncompletePrayer,
  notifyLaqabProgress,
  notifyPrePrayer,
  notifyPrayerTimeArrived,
  notifyQadaRemaining,
  notifyStreakAlmostComplete,
  notifyStreakReminder,
} from './notifications'
import { fetchTodayPrayerRecords } from './prayerTracking'
import { getCurrentStreak } from './streaks'
import { getPrayerScheduleForToday, PRAYER_KEYS, todayDateString, type PrayerSchedule } from '../utils/prayerUtils'

const MAX_DELAY_MS = 48 * 60 * 60 * 1000

class NotificationScheduler {
  private timers = new Map<string, number>()
  private dateKey = todayDateString()

  cancelAll() {
    for (const id of this.timers.values()) window.clearTimeout(id)
    this.timers.clear()
    setNotificationScheduleStatus({ scheduled: 0 })
  }

  private schedule(id: string, fireAt: Date, fn: () => void | Promise<void>) {
    const existing = this.timers.get(id)
    if (existing !== undefined) window.clearTimeout(existing)

    const delay = fireAt.getTime() - Date.now()
    if (delay <= 0 || delay > MAX_DELAY_MS) return

    const timerId = window.setTimeout(() => {
      this.timers.delete(id)
      void Promise.resolve(fn())
    }, delay + 300)

    this.timers.set(id, timerId)
  }

  private scheduleMidnightRefresh(onRefresh: () => void) {
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    this.schedule('__midnight_refresh__', midnight, () => {
      this.dateKey = todayDateString()
      onRefresh()
    })
  }

  private isPrayerEnabled(prayerKey: string) {
    const settings = getNotificationSettings()
    if (!settings.notifications_enabled) return false
    return !!settings[prayerSettingKey(prayerKey)]
  }

  private schedulePrayerNotifications(schedule: PrayerSchedule[], date: string, userId: string) {
    const settings = getNotificationSettings()

    for (const p of schedule) {
      if (!this.isPrayerEnabled(p.key)) continue

      this.schedule(`prayer-${p.key}-${date}`, p.startsAt, async () => {
        const records = await fetchTodayPrayerRecords(userId, date)
        const status = records.get(p.key)
        if (status === 'completed' || status === 'missed') return
        notifyPrayerTimeArrived(p.name, p.key)
      })

      if (settings.pre_prayer_enabled && settings.pre_prayer_minutes > 0) {
        const preAt = new Date(p.startsAt.getTime() - settings.pre_prayer_minutes * 60_000)
        this.schedule(`pre-${p.key}-${date}`, preAt, async () => {
          const records = await fetchTodayPrayerRecords(userId, date)
          const status = records.get(p.key)
          if (status === 'completed' || status === 'missed') return
          notifyPrePrayer(p.name, p.key, settings.pre_prayer_minutes)
        })
      }

      if (settings.incomplete_prayer_enabled) {
        const incAt = new Date(p.startsAt.getTime() + settings.incomplete_prayer_delay_minutes * 60_000)
        if (incAt < p.endsAt) {
          this.schedule(`incomplete-${p.key}-${date}`, incAt, async () => {
            const records = await fetchTodayPrayerRecords(userId, date)
            if (records.get(p.key) === 'completed') return
            notifyIncompletePrayer(p.name, p.key)
          })
        }
      }
    }
  }

  private scheduleDailyCompletion(schedule: PrayerSchedule[], date: string, userId: string) {
    if (!isNotificationEnabled('daily_completion_enabled')) return
    const isha = schedule.find((p) => p.key === 'isha')
    if (!isha) return

    const remindAt = new Date(isha.endsAt.getTime() - 2 * 60 * 60 * 1000)
    this.schedule(`daily-completion-${date}`, remindAt, async () => {
      const records = await fetchTodayPrayerRecords(userId, date)
      const completed = PRAYER_KEYS.filter((k) => records.get(k) === 'completed').length
      if (completed >= 5) return
      notifyDailyCompletionRemaining(5 - completed)
    })
  }

  private scheduleStreakReminder(schedule: PrayerSchedule[], date: string, userId: string) {
    if (!isNotificationEnabled('streak_notifications')) return
    const maghrib = schedule.find((p) => p.key === 'maghrib')
    if (!maghrib) return

    this.schedule(`streak-${date}`, maghrib.startsAt, async () => {
      const streak = await getCurrentStreak(userId)
      if (streak <= 0) return
      const records = await fetchTodayPrayerRecords(userId, date)
      const completed = PRAYER_KEYS.filter((k) => records.get(k) === 'completed').length
      if (completed >= 5) return
      if (completed === 4) notifyStreakAlmostComplete(streak)
      else notifyStreakReminder(streak)
    })
  }

  private scheduleLaqabReminder(schedule: PrayerSchedule[], date: string, userId: string) {
    if (!isNotificationEnabled('laqab_notifications')) return
    const dhuhr = schedule.find((p) => p.key === 'dhuhr')
    if (!dhuhr) return

    this.schedule(`laqab-${date}`, dhuhr.startsAt, async () => {
      const [{ data: streakRow }, { data: laqabs }, { data: unlocked }] = await Promise.all([
        supabase.from('streaks').select('current_streak').eq('user_id', userId).maybeSingle(),
        supabase.from('laqabs').select('id,name,requirement_days').order('requirement_days'),
        supabase.from('user_laqabs').select('laqab_id').eq('user_id', userId),
      ])
      const current = streakRow?.current_streak ?? 0
      const have = new Set((unlocked ?? []).map((u) => u.laqab_id))
      const next = (laqabs ?? []).find((l) => !have.has(l.id))
      if (!next) return
      const remaining = next.requirement_days - current
      if (remaining <= 0) return
      notifyLaqabProgress(next.name, remaining)
    })
  }

  private scheduleQadaReminder(schedule: PrayerSchedule[], date: string, userId: string) {
    if (!isNotificationEnabled('qada_notifications')) return
    const fajr = schedule.find((p) => p.key === 'fajr')
    if (!fajr) return

    const remindAt = new Date(fajr.startsAt.getTime() + 30 * 60_000)
    this.schedule(`qada-${date}`, remindAt, async () => {
      const { count } = await supabase
        .from('qada_records')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending')
      if (!count || count <= 0) return
      notifyQadaRemaining(count)
    })
  }

  private async scheduleChallengeNotifications(userId: string, date: string) {
    if (!isNotificationEnabled('challenge_notifications')) return

    const { data: memberships } = await supabase
      .from('challenge_members')
      .select('challenge_id, status')
      .eq('user_id', userId)
      .eq('status', 'accepted')

    const ids = (memberships ?? []).map((m) => m.challenge_id)
    if (!ids.length) return

    const { data: challenges } = await supabase
      .from('friend_challenges')
      .select('id, name, start_date, end_date, status')
      .in('id', ids)
      .in('status', ['pending', 'active'])

    const tomorrow = new Date(date + 'T00:00:00')
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)

    for (const c of challenges ?? []) {
      if (c.start_date === date) {
        const fireAt = new Date(date + 'T08:00:00')
        this.schedule(`challenge-start-${c.id}-${date}`, fireAt, () => {
          notifyChallengeStarting(c.name, c.id)
        })
      }
      if (c.end_date === tomorrowStr) {
        const fireAt = new Date(date + 'T18:00:00')
        this.schedule(`challenge-end-${c.id}-${date}`, fireAt, () => {
          notifyChallengeEnding(c.name, c.id)
        })
      }
    }
  }

  async refresh(userId: string, onMidnight?: () => void) {
    this.cancelAll()
    this.dateKey = todayDateString()

    try {
      const settings = getNotificationSettings()
      if (!settings.notifications_enabled) {
        setNotificationScheduleStatus({ lastError: null, lastScheduledAt: new Date().toISOString() })
        return
      }

      const date = this.dateKey
      const [schedule, records] = await Promise.all([
        getPrayerScheduleForToday(),
        fetchTodayPrayerRecords(userId, date),
      ])

      void records // used by per-prayer callbacks at fire time

      this.schedulePrayerNotifications(schedule, date, userId)
      this.scheduleDailyCompletion(schedule, date, userId)
      this.scheduleStreakReminder(schedule, date, userId)
      this.scheduleLaqabReminder(schedule, date, userId)
      this.scheduleQadaReminder(schedule, date, userId)
      await this.scheduleChallengeNotifications(userId, date)

      this.scheduleMidnightRefresh(() => {
        if (onMidnight) onMidnight()
        else void this.refresh(userId, onMidnight)
      })

      setNotificationScheduleStatus({
        scheduled: this.timers.size,
        lastError: null,
        lastScheduledAt: new Date().toISOString(),
      })
    } catch (e: any) {
      setNotificationScheduleStatus({
        scheduled: 0,
        lastError: e.message || String(e),
        lastScheduledAt: new Date().toISOString(),
      })
      throw e
    }
  }

  stop() {
    this.cancelAll()
  }
}

export const notificationScheduler = new NotificationScheduler()
