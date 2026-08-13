import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from './Header'
import StreakCard from './StreakCard'
import PrayerList from './PrayerList'
import MissedPrayerBanner from './MissedPrayerBanner'
import { supabase } from '../lib/supabaseClient'
import { useTodayPrayers } from '../hooks/useTodayPrayers'
import { useStreak } from '../hooks/useStreak'
import { todayDateString } from '../utils/prayerUtils'
import ProgressBar from './ProgressBar'
import LaqabCard from './LaqabCard'
import QadaSection from './QadaSection'
import { loadMyChallenges, type ChallengeSummary } from '../lib/challenges'

export default function Dashboard({ user }: { user: any }) {
  const navigate = useNavigate()
  const userId = user?.user?.id as string | undefined
  const {
    prayers,
    prayerDates,
    loading: prayersLoading,
    missedAlert,
    dismissMissedAlert,
    reload: reloadPrayers,
  } = useTodayPrayers(userId)

  const { streak, refreshStreak } = useStreak(userId)
  const [qadaCount, setQadaCount] = useState(0)
  const [nextLaqab, setNextLaqab] = useState<{ name: string; daysNeeded: number; daysRemaining: number; progress: number } | null>(null)
  const [activeChallenge, setActiveChallenge] = useState<ChallengeSummary | null>(null)

  useEffect(() => {
    const onUpdate = () => {
      reloadPrayers()
      refreshStreak()
      refreshQadaCount()
    }
    window.addEventListener('sabit-prayer-updated', onUpdate)
    window.addEventListener('sabit-friends-updated', onUpdate)
    return () => {
      window.removeEventListener('sabit-prayer-updated', onUpdate)
      window.removeEventListener('sabit-friends-updated', onUpdate)
    }
  }, [reloadPrayers, refreshStreak])

  useEffect(() => {
    let mounted = true
    const loadStats = async () => {
      if (!userId) return

      const [qadaRes, laqabsRes, userLaqabsRes, challenges] = await Promise.all([
        supabase.from('qada_records').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending'),
        supabase.from('laqabs').select('id,name,requirement_days').order('requirement_days'),
        supabase.from('user_laqabs').select('laqab_id').eq('user_id', userId),
        loadMyChallenges(userId),
      ])

      if (!mounted) return

      setQadaCount(qadaRes.count ?? 0)
      setActiveChallenge(challenges.active[0] ?? null)

      const unlocked = new Set((userLaqabsRes.data ?? []).map((r) => r.laqab_id))
      const laqabs = laqabsRes.data ?? []
      const next = laqabs.find((l) => !unlocked.has(l.id))
      if (next) {
        const progress = Math.min(100, Math.round((streak / next.requirement_days) * 100))
        setNextLaqab({
          name: next.name,
          daysNeeded: next.requirement_days,
          daysRemaining: Math.max(0, next.requirement_days - streak),
          progress,
        })
      } else {
        setNextLaqab(null)
      }
    }
    loadStats()
    return () => { mounted = false }
  }, [userId, streak])

  const refreshQadaCount = async () => {
    if (!userId) return
    const qadaRes = await supabase
      .from('qada_records')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending')
    setQadaCount(qadaRes.count ?? 0)
  }

  const completed = prayers.filter((p) => p.status === 'completed').length
  const today = todayDateString()

  return (
    <div className="dashboard">
      <Header
        displayName={user?.user?.email?.split('@')?.[0] || 'User'}
        onProfile={() => navigate('/profile')}
      />

      {missedAlert && (
        <MissedPrayerBanner
          alert={missedAlert}
          onDismiss={dismissMissedAlert}
          onViewQada={() => { dismissMissedAlert(); navigate('/qada') }}
        />
      )}

      <main className="dashboard-main">
        {activeChallenge && (
          <div className="challenge-banner">
            <div style={{ fontWeight: 600, color: '#15412d' }}>{activeChallenge.name}</div>
            <div className="muted">Day {activeChallenge.current_day} / {activeChallenge.total_days}</div>
            <button type="button" className="view-qada" onClick={() => navigate(`/friends/challenges/${activeChallenge.id}`)}>
              View Challenge
            </button>
          </div>
        )}

        <StreakCard
          days={streak}
          completedToday={completed}
          onOpen={() => navigate('/progress')}
        />

        {prayersLoading ? (
          <p className="muted" style={{ textAlign: 'left', padding: '8px 0' }}>Loading prayer times…</p>
        ) : (
          <PrayerList
            prayers={prayers}
            onTap={(p) => navigate(`/prayer/${prayerDates[p.key] ?? today}/${p.key}`)}
          />
        )}

        <ProgressBar completed={completed} total={5} />

        {nextLaqab && (
          <LaqabCard
            name={nextLaqab.name}
            daysNeeded={nextLaqab.daysNeeded}
            daysRemaining={nextLaqab.daysRemaining}
            progress={nextLaqab.progress}
            onOpen={() => navigate('/laqabs')}
          />
        )}

        <QadaSection count={qadaCount} onView={() => navigate('/qada')} />
      </main>
    </div>
  )
}
