import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toDisplayPrayerName } from '../lib/database'
import { reconcileMissedPrayers } from '../lib/prayerTracking'
import { markQadaMadeUp } from '../lib/progressStats'

type QadaRecord = {
  id: string
  user_id: string
  original_prayer_record_id?: string | null
  original_date: string
  prayer_name: string
  status: 'pending' | 'made_up'
  created_at: string
  made_up_at?: string | null
}

function formatDate(d: string) {
  try {
    return new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } catch (e) { return d }
}

export default function Qada() {
  const [records, setRecords] = useState<QadaRecord[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterPrayer, setFilterPrayer] = useState<'all' | string>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'made_up'>('all')
  const [sortBy, setSortBy] = useState<'oldest' | 'newest' | 'prayer'>('oldest')

  const fetchRecords = async () => {
    setLoading(true); setError(null)
    try {
      const user = (await supabase.auth.getUser()).data.user
      if (!user) {
        setRecords([])
        setLoading(false)
        return
      }
      await reconcileMissedPrayers(user.id)
      const { data, error } = await supabase
        .from('qada_records')
        .select('*')
        .eq('user_id', user.id)
      if (error) throw error
      setRecords((data as QadaRecord[]) || [])
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => {
    fetchRecords()
    const channel = supabase.channel('realtime-qada').on('postgres_changes', { event: '*', schema: 'public', table: 'qada_records' }, () => {
      fetchRecords()
    }).subscribe()
    const onUpdate = () => { fetchRecords() }
    window.addEventListener('sabit-prayer-updated', onUpdate)
    return () => {
      channel.unsubscribe()
      window.removeEventListener('sabit-prayer-updated', onUpdate)
    }
  }, [])

  const pending = useMemo(() => records?.filter(r => r.status === 'pending') || [], [records])
  const completed = useMemo(() => records?.filter(r => r.status === 'made_up') || [], [records])

  const filtered = useMemo(() => {
    if (!records) return []
    let out = records.slice()
    if (filterPrayer !== 'all') out = out.filter(r => r.prayer_name.toLowerCase() === filterPrayer.toLowerCase())
    if (filterStatus !== 'all') out = out.filter(r => r.status === filterStatus)
    if (sortBy === 'oldest') out.sort((a,b) => a.original_date.localeCompare(b.original_date))
    if (sortBy === 'newest') out.sort((a,b) => b.original_date.localeCompare(a.original_date))
    if (sortBy === 'prayer') out.sort((a,b) => a.prayer_name.localeCompare(b.prayer_name))
    return out
  }, [records, filterPrayer, filterStatus, sortBy])

  const totalCompleted = completed.length
  const totalRemaining = pending.length
  const progressPct = (totalCompleted + totalRemaining) ? Math.round((totalCompleted / (totalCompleted + totalRemaining)) * 100) : 100

  const markMadeUp = async (r: QadaRecord) => {
    const ok = window.confirm(`Mark ${toDisplayPrayerName(r.prayer_name)} from ${new Date(r.original_date).toLocaleDateString()} as made up?`)
    if (!ok) return
    try {
      const user = (await supabase.auth.getUser()).data.user
      if (!user) throw new Error('Not signed in')
      await markQadaMadeUp(user.id, r.id)
      fetchRecords()
    } catch (e: any) {
      alert('Could not mark as made up: ' + (e.message || e))
    }
  }

  if (loading) return (<div className="qada-screen page-content"><h1>Qada</h1><p>Loading…</p></div>)
  if (error) {
    const msg = String(error)
    const missing = msg.toLowerCase().includes('could not find the table') || msg.toLowerCase().includes('schema cache') || msg.toLowerCase().includes('relation "qada_records"')
    if (missing) {
      return (
        <div className="qada-screen page-content">
          <h1>Qada</h1>
          <div className="card" style={{marginTop:12}}>
            <h3>Database table not found</h3>
            <p className="muted">The required table <strong>qada_records</strong> does not exist in your Supabase project.</p>
            <p>To enable Qada tracking, run the migration SQL in <strong>supabase-schema.sql</strong> (project root) in your Supabase SQL editor. Then refresh this page.</p>
            <p style={{marginTop:8}}><button onClick={fetchRecords} className="view-qada">Retry</button></p>
          </div>
        </div>
      )
    }
    return (<div className="qada-screen page-content"><h1>Qada</h1><p>Error: {error} <button onClick={fetchRecords}>Retry</button></p></div>)
  }

  return (
    <div className="qada-screen page-content">
      <header className="qada-header">
        <div>
          <h1>Qada</h1>
          <p className="muted">Keep track of prayers you still need to make up.</p>
        </div>
        <button className="info">i</button>
      </header>

      <section className="qada-summary">
        <div className="card">
          <div>Qada Remaining</div>
          <div className="big">{totalRemaining}</div>
          <div className="muted">prayers</div>
        </div>
        <div className="card">
          <div>{totalCompleted} completed</div>
        </div>
      </section>

      <section className="qada-progress">
        <div className="progress-head">Qada Progress</div>
        <div className="progress-bar-outer"><div className="progress-bar-inner" style={{ width: `${progressPct}%` }} /></div>
        <div className="muted">{totalCompleted} completed • {totalRemaining} remaining</div>
      </section>

      <section className="qada-controls">
        <div className="filters">
          <label>Filter:</label>
          <select value={filterPrayer} onChange={(e) => setFilterPrayer(e.target.value)}>
            <option value="all">All</option>
            <option value="Fajr">Fajr</option>
            <option value="Dhuhr">Dhuhr</option>
            <option value="Asr">Asr</option>
            <option value="Maghrib">Maghrib</option>
            <option value="Isha">Isha</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
            <option value="all">All</option>
            <option value="pending">Remaining</option>
            <option value="made_up">Completed</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="prayer">Prayer</option>
          </select>
        </div>
      </section>

      <section className="qada-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="check">✓</div>
            <h3>You're all caught up.</h3>
            <p>No outstanding Qada prayers.</p>
          </div>
        ) : (
          filtered.map((r) => (
            <div className={`qada-item ${r.status}`} key={r.id}>
              <div className="left">
                <div className="p-name">{toDisplayPrayerName(r.prayer_name)}</div>
                <div className="p-date">{formatDate(r.original_date)}</div>
              </div>
              <div className="right">
                {r.status === 'pending' ? (
                  <button className="madeup" onClick={() => markMadeUp(r)}>Mark as Made Up</button>
                ) : (
                  <div className="madeup-label">Made up ✓<div className="muted">{r.made_up_at ? new Date(r.made_up_at).toLocaleDateString() : ''}</div></div>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
