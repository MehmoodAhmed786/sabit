import { useEffect, useState } from 'react'
import './App.css'
import SignIn from './SignIn'
import { supabase } from './lib/supabaseClient'
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

function App() {
  const [session, setSession] = useState<any | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        if (window.location.search || window.location.hash) {
          try {
            const authAny: any = supabase.auth
            if (typeof authAny.getSessionFromUrl === 'function') {
              const { data, error } = await authAny.getSessionFromUrl()
              if (error) console.debug('getSessionFromUrl error', error)
              if (data?.session) {
                setSession(data.session)
                window.history.replaceState({}, document.title, window.location.pathname)
                return
              }
            }
          } catch (e) {
            console.debug('getSessionFromUrl dynamic call failed', e)
          }
        }
      } catch (e) {
        console.debug('error handling OAuth redirect', e)
      }

      const { data } = await supabase.auth.getSession()
      setSession(data.session)
      if (data.session) {
        await ensureProfile()
        await ensureNotificationSettings(data.session.user.id)
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
