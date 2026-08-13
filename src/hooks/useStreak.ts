import { useCallback, useEffect, useRef, useState } from 'react'
import { getPrayerScheduleForToday } from '../utils/prayerUtils'
import { getCurrentStreak, reconcileStreak } from '../lib/streaks'

export function useStreak(userId: string | undefined) {
  const [streak, setStreak] = useState(0)
  const fajrTimerRef = useRef<number | null>(null)

  const refreshStreak = useCallback(async () => {
    if (!userId) return 0
    const result = await reconcileStreak(userId)
    void result
    const current = await getCurrentStreak(userId)
    setStreak(current)
    return current
  }, [userId])

  const scheduleFajrCheck = useCallback(async () => {
    if (fajrTimerRef.current) window.clearTimeout(fajrTimerRef.current)
    const schedule = await getPrayerScheduleForToday()
    const fajr = schedule.find((p) => p.key === 'fajr')
    if (!fajr) return
    const delay = fajr.startsAt.getTime() - Date.now()
    if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return
    fajrTimerRef.current = window.setTimeout(() => {
      refreshStreak().then(() => scheduleFajrCheck())
    }, delay + 1000)
  }, [refreshStreak])

  useEffect(() => {
    if (!userId) return
    refreshStreak().then(() => scheduleFajrCheck())
    return () => {
      if (fajrTimerRef.current) window.clearTimeout(fajrTimerRef.current)
    }
  }, [userId, refreshStreak, scheduleFajrCheck])

  return { streak, refreshStreak }
}
