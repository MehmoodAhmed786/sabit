import { useEffect, useState } from 'react'
import './App.css'
import SignIn from './SignIn'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import { ensureProfile } from './lib/database'
import { ensureNotificationSettings } from './lib/notificationSettings'
import Dashboard from './components/Dashboard'
import Qada from './pages/Qada'
import Progress from './pages/Progress'
import Laqabs from './pages/Laqabs'
import Profile from './pages/Profile'
import PrayerDetails from './pages/PrayerDetails'
import Friends from './pages/Friends'
import AddFriend from './pages/AddFriend'
import FriendRequests from './pages/FriendRequests'
import CreateChallenge from './pages/CreateChallenge'
import ChallengeDetails from './pages/ChallengeDetails'
import AppLayout from './components/AppLayout'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

function ConfigError() {
  return (
    <div className="page-content" style={{ paddingTop: 48, textAlign: 'center' }}>
      <h2>Configuration required</h2>
      <p className="muted" style={{ maxWidth: 420, margin: '12px auto' }}>
        Supabase environment variables are missing. On Vercel, add{' '}
        <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> in
        Project Settings → Environment Variables, then redeploy.
      </p>
    </div>
  )
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return false

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('OAuth callback error', error)
    return false
  }

  window.history.replaceState({}, document.title, window.location.pathname)
  return true
}

function App() {
  const [session, setSession] = useState<any | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false)
      return
    }

    const init = async () => {
      try {
        await handleOAuthCallback()
        const { data } = await supabase.auth.getSession()
        setSession(data.session)
        if (data.session) {
          await ensureProfile()
          await ensureNotificationSettings(data.session.user.id)
        }
      } catch (e) {
        console.error('Auth init failed', e)
      } finally {
        setAuthLoading(false)
      }
    }

    init()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      if (s) {
        await ensureProfile()
        await ensureNotificationSettings(s.user.id)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) return <ConfigError />

  if (authLoading) {
    return (
      <div className="page-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!session) return <SignIn onSignedIn={(s) => setSession(s)} />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard user={session} />} />
          <Route path="/prayer/:date/:prayerKey" element={<PrayerDetails />} />
          <Route path="/qada" element={<Qada />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/laqabs" element={<Laqabs />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/friends/add" element={<AddFriend />} />
          <Route path="/friends/requests" element={<FriendRequests />} />
          <Route path="/friends/challenges/create" element={<CreateChallenge />} />
          <Route path="/friends/challenges/:id" element={<ChallengeDetails />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
