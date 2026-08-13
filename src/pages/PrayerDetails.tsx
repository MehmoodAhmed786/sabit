import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import LaqabUnlockModal from '../components/LaqabUnlockModal'
import {
  changePrayerStatusAction,
  loadPrayerDetail,
  markPrayerCompletedAction,
  markPrayerMissedAction,
  type LaqabUnlock,
  type PrayerDetail,
} from '../lib/prayerActions'

function StatusBadge({ status }: { status: PrayerDetail['status'] }) {
  const map = {
    upcoming: { label: 'Upcoming', className: 'status-upcoming' },
    current: { label: 'Current', className: 'status-current' },
    completed: { label: '✓ Completed', className: 'status-completed' },
    missed: { label: 'Missed', className: 'status-missed' },
    made_up: { label: '✓ Made Up', className: 'status-madeup' },
  }
  const s = map[status]
  return <div className={`prayer-status-badge ${s.className}`}>{s.label}</div>
}

function Skeleton() {
  return (
    <div className="prayer-detail page-content">
      <div className="skeleton-line" style={{ width: 80, height: 16 }} />
      <div className="skeleton-line" style={{ width: 120, height: 32, marginTop: 24 }} />
      <div className="skeleton-line" style={{ width: 200, height: 14, marginTop: 12 }} />
      <div className="skeleton-line" style={{ width: 80, height: 14, marginTop: 8 }} />
      <div className="skeleton-block" style={{ height: 48, marginTop: 24 }} />
      <div className="skeleton-block" style={{ height: 44, marginTop: 16 }} />
    </div>
  )
}

export default function PrayerDetails() {
  const { date, prayerKey } = useParams<{ date: string; prayerKey: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<PrayerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmMissed, setConfirmMissed] = useState(false)
  const [confirmChange, setConfirmChange] = useState(false)
  const [unlockedLaqab, setUnlockedLaqab] = useState<LaqabUnlock | null>(null)

  const load = useCallback(async () => {
    if (!date || !prayerKey) return
    setLoading(true)
    setError(null)
    setActionError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const d = await loadPrayerDetail(user.id, date, prayerKey)
      if (!d) setError('not_found')
      else setDetail(d)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [date, prayerKey])

  useEffect(() => { load() }, [load])

  const runComplete = async () => {
    if (!date || !prayerKey) return
    setBusy(true)
    setActionError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const { laqab } = await markPrayerCompletedAction(user.id, date, prayerKey)
      if (laqab) setUnlockedLaqab(laqab)
      await load()
    } catch {
      setActionError('Couldn\'t update this prayer.')
    } finally {
      setBusy(false)
    }
  }

  const runMissed = async () => {
    if (!date || !prayerKey) return
    setBusy(true)
    setActionError(null)
    setConfirmMissed(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      await markPrayerMissedAction(user.id, date, prayerKey)
      await load()
    } catch {
      setActionError('Couldn\'t update this prayer.')
    } finally {
      setBusy(false)
    }
  }

  const runChangeToCompleted = async () => {
    if (!date || !prayerKey) return
    setBusy(true)
    setActionError(null)
    setConfirmChange(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const { laqab } = await changePrayerStatusAction(user.id, date, prayerKey, 'completed')
      if (laqab) setUnlockedLaqab(laqab)
      await load()
    } catch {
      setActionError('Couldn\'t update this prayer.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Skeleton />

  if (error === 'not_found' || (!loading && !detail && !error)) {
    return (
      <div className="prayer-detail page-content">
        <button type="button" className="prayer-back" onClick={() => navigate('/')}>← Back</button>
        <h1>Prayer Details</h1>
        <div className="card" style={{ marginTop: 16 }}>
          <p>Prayer not found.</p>
          <button type="button" className="view-qada" onClick={() => navigate('/')}>Go Back</button>
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="prayer-detail page-content">
        <p>{error}</p>
        <button type="button" onClick={load}>Try Again</button>
      </div>
    )
  }

  return (
    <div className="prayer-detail page-content">
      <button type="button" className="prayer-back" onClick={() => navigate(-1)}>← Back</button>
      <h1 className="prayer-detail-title">Prayer Details</h1>

      <div className="prayer-detail-hero">
        <div className="prayer-detail-name">{detail.prayerName}</div>
        <div className="prayer-detail-date">{detail.dateLabel}</div>
        <div className="prayer-detail-time">{detail.time}</div>
      </div>

      <StatusBadge status={detail.status} />

      {detail.completedAt && detail.status === 'completed' && (
        <p className="muted prayer-detail-meta">
          Completed {new Date(detail.completedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}

      {detail.status === 'made_up' && detail.qada && (
        <div className="prayer-qada-info card">
          <h3>Qada</h3>
          <p className="muted">
            Original date:{' '}
            {new Date(detail.qada.originalDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="muted">Original status: Missed</p>
          <p className="muted">Qada status: Made Up</p>
          {detail.qada.madeUpAt && (
            <p className="muted">
              Made up:{' '}
              {new Date(detail.qada.madeUpAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
      )}

      {detail.status === 'missed' && detail.qada?.status === 'pending' && (
        <div className="prayer-qada-info card">
          <h3>Qada</h3>
          <p className="muted">This prayer is in your Qada list.</p>
          <button type="button" className="view-qada" onClick={() => navigate('/qada')}>View Qada</button>
        </div>
      )}

      {actionError && (
        <div className="prayer-action-error card">
          <p>{actionError}</p>
          <button type="button" onClick={load}>Try Again</button>
        </div>
      )}

      <div className="prayer-actions">
        {detail.canMarkCompleted && (
          <button type="button" className="prayer-btn-primary" disabled={busy} onClick={runComplete}>
            Mark as Completed
          </button>
        )}

        {detail.canMarkMissed && (
          <button type="button" className="prayer-btn-secondary" disabled={busy} onClick={() => setConfirmMissed(true)}>
            Mark as Missed
          </button>
        )}

        {detail.canChangeStatus && detail.status === 'missed' && (
          <button type="button" className="prayer-btn-secondary" disabled={busy} onClick={() => setConfirmChange(true)}>
            Change Status
          </button>
        )}
      </div>

      {confirmMissed && (
        <div className="modal-backdrop" onClick={() => setConfirmMissed(false)}>
          <div className="modal prayer-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mark this prayer as missed?</h3>
            <p className="muted">It will be added to your Qada list.</p>
            <div className="prayer-confirm-actions">
              <button type="button" onClick={() => setConfirmMissed(false)}>Cancel</button>
              <button type="button" className="madeup" onClick={runMissed}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {confirmChange && (
        <div className="modal-backdrop" onClick={() => setConfirmChange(false)}>
          <div className="modal prayer-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mark as completed?</h3>
            <p className="muted">This will update your prayer record for {detail.dateLabel}.</p>
            <div className="prayer-confirm-actions">
              <button type="button" onClick={() => setConfirmChange(false)}>Cancel</button>
              <button type="button" className="madeup" onClick={runChangeToCompleted}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {unlockedLaqab && (
        <LaqabUnlockModal
          laqab={unlockedLaqab}
          onClose={() => {
            setUnlockedLaqab(null)
            if (detail.isToday) navigate('/')
          }}
        />
      )}
    </div>
  )
}
