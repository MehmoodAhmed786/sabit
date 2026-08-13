import { useCallback, useEffect, useRef, useState } from 'react'
import type { Prayer } from '../components/PrayerList'
import {
  fetchTodayPrayerRecords,
  markPrayerCompleted,
  markPrayerMissed,
  mergeScheduleWithRecords,
  prayersNeedingMissCheck,
  toListPrayer,
} from '../lib/prayerTracking'
import { tryIncrementStreakForToday } from '../lib/streaks'
import { getPrayerScheduleForToday, todayDateString, type PrayerSchedule } from '../utils/prayerUtils'

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

  const runMissCheck = useCallback(async (opts: { notify: boolean; banner: boolean }) => {
    if (!userId) return 0
    const now = new Date()
    const merged = mergeScheduleWithRecords(scheduleRef.current, recordsRef.current, now)
    const toMiss = prayersNeedingMissCheck(merged, recordsRef.current, now)
    const newlyMissed: string[] = []

    for (const p of toMiss) {
      try {
        const isNew = await markPrayerMissed(userId, p)
        if (isNew) {
          recordsRef.current.set(p.key, 'missed')
          newlyMissed.push(p.name)
        }
      } catch (e) {
        console.error('auto-miss failed', p.key, e)
      }
    }

    if (newlyMissed.length) {
      const refreshed = mergeScheduleWithRecords(scheduleRef.current, recordsRef.current, now)
      applyLocal(refreshed)
      if (opts.banner) {
        setMissedAlert({
          id: `${Date.now()}-${newlyMissed.join(',')}`,
          names: newlyMissed,
        })
      }
    } else {
      applyLocal(merged)
    }

    return newlyMissed.length
  }, [userId, applyLocal])

  const scheduleMissTimers = useCallback(() => {
    clearMissTimers()
    const now = Date.now()
    for (const p of scheduleRef.current) {
      const db = recordsRef.current.get(p.key)
      if (db !== 'completed' && db !== 'missed') {
        const endDelay = p.endsAt.getTime() - now
        if (endDelay > 0 && endDelay <= 24 * 60 * 60 * 1000) {
          missTimersRef.current.push(window.setTimeout(() => {
            runMissCheck({ notify: false, banner: true })
          }, endDelay + 500))
        }
      }
    }
  }, [runMissCheck])

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
      await runMissCheck({ notify: false, banner: true })
      scheduleMissTimers()
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
      runMissCheck({ notify: false, banner: true }).then(() => scheduleMissTimers())
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
