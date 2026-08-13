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
  resolvePrayerStatus,
  todayDateString,
  type PrayerSchedule,
} from '../utils/prayerUtils'

export type MissedAlert = { id: string; names: string[] }

/** Before Fajr, Isha on the Today list is last night's (yesterday's date). */
async function buildTodayDisplaySchedule(
  userId: string,
  now = new Date(),
): Promise<{ schedule: PrayerSchedule[]; prayerDates: Record<string, string> }> {
  const today = todayDateString(now)
  const baseSchedule = await getPrayerScheduleForToday()
  const prayerDates: Record<string, string> = {}
  for (const p of baseSchedule) prayerDates[p.key] = today

  const fajr = baseSchedule.find((p) => p.key === 'fajr')
  const beforeFajr = fajr ? now < fajr.startsAt : false

  if (!beforeFajr) {
    const records = await fetchTodayPrayerRecords(userId, today)
    return { schedule: mergeScheduleWithRecords(baseSchedule, records, now), prayerDates }
  }

  const yesterday = localDateString(addDays(parseLocalDate(today), -1))
  const [ySchedule, todayRecords, yRecords] = await Promise.all([
    getPrayerScheduleForDate(parseLocalDate(yesterday)),
    fetchTodayPrayerRecords(userId, today),
    fetchTodayPrayerRecords(userId, yesterday),
  ])
  const yIsha = ySchedule.find((p) => p.key === 'isha')
  if (!yIsha) {
    return { schedule: mergeScheduleWithRecords(baseSchedule, todayRecords, now), prayerDates }
  }

  prayerDates.isha = yesterday
  const schedule = baseSchedule
    .filter((p) => p.key !== 'isha')
    .concat([
      {
        ...yIsha,
        status: resolvePrayerStatus(yIsha, yRecords.get('isha'), now),
      },
    ])

  const merged = schedule.map((p) =>
    p.key === 'isha'
      ? p
      : { ...p, status: resolvePrayerStatus(p, todayRecords.get(p.key), now) },
  )

  return { schedule: merged, prayerDates }
}

export function useTodayPrayers(userId: string | undefined) {
  const [prayers, setPrayers] = useState<Prayer[]>([])
  const [schedule, setSchedule] = useState<PrayerSchedule[]>([])
  const [prayerDates, setPrayerDates] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [missedAlert, setMissedAlert] = useState<MissedAlert | null>(null)
  const recordsRef = useRef<Map<string, 'upcoming' | 'completed' | 'missed'>>(new Map())
  const scheduleRef = useRef<PrayerSchedule[]>([])
  const prayerDatesRef = useRef<Record<string, string>>({})
  const missTimersRef = useRef<number[]>([])

  const clearMissTimers = () => {
    for (const id of missTimersRef.current) window.clearTimeout(id)
    missTimersRef.current = []
  }

  const applyLocal = useCallback((merged: PrayerSchedule[], dates: Record<string, string>) => {
    scheduleRef.current = merged
    prayerDatesRef.current = dates
    setSchedule(merged)
    setPrayerDates(dates)
    setPrayers(merged.map(toListPrayer))
  }, [])

  const runMissCheck = useCallback(async (opts: { banner: boolean }) => {
    if (!userId) return 0
    const now = new Date()
    const newlyMissed = await reconcileMissedPrayers(userId, now)

    if (newlyMissed.length) {
      window.dispatchEvent(new Event('sabit-prayer-updated'))
    }

    const { schedule: display, prayerDates: dates } = await buildTodayDisplaySchedule(userId, now)
    const today = todayDateString(now)
    recordsRef.current = await fetchTodayPrayerRecords(userId, today)
    applyLocal(display, dates)

    if (newlyMissed.length && opts.banner) {
      const names = newlyMissed.filter((n) => n !== 'Qada')
      if (names.length) {
        setMissedAlert({
          id: `${Date.now()}-${names.join(',')}`,
          names,
        })
      }
    }

    return newlyMissed.length
  }, [userId, applyLocal])

  const scheduleMissTimers = useCallback(async () => {
    if (!userId) return
    clearMissTimers()
    const now = Date.now()
    const today = todayDateString()

    for (const p of scheduleRef.current) {
      const date = prayerDatesRef.current[p.key] ?? today
      const records = date === today
        ? recordsRef.current
        : await fetchTodayPrayerRecords(userId, date)

      const db = records.get(p.key)
      if (db === 'completed' || db === 'missed') continue

      const endDelay = p.endsAt.getTime() - now
      if (endDelay > 0 && endDelay <= MAX_PRAYER_WINDOW_MS) {
        missTimersRef.current.push(window.setTimeout(() => {
          runMissCheck({ banner: true })
        }, endDelay + 500))
      }
    }

    const yesterday = localDateString(addDays(parseLocalDate(today), -1))
    if (prayerDatesRef.current.isha === today) {
      const ySchedule = await getPrayerScheduleForDate(parseLocalDate(yesterday))
      const yIsha = ySchedule.find((s) => s.key === 'isha')
      if (yIsha) {
        const yRecords = await fetchTodayPrayerRecords(userId, yesterday)
        const db = yRecords.get('isha')
        if (db !== 'completed' && db !== 'missed') {
          const endDelay = yIsha.endsAt.getTime() - now
          if (endDelay > 0 && endDelay <= MAX_PRAYER_WINDOW_MS) {
            missTimersRef.current.push(window.setTimeout(() => {
              runMissCheck({ banner: true })
            }, endDelay + 500))
          }
        }
      }
    }
  }, [userId, runMissCheck])

  const reload = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const now = new Date()
      const today = todayDateString(now)
      const { schedule: display, prayerDates: dates } = await buildTodayDisplaySchedule(userId, now)
      recordsRef.current = await fetchTodayPrayerRecords(userId, today)
      applyLocal(display, dates)
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
      if (!userId) return
      buildTodayDisplaySchedule(userId).then(({ schedule: display, prayerDates: dates }) => {
        applyLocal(display, dates)
        runMissCheck({ banner: true }).then(() => scheduleMissTimers())
      })
    }, 60_000)
    return () => window.clearInterval(tick)
  }, [userId, applyLocal, runMissCheck, scheduleMissTimers])

  const completePrayer = useCallback(async (prayerKey: string) => {
    if (!userId) return false
    const p = scheduleRef.current.find((x) => x.key === prayerKey)
    if (!p) return false
    const date = prayerDatesRef.current[prayerKey] ?? todayDateString()
    await markPrayerCompleted(userId, p, date)
    if (date === todayDateString()) {
      recordsRef.current.set(prayerKey, 'completed')
    }
    const { schedule: display, prayerDates: dates } = await buildTodayDisplaySchedule(userId)
    applyLocal(display, dates)
    scheduleMissTimers()
    window.dispatchEvent(new Event('sabit-prayer-updated'))
    if (date !== todayDateString()) return false
    return tryIncrementStreakForToday(userId, date)
  }, [userId, applyLocal, scheduleMissTimers])

  const dismissMissedAlert = useCallback(() => setMissedAlert(null), [])

  return {
    prayers,
    schedule,
    prayerDates,
    loading,
    missedAlert,
    dismissMissedAlert,
    completePrayer,
    reload,
  }
}
