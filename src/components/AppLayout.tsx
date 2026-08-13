import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav'
import { supabase } from '../lib/supabaseClient'
import { reconcileMissedPrayers } from '../lib/prayerTracking'
import { useNotificationScheduler } from '../hooks/useNotificationScheduler'
import { useSocialNotifications } from '../hooks/useSocialNotifications'
import type { NotificationRoute } from '../lib/notifications'

function NotificationShell() {
  const [userId, setUserId] = useState<string | undefined>()
  const navigate = useNavigate()

  useNotificationScheduler(userId)
  useSocialNotifications(userId)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id))

    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    reconcileMissedPrayers(userId).then((missed) => {
      if (missed.length) window.dispatchEvent(new Event('sabit-prayer-updated'))
    })
  }, [userId])

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const route = (e as CustomEvent<NotificationRoute>).detail
      if (route) navigate(route)
    }
    window.addEventListener('sabit-navigate', onNavigate)
    return () => window.removeEventListener('sabit-navigate', onNavigate)
  }, [navigate])

  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}

export default function AppLayout() {
  return (
    <div className="app-shell">
      <NotificationShell />
    </div>
  )
}
