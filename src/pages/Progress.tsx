import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { reconcileMissedPrayers } from '../lib/prayerTracking'
import {
  computeProgressStats,
  type PrayerRecord,
  type QadaRecord,
} from '../lib/progressStats'

const PERIODS = {
  '7d': { label: '7 Days', days: 7 },
  '30d': { label: '30 Days', days: 30 },
  '90d': { label: '90 Days', days: 90 },
  'year': { label: 'This Year', days: null },
  'all': { label: 'All Time', days: null },
} as const

function startOfDayISO(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10)
}

export default function Progress() {
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30d')
  const [records, setRecords] = useState<PrayerRecord[] | null>(null)
  const [qadaRecords, setQadaRecords] = useState<QadaRecord[]>([])
  const [streaks, setStreaks] = useState<{ current_streak: number; longest_streak: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const userRes = await supabase.auth.getUser()
      const uid = userRes.data.user?.id
      if (!uid) {
        setRecords([])
        setQadaRecords([])
        setLoading(false)
        return
      }

      await reconcileMissedPrayers(uid)

      const [s, pr, qada] = await Promise.all([
        supabase.from('streaks').select('current_streak,longest_streak').eq('user_id', uid).single(),
        supabase.from('prayer_records').select('id,user_id,date,prayer_name,status').eq('user_id', uid),
        supabase.from('qada_records').select('id,original_date,prayer_name,status').eq('user_id', uid),
      ])

      if (s.error && s.status !== 406) console.debug('streaks fetch error', s.error)
      setStreaks(s.data || { current_streak: 0, longest_streak: 0 })
      if (pr.error) throw pr.error
      setRecords(pr.data as PrayerRecord[])
      setQadaRecords((qada.data as QadaRecord[]) || [])
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
    const ch = supabase
      .channel('realtime-progress')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prayer_records' }, () => {
        fetchAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qada_records' }, () => {
        fetchAll()
      })
      .subscribe()
    const onUpdate = () => { fetchAll() }
    window.addEventListener('sabit-prayer-updated', onUpdate)
    return () => {
      ch.unsubscribe()
      window.removeEventListener('sabit-prayer-updated', onUpdate)
    }
  }, [])

  const today = new Date()
  const periodRange = useMemo(() => {
    const p = PERIODS[period]
    if (period === 'all') return { start: null, end: startOfDayISO(today) }
    if (period === 'year') return { start: `${today.getFullYear()}-01-01`, end: startOfDayISO(today) }
    const start = new Date(today)
    start.setDate(start.getDate() - (p.days! - 1))
    return { start: startOfDayISO(start), end: startOfDayISO(today) }
  }, [period])

  const daysCount = useMemo(() => {
    if (!periodRange.start) {
      if (!records || records.length === 0) return 0
      const dates = Array.from(new Set(records.map((r) => r.date))).sort()
      return dates.length
    }
    const s = new Date(periodRange.start)
    const e = new Date(periodRange.end)
    return Math.max(1, Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1)
  }, [periodRange, records])

  const stats = useMemo(
    () => computeProgressStats(records || [], qadaRecords, periodRange, daysCount),
    [records, qadaRecords, periodRange, daysCount],
  )

  const [calendarView, setCalendarView] = useState(() => new Date())

  const calendarData = useMemo(() => {
    const year = calendarView.getFullYear()
    const month = calendarView.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const map = new Map<string, number>()
    for (let d = 1; d <= daysInMonth; d++) {
      map.set(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 0)
    }
    for (const r of records || []) {
      if (!r.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`)) continue
      if (r.status === 'completed') map.set(r.date, (map.get(r.date) || 0) + 1)
    }
    for (const q of qadaRecords) {
      if (q.status !== 'made_up') continue
      if (!q.original_date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`)) continue
      map.set(q.original_date, (map.get(q.original_date) || 0) + 1)
    }
    return { map, daysInMonth }
  }, [records, qadaRecords, calendarView])

  const personalRecords = useMemo(() => {
    const longest = streaks?.longest_streak ?? 0
    const totalCompletedAll =
      (records?.filter((r) => r.status === 'completed').length ?? 0) +
      qadaRecords.filter((q) => q.status === 'made_up').length
    const totalQadaCompleted = qadaRecords.filter((q) => q.status === 'made_up').length
    const byMonth = new Map<string, { completed: number; days: Set<string> }>()
    for (const r of records || []) {
      const m = r.date.slice(0, 7)
      const entry = byMonth.get(m) || { completed: 0, days: new Set<string>() }
      if (r.status === 'completed') entry.completed += 1
      entry.days.add(r.date)
      byMonth.set(m, entry)
    }
    for (const q of qadaRecords) {
      if (q.status !== 'made_up') continue
      const m = q.original_date.slice(0, 7)
      const entry = byMonth.get(m) || { completed: 0, days: new Set<string>() }
      entry.completed += 1
      entry.days.add(q.original_date)
      byMonth.set(m, entry)
    }
    let bestMonth = null as string | null
    let bestPct = 0
    for (const [m, v] of byMonth.entries()) {
      const days = v.days.size || 0
      const pct = days ? (v.completed / (days * 5)) * 100 : 0
      if (pct > bestPct) {
        bestPct = pct
        bestMonth = m
      }
    }
    return {
      longest,
      totalCompletedAll,
      totalQadaCompleted,
      bestMonth,
      bestPct: Math.round(bestPct * 10) / 10,
    }
  }, [records, streaks, qadaRecords])

  if (loading) return <div className="page-content">Loading your progress…</div>
  if (error) {
    return (
      <div className="page-content">
        Error loading progress: {error} <button type="button" onClick={fetchAll}>Retry</button>
      </div>
    )
  }

  const currentStreak = streaks?.current_streak ?? 0
  const qadaPending = qadaRecords.filter((q) => q.status === 'pending').length

  return (
    <div className="page-content">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Your Progress</h1>
          <div className="muted">Your journey, your consistency.</div>
        </div>
      </header>

      <section style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Current Streak</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{currentStreak} Days</div>
            <div className="muted">Longest: {streaks?.longest_streak ?? 0} Days</div>
          </div>
          <div style={{ width: 160, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Qada</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{qadaPending}</div>
            <div className="muted">remaining</div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Beat Your Best</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Current</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{currentStreak} days</div>
          </div>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Personal Best</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{streaks?.longest_streak ?? 0} days</div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          {currentStreak >= (streaks?.longest_streak ?? 0) ? (
            <div className="muted">You're at a new personal best — well done.</div>
          ) : (
            <div className="muted">{(streaks?.longest_streak ?? 0) - currentStreak} days to beat your record</div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Prayer Completion</h3>
          <div>
            <select value={period} onChange={(e) => setPeriod(e.target.value as keyof typeof PERIODS)}>
              {Object.entries(PERIODS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Completed</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.completedCount}</div>
          </div>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Missed</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.missedCount}</div>
          </div>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Completion</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.completionPct}%</div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4>Prayer Performance</h4>
          <div>
            {stats.prayerRates.map((p) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <div>{p.name}</div>
                <div>{p.pct}%</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Prayer Calendar — {calendarView.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setCalendarView((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>←</button>
            <button type="button" onClick={() => setCalendarView((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>→</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
          {Array.from({ length: calendarData.daysInMonth }).map((_, i) => {
            const d = i + 1
            const key = `${calendarView.getFullYear()}-${String(calendarView.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const val = calendarData.map.get(key) || 0
            return (
              <div key={key} style={{ padding: 8, borderRadius: 8, background: '#fff', textAlign: 'center' }}>
                <div style={{ fontSize: 12 }}>{d}</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>{val}/5</div>
              </div>
            )
          })}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Personal Records</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Longest Streak</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{personalRecords.longest} days</div>
          </div>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Most Consistent Month</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{personalRecords.bestMonth ?? '—'}</div>
            <div className="muted">{personalRecords.bestPct ?? 0}%</div>
          </div>
          <div style={{ flex: 1, background: '#fff', padding: 12, borderRadius: 10 }}>
            <div className="muted">Total Completed</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{personalRecords.totalCompletedAll}</div>
          </div>
        </div>
      </section>
    </div>
  )
}
