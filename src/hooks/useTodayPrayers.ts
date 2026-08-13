import { useCallback, useEffect, useRef, useState } from 'react'
import type { Prayer } from '../components/PrayerList'
import {
  fetchTodayPrayerRecords,
  markPrayerCompleted,
  mergeScheduleWithRecords,
  MAX_PRAYER_WINDOW_MS,
  reconcileMissedPrayers,
  toListPrayer,
} from '../lib/prayerTracking'
import { tryIncrementStreakForToday } from '../lib/streaks'
import {
  addDays,
  getPrayerScheduleForDate,
  getPrayerScheduleForToday,
  localDateString,
  parseLocalDate,
  todayDateString,
  type PrayerSchedule,
} from '../utils/prayerUtils'

export type MissedAlert = { id: string; names: string[] }

export function useTodayPrayers(userId: string | undefined) {
  const [prayers, setPrayers] = useState<Prayer[]>([])
  const [schedule, setSchedule] = useState<PrayerSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [missedAlert, setMissedAlert] = useState<MissedAlert | null>(null)
  const recordsRef = useRef<Map<string, 'upcoming' | 'completed' | 'missed'>>(new Map())
  const scheduleRef = useRef<PrayerSchedule[]>([])
  const missTimersRef = useRef<number[]>([])

  const clearMissTimers = () => {
    for (const id of missTimersRef.current) window.clearTimeout(id)
    missTimersRef.current = []
  }

  const applyLocal = useCallback((merged: PrayerSchedule[]) => {
    scheduleRef.current = merged
    setSchedule(merged)
    setPrayers(merged.map(toListPrayer))
  }, [])

  const runMissCheck = useCallback(async (opts: { banner: boolean }) => {
    if (!userId) return 0
    const now = new Date()
    const newlyMissed = await reconcileMissedPrayers(userId, now)

    if (newlyMissed.length) {
      window.dispatchEvent(new Event('sabit-prayer-updated'))
    }

    const date = todayDateString(now)
    recordsRef.current = await fetchTodayPrayerRecords(userId, date)
    const merged = mergeScheduleWithRecords(scheduleRef.current, recordsRef.current, now)
    applyLocal(merged)

    if (newlyMissed.length && opts.banner) {
      setMissedAlert({
        id: `${Date.now()}-${newlyMissed.join(',')}`,
        names: newlyMissed,
      })
    }

    return newlyMissed.length
  }, [userId, applyLocal])

  const scheduleMissTimers = useCallback(async () => {
    if (!userId) return
    clearMissTimers()
    const now = Date.now()
    const today = todayDateString()
    const yesterday = localDateString(addDays(parseLocalDate(today), -1))

    const schedules: { date: string; slots: PrayerSchedule[] }[] = [
      { date: today, slots: scheduleRef.current },
      { date: yesterday, slots: await getPrayerScheduleForDate(parseLocalDate(yesterday)) },
    ]

    for (const { date, slots } of schedules) {
      const records = date === today
        ? recordsRef.current
        : await fetchTodayPrayerRecords(userId, date)

      for (const p of slots) {
        if (date === yesterday && p.key !== 'isha') continue

        const db = records.get(p.key)
        if (db === 'completed' || db === 'missed') continue

        const endDelay = p.endsAt.getTime() - now
        if (endDelay > 0 && endDelay <= MAX_PRAYER_WINDOW_MS) {
          missTimersRef.current.push(window.setTimeout(() => {
            runMissCheck({ banner: true })
          }, endDelay + 500))
        }
      }
    }

    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const midnightDelay = midnight.getTime() - now
    if (midnightDelay > 0 && midnightDelay <= MAX_PRAYER_WINDOW_MS) {
      missTimersRef.current.push(window.setTimeout(() => {
        runMissCheck({ banner: true })
      }, midnightDelay + 500))
    }
  }, [userId, runMissCheck])

  const reload = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const date = todayDateString()
      const [baseSchedule, records] = await Promise.all([
        getPrayerScheduleForToday(),
        fetchTodayPrayerRecords(userId, date),
      ])
      recordsRef.current = records
      scheduleRef.current = baseSchedule
      const merged = mergeScheduleWithRecords(baseSchedule, records)
      applyLocal(merged)
      await runMissCheck({ banner: true })
      await scheduleMissTimers()
    } catch (e) {
      console.error('load prayers failed', e)
    } finally {
      setLoading(false)
    }
  }, [userId, applyLocal, runMissCheck, scheduleMissTimers])

  useEffect(() => {
    reload()
    const onSettingsUpdated = () => { reload() }
    const onPrayerUpdated = () => { reload() }
    window.addEventListener('sabit-notifications-updated', onSettingsUpdated)
    window.addEventListener('sabit-prayer-updated', onPrayerUpdated)
    return () => {
      clearMissTimers()
      window.removeEventListener('sabit-notifications-updated', onSettingsUpdated)
      window.removeEventListener('sabit-prayer-updated', onPrayerUpdated)
    }
  }, [reload])

  useEffect(() => {
    const tick = window.setInterval(() => {
      const merged = mergeScheduleWithRecords(scheduleRef.current, recordsRef.current)
      applyLocal(merged)
      runMissCheck({ banner: true }).then(() => scheduleMissTimers())
    }, 60_000)
    return () => window.clearInterval(tick)
  }, [applyLocal, runMissCheck, scheduleMissTimers])

  const completePrayer = useCallback(async (prayerKey: string) => {
    if (!userId) return false
    const p = scheduleRef.current.find((x) => x.key === prayerKey)
    if (!p) return false
    await markPrayerCompleted(userId, p)
    recordsRef.current.set(prayerKey, 'completed')
    const merged = mergeScheduleWithRecords(scheduleRef.current, recordsRef.current)
    applyLocal(merged)
    scheduleMissTimers()
    window.dispatchEvent(new Event('sabit-prayer-updated'))
    return tryIncrementStreakForToday(userId, todayDateString())
  }, [userId, applyLocal, scheduleMissTimers])

  const dismissMissedAlert = useCallback(() => setMissedAlert(null), [])

  return {
    prayers,
    schedule,
    loading,
    missedAlert,
    dismissMissedAlert,
    completePrayer,
    reload,
  }
}
