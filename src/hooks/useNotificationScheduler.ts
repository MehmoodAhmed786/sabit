import { useCallback, useEffect, useRef } from 'react'
import { notificationScheduler } from '../lib/notificationScheduler'
import { loadNotificationSettings } from '../lib/notificationSettings'

export function useNotificationScheduler(userId: string | undefined) {
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (!userId || !mountedRef.current) return
    await loadNotificationSettings(userId)
    await notificationScheduler.refresh(userId, () => {
      if (mountedRef.current && userId) void refresh()
    })
  }, [userId])

  useEffect(() => {
    mountedRef.current = true
    if (!userId) {
      notificationScheduler.stop()
      return
    }

    void refresh()

    const onSettings = () => { void refresh() }
    const onPrayerUpdated = () => { void refresh() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    window.addEventListener('sabit-notifications-updated', onSettings)
    window.addEventListener('sabit-prayer-updated', onPrayerUpdated)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mountedRef.current = false
      notificationScheduler.stop()
      window.removeEventListener('sabit-notifications-updated', onSettings)
      window.removeEventListener('sabit-prayer-updated', onPrayerUpdated)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId, refresh])

  return { refresh }
}
