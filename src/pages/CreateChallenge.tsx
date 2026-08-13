import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { emitFriendsUpdated, loadFriendsHub, type FriendshipRow } from '../lib/friends'
import { addDays, createChallenge } from '../lib/challenges'

const DURATIONS = [
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '30 Days', days: 30 },
  { label: 'Custom', days: 0 },
] as const

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function tomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default function CreateChallenge() {
  const navigate = useNavigate()
  const [friends, setFriends] = useState<FriendshipRow[]>([])
  const [name, setName] = useState('')
  const [duration, setDuration] = useState<number>(7)
  const [customDays, setCustomDays] = useState(7)
  const [startOption, setStartOption] = useState<'today' | 'tomorrow' | 'custom'>('today')
  const [customStart, setCustomStart] = useState(todayStr())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const hub = await loadFriendsHub(user.id)
      setFriends(hub.friends)
      setLoading(false)
    }
    load()
  }, [])

  const startDate =
    startOption === 'today' ? todayStr()
    : startOption === 'tomorrow' ? tomorrowStr()
    : customStart

  const days = duration === 0 ? customDays : duration
  const endDate = addDays(startDate, days - 1)

  const toggleFriend = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (!name.trim()) {
      setError('Enter a challenge name')
      return
    }
    if (selected.size === 0) {
      setError('Select at least one friend')
      return
    }
    if (days < 1) {
      setError('Duration must be at least 1 day')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const id = await createChallenge({
        name: name.trim(),
        startDate,
        endDate,
        memberIds: [...selected],
      })
      emitFriendsUpdated()
      navigate(`/friends/challenges/${id}`)
    } catch (e: any) {
      setError(e.message || 'Could not create challenge')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-content"><p className="muted">Loading…</p></div>

  return (
    <div className="friends-screen page-content">
      <button type="button" className="view-qada" onClick={() => navigate('/friends')}>← Back</button>
      <h1>Create Challenge</h1>
      <p className="muted">Consistency Challenge — complete all five prayers each day.</p>

      <div className="card create-challenge-form">
        <label>
          Challenge Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="7-Day Consistency"
            style={{ width: '100%', marginTop: 6 }}
          />
        </label>

        <label style={{ display: 'block', marginTop: 16 }}>
          Duration
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: '100%', marginTop: 6 }}>
            {DURATIONS.map((d) => (
              <option key={d.label} value={d.days}>{d.label}</option>
            ))}
          </select>
        </label>

        {duration === 0 && (
          <label style={{ display: 'block', marginTop: 12 }}>
            Custom days
            <input type="number" min={1} max={365} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} style={{ width: '100%', marginTop: 6 }} />
          </label>
        )}

        <fieldset style={{ marginTop: 16, border: 'none', padding: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>Challenge start</legend>
          <label className="notif-row"><span>Today</span><input type="radio" checked={startOption === 'today'} onChange={() => setStartOption('today')} /></label>
          <label className="notif-row"><span>Tomorrow</span><input type="radio" checked={startOption === 'tomorrow'} onChange={() => setStartOption('tomorrow')} /></label>
          <label className="notif-row"><span>Custom</span><input type="radio" checked={startOption === 'custom'} onChange={() => setStartOption('custom')} /></label>
          {startOption === 'custom' && (
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
          )}
        </fieldset>

        <p className="muted" style={{ marginTop: 12 }}>
          Ends: {new Date(endDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Participants</div>
          {friends.length === 0 ? (
            <p className="muted">Add friends first to invite them.</p>
          ) : (
            friends.map((f) => (
              <label key={f.id} className="notif-row">
                <span>{f.friend.display_name} <span className="muted">@{f.friend.username}</span></span>
                <input type="checkbox" checked={selected.has(f.friend.id)} onChange={() => toggleFriend(f.friend.id)} />
              </label>
            ))
          )}
        </div>

        {error && <p style={{ color: '#7a5c52', marginTop: 12 }}>{error}</p>}

        <button type="button" className="prayer-btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
          Create Challenge
        </button>
      </div>
    </div>
  )
}
