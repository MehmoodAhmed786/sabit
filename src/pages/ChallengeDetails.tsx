import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  acceptChallengeInvite,
  declineChallengeInvite,
  formatChallengeDate,
  getChallengeDetail,
  leaveChallenge,
  type ChallengeDetail,
  type ChallengeMember,
} from '../lib/challenges'
import { emitFriendsUpdated } from '../lib/friends'

function Avatar({ url }: { url: string | null; name?: string }) {
  return (
    <img
      src={url || '/avatar.png'}
      alt=""
      style={{ width: 40, height: 40, borderRadius: 999, objectFit: 'cover' }}
    />
  )
}

function MemberProgress({ member, totalDays, isComplete }: { member: ChallengeMember; totalDays: number; isComplete: boolean }) {
  const label = member.is_self ? 'You' : member.display_name
  const days = member.qualifying_days ?? 0
  const pct = totalDays > 0 ? Math.round((days / totalDays) * 100) : 0

  if (!member.progress_visible && !member.is_self) {
    return (
      <div className="challenge-member card">
        <Avatar url={member.avatar_url} name={member.display_name} />
        <div style={{ flex: 1 }}>
          <div className="friend-name">{label}</div>
          <div className="muted">Progress hidden</div>
        </div>
      </div>
    )
  }

  return (
    <div className="challenge-member card">
      <Avatar url={member.avatar_url} name={member.display_name} />
      <div style={{ flex: 1 }}>
        <div className="friend-name">{label}</div>
        {!isComplete && member.today_completed !== null && (
          <div className="muted">{member.today_completed} / 5 today</div>
        )}
        <div className="muted">{days} / {totalDays} qualifying days</div>
        <div className="progress-bar-outer" style={{ marginTop: 8 }}>
          <div className="progress-bar-inner" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

export default function ChallengeDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<ChallengeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [myInvite, setMyInvite] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const d = await getChallengeDetail(id)
      setDetail(d)
      const me = d.members.find((m) => m.is_self)
      setMyInvite(me?.member_status === 'invited')
    } catch (e: any) {
      setError(e.message || 'Could not load challenge')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
    const onUpdate = () => { load() }
    window.addEventListener('sabit-prayer-updated', onUpdate)
    window.addEventListener('sabit-friends-updated', onUpdate)
    return () => {
      window.removeEventListener('sabit-prayer-updated', onUpdate)
      window.removeEventListener('sabit-friends-updated', onUpdate)
    }
  }, [load])

  const respondInvite = async (accept: boolean) => {
    if (!id) return
    setBusy(true)
    try {
      if (accept) await acceptChallengeInvite(id)
      else await declineChallengeInvite(id)
      emitFriendsUpdated()
      if (!accept) navigate('/friends')
      else await load()
    } catch (e: any) {
      setError(e.message || 'Could not respond')
    } finally {
      setBusy(false)
    }
  }

  const doLeave = async () => {
    if (!id) return
    setBusy(true)
    setConfirmLeave(false)
    try {
      await leaveChallenge(id)
      emitFriendsUpdated()
      navigate('/friends')
    } catch (e: any) {
      setError(e.message || 'Could not leave challenge')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-content"><p className="muted">Loading…</p></div>

  if (error || !detail) {
    return (
      <div className="page-content">
        <button type="button" className="view-qada" onClick={() => navigate('/friends')}>← Back</button>
        <p>{error || 'Challenge not found.'}</p>
        <button type="button" onClick={load}>Try Again</button>
      </div>
    )
  }

  const isComplete = detail.status === 'completed'
  const me = detail.members.find((m) => m.is_self)
  const acceptedMembers = detail.members.filter((m) => m.member_status === 'accepted')

  return (
    <div className="friends-screen page-content">
      <button type="button" className="view-qada" onClick={() => navigate('/friends')}>← Back</button>

      <header className="challenge-detail-header">
        <h1>{detail.name}</h1>
        {!isComplete && (
          <p className="challenge-day-label">Day {detail.current_day} / {detail.total_days}</p>
        )}
        <p className="muted">
          {formatChallengeDate(detail.start_date)} – {formatChallengeDate(detail.end_date)}
        </p>
      </header>

      {myInvite && (
        <div className="card challenge-invite-card">
          <p>You've been invited to this challenge.</p>
          <p className="muted">{detail.total_days} days · Consistency Challenge</p>
          <div className="friend-request-actions">
            <button type="button" className="madeup" disabled={busy} onClick={() => respondInvite(true)}>Accept</button>
            <button type="button" disabled={busy} onClick={() => respondInvite(false)}>Decline</button>
          </div>
        </div>
      )}

      {isComplete && (
        <div className="card challenge-complete-card">
          <h2>Challenge Complete</h2>
          <p className="muted">Alhamdulillah — you completed the challenge.</p>
          <p className="challenge-encourage">Great work staying consistent.</p>
        </div>
      )}

      {!isComplete && !myInvite && (
        <p className="challenge-encourage">Keep going together.</p>
      )}

      <section className="friends-section">
        <h2>{isComplete ? 'Summary' : 'Participants'}</h2>
        {acceptedMembers.map((m) => (
          <MemberProgress key={m.user_id} member={m} totalDays={detail.total_days} isComplete={isComplete} />
        ))}
      </section>

      {!myInvite && me?.member_status === 'accepted' && !isComplete && (
        <button type="button" className="prayer-btn-secondary" style={{ marginTop: 16 }} onClick={() => setConfirmLeave(true)}>
          Leave Challenge
        </button>
      )}

      {confirmLeave && (
        <div className="modal-backdrop" onClick={() => setConfirmLeave(false)}>
          <div className="modal prayer-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Leave this challenge?</h3>
            <p className="muted">Your private Salah records will not be deleted.</p>
            <div className="prayer-confirm-actions">
              <button type="button" onClick={() => setConfirmLeave(false)}>Cancel</button>
              <button type="button" className="madeup" disabled={busy} onClick={doLeave}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
