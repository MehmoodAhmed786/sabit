import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { LAQAB_TOTAL } from '../lib/database'
import { notifyLaqabUnlocked } from '../lib/notifications'

type Laqab = {
  id: string
  name: string
  meaning: string
  requirement_days: number
}

type UserLaqab = {
  user_id: string
  laqab_id: string
  unlocked_at: string
}

function LaqabUnlockModal({ laqab, onClose }: { laqab: Laqab; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>🤍</div>
          <h2>Alhamdulillah</h2>
          <div>New Laqab Unlocked</div>
          <h3 style={{ marginTop: 8 }}>{laqab.name}</h3>
          <div className="muted">{laqab.meaning}</div>
          <div className="muted">{laqab.requirement_days}-day streak</div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="madeup" onClick={onClose}>Continue</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Laqabs() {
  const [laqabs, setLaqabs] = useState<Laqab[]>([])
  const [userLaqabs, setUserLaqabs] = useState<Record<string, UserLaqab>>({})
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unlockedLaqab, setUnlockedLaqab] = useState<Laqab | null>(null)

  const fetchLaqabs = async () => {
    setLoading(true)
    setError(null)
    try {
      const userRes = await supabase.auth.getUser()
      const uid = userRes.data.user?.id

      const [lRes, ulRes, sRes] = await Promise.all([
        supabase.from('laqabs').select('id,name,meaning,requirement_days').order('requirement_days'),
        uid
          ? supabase.from('user_laqabs').select('user_id,laqab_id,unlocked_at').eq('user_id', uid)
          : Promise.resolve({ data: [] as UserLaqab[], error: null }),
        uid
          ? supabase.from('streaks').select('current_streak').eq('user_id', uid).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (lRes.error) throw lRes.error
      if (ulRes.error) throw ulRes.error
      if (sRes.error) console.debug('streak fetch error', sRes.error)

      setLaqabs(lRes.data ?? [])

      const map: Record<string, UserLaqab> = {}
      for (const row of ulRes.data ?? []) map[row.laqab_id] = row
      setUserLaqabs(map)
      setStreak(sRes.data?.current_streak ?? 0)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLaqabs()
    const chan = supabase
      .channel('realtime-laqabs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_laqabs' }, () => { fetchLaqabs() })
      .subscribe()
    return () => { chan.unsubscribe() }
  }, [])

  useEffect(() => {
    if (laqabs.length === 0 || streak == null) return
    ;(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id
      if (!uid) return
      for (const l of laqabs) {
        if (userLaqabs[l.id] || streak < l.requirement_days) continue
        const { error } = await supabase.from('user_laqabs').insert({ user_id: uid, laqab_id: l.id })
        if (!error) {
          setUserLaqabs((prev) => ({
            ...prev,
            [l.id]: { user_id: uid, laqab_id: l.id, unlocked_at: new Date().toISOString() },
          }))
          setUnlockedLaqab(l)
          notifyLaqabUnlocked(l.name, l.requirement_days)
          break
        }
      }
    })()
  }, [laqabs, streak, userLaqabs])

  const unlockedCount = useMemo(() => Object.keys(userLaqabs).length, [userLaqabs])
  const nextLaqab = useMemo(() => laqabs.find((l) => !userLaqabs[l.id]), [laqabs, userLaqabs])
  const totalLaqabs = laqabs.length || LAQAB_TOTAL

  if (loading) return <div className="page-content">Loading…</div>
  if (error) {
    return (
      <div className="page-content">
        <h1>Laqabs</h1>
        <div className="card" style={{ marginTop: 12 }}>
          <p>Error loading laqabs: {error}</p>
          <button type="button" className="view-qada" onClick={fetchLaqabs}>Retry</button>
        </div>
      </div>
    )
  }

  if (laqabs.length === 0) {
    return (
      <div className="page-content">
        <h1>Laqabs</h1>
        <div className="muted">Milestones on your journey of consistency.</div>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>No laqabs in database</h3>
          <p className="muted">The <strong>laqabs</strong> table is empty. Run <strong>supabase/setup.sql</strong> in your Supabase SQL Editor to seed the 12 milestones and RLS policies.</p>
          <button type="button" className="view-qada" onClick={fetchLaqabs} style={{ marginTop: 8 }}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Laqabs</h1>
          <div className="muted">Milestones on your journey of consistency.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted">Unlocked:</div>
          <div style={{ fontWeight: 700 }}>{unlockedCount} / {totalLaqabs}</div>
        </div>
      </header>

      <main style={{ marginTop: 12 }}>
        <section style={{ marginBottom: 12 }}>
          <h3>Next Laqab</h3>
          {!nextLaqab ? (
            <div className="card">All laqabs unlocked — mā shāʾ Allāh!</div>
          ) : (
            <div className="laqab-card" style={{ display: 'flex', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{nextLaqab.name}</div>
                <div className="muted">{nextLaqab.meaning}</div>
                <div className="muted">{nextLaqab.requirement_days}-day streak</div>
                <div style={{ marginTop: 8 }}>{streak} / {nextLaqab.requirement_days} days</div>
                <div className="laqab-bar-outer" style={{ width: 160, marginTop: 8 }}>
                  <div
                    className="laqab-bar-inner"
                    style={{ width: `${Math.min(100, Math.round((streak / nextLaqab.requirement_days) * 100))}%` }}
                  />
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {Math.max(0, nextLaqab.requirement_days - streak) > 0
                    ? `${nextLaqab.requirement_days - streak} days remaining`
                    : 'Qualified — unlocking…'}
                </div>
              </div>
            </div>
          )}
        </section>

        <section>
          <h3>Laqab Journey</h3>
          <div>
            {laqabs.map((l) => {
              const unlocked = !!userLaqabs[l.id]
              const unlockedAt = userLaqabs[l.id]?.unlocked_at
              const remaining = Math.max(0, l.requirement_days - streak)
              const progress = Math.round((Math.min(streak, l.requirement_days) / l.requirement_days) * 100)
              return (
                <div
                  key={l.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#fff', borderRadius: 10, marginBottom: 8, border: '1px solid #eee' }}
                >
                  <div style={{ width: 36, textAlign: 'center' }}>{unlocked ? '✓' : '🔒'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{l.name}</div>
                    <div className="muted">{l.meaning}</div>
                    <div className="muted">{l.requirement_days}-day streak</div>
                    <div style={{ marginTop: 6 }} className="muted">
                      {unlocked
                        ? `Unlocked ${unlockedAt ? new Date(unlockedAt).toLocaleDateString() : ''}`
                        : `${remaining} days remaining`}
                    </div>
                  </div>
                  <div style={{ width: 120 }}>
                    <div className="laqab-bar-outer">
                      <div className="laqab-bar-inner" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>

      {unlockedLaqab && <LaqabUnlockModal laqab={unlockedLaqab} onClose={() => setUnlockedLaqab(null)} />}
    </div>
  )
}
