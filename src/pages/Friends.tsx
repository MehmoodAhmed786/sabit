import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import {
  activateDueChallenges,
  blockUser,
  emitFriendsUpdated,
  loadFriendsHub,
  removeFriend,
  type FriendshipRow,
} from '../lib/friends'
import { friendHasActiveChallenge, loadMyChallenges, type ChallengeSummary } from '../lib/challenges'

function Avatar({ url, size = 40 }: { url: string | null; name?: string; size?: number }) {
  return (
    <img
      src={url || '/avatar.png'}
      alt=""
      style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', flexShrink: 0, background: '#e9f5ef' }}
    />
  )
}

function FriendRow({
  row,
  activeChallenge,
  onOpen,
  onRemove,
  onBlock,
}: {
  row: FriendshipRow
  activeChallenge: boolean
  onOpen: () => void
  onRemove: () => void
  onBlock: () => void
}) {
  return (
    <div className="friend-row card">
      <button type="button" className="friend-row-main" onClick={onOpen}>
        <Avatar url={row.friend.avatar_url} name={row.friend.display_name} />
        <div className="friend-row-text">
          <div className="friend-name">{row.friend.display_name}</div>
          <div className="muted">@{row.friend.username}</div>
          {activeChallenge && <div className="friend-challenge-dot">Active challenge</div>}
        </div>
      </button>
      <div className="friend-row-actions">
        <button type="button" className="friend-remove" onClick={onRemove} title="Remove friend">×</button>
        <button type="button" className="view-qada" style={{ fontSize: 12 }} onClick={onBlock}>Block</button>
      </div>
    </div>
  )
}

function ChallengeRow({ c, onOpen }: { c: ChallengeSummary; onOpen: () => void }) {
  return (
    <button type="button" className="challenge-row card" onClick={onOpen}>
      <div className="challenge-row-name">{c.name}</div>
      <div className="muted">Day {c.current_day} / {c.total_days}</div>
      <div className="challenge-row-status">{c.status === 'pending' ? 'Starting soon' : 'In progress'}</div>
    </button>
  )
}

export default function Friends() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [friends, setFriends] = useState<FriendshipRow[]>([])
  const [incoming, setIncoming] = useState<FriendshipRow[]>([])
  const [activeChallenges, setActiveChallenges] = useState<ChallengeSummary[]>([])
  const [invites, setInvites] = useState<(ChallengeSummary & { inviter?: { display_name: string } })[]>([])
  const [activeFriendIds, setActiveFriendIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await activateDueChallenges()

      const [hub, challenges] = await Promise.all([
        loadFriendsHub(user.id),
        loadMyChallenges(user.id),
      ])

      setFriends(hub.friends)
      setIncoming(hub.incoming)
      setActiveChallenges(challenges.active)
      setInvites(challenges.invites)

      const friendIds = hub.friends.map((f) => f.friend.id)
      const activeSet = await friendHasActiveChallenge(friendIds, user.id)
      setActiveFriendIds(activeSet)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const onUpdate = () => { load() }
    window.addEventListener('sabit-friends-updated', onUpdate)
    window.addEventListener('sabit-prayer-updated', onUpdate)
    return () => {
      window.removeEventListener('sabit-friends-updated', onUpdate)
      window.removeEventListener('sabit-prayer-updated', onUpdate)
    }
  }, [load])

  const handleBlock = async (row: FriendshipRow) => {
    if (!confirm(`Block ${row.friend.display_name}? They will not be able to contact you.`)) return
    try {
      await blockUser(row.friend.id)
      emitFriendsUpdated()
      await load()
    } catch (e: any) {
      alert(e.message || 'Could not block user')
    }
  }

  const handleRemove = async (row: FriendshipRow) => {
    if (!confirm(`Remove ${row.friend.display_name} from your friends?`)) return
    try {
      await removeFriend(row.id)
      emitFriendsUpdated()
      await load()
    } catch (e: any) {
      alert(e.message || 'Could not remove friend')
    }
  }

  if (loading) {
    return (
      <div className="friends-screen page-content">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="friends-screen page-content">
        <p>Error: {error}</p>
        <button type="button" onClick={load}>Try Again</button>
      </div>
    )
  }

  return (
    <div className="friends-screen page-content">
      <button type="button" className="view-qada" onClick={() => navigate('/profile')} style={{ marginBottom: 8 }}>← Back</button>

      <header className="friends-header">
        <h1>Friends</h1>
        <p className="muted">Stay accountable, together.</p>
      </header>

      <div className="friends-actions">
        <button type="button" className="prayer-btn-primary" onClick={() => navigate('/friends/add')}>
          Add Friend
        </button>
        <button type="button" className="prayer-btn-secondary" onClick={() => navigate('/friends/challenges/create')}>
          Create Challenge
        </button>
      </div>

      {invites.length > 0 && (
        <section className="friends-section">
          <h2>Challenge Invitations</h2>
          {invites.map((inv) => (
            <div key={inv.id} className="card challenge-invite-card">
              <p>
                <strong>{inv.inviter?.display_name ?? 'A friend'}</strong> invited you to{' '}
                <strong>{inv.name}</strong>
              </p>
              <p className="muted">
                {inv.total_days} days · {new Date(inv.start_date + 'T00:00:00').toLocaleDateString()} – {new Date(inv.end_date + 'T00:00:00').toLocaleDateString()}
              </p>
              <button type="button" className="view-qada" onClick={() => navigate(`/friends/challenges/${inv.id}`)}>
                View Invitation
              </button>
            </div>
          ))}
        </section>
      )}

      {incoming.length > 0 && (
        <section className="friends-section">
          <h2>Friend Requests</h2>
          {incoming.map((r) => (
            <div key={r.id} className="card friend-request-card">
              <Avatar url={r.friend.avatar_url} name={r.friend.display_name} />
              <div>
                <div className="friend-name">{r.friend.display_name}</div>
                <div className="muted">@{r.friend.username}</div>
              </div>
              <button type="button" className="view-qada" onClick={() => navigate('/friends/requests')}>
                Respond
              </button>
            </div>
          ))}
        </section>
      )}

      {incoming.length === 0 && (
        <section className="friends-section">
          <h2>Friend Requests</h2>
          <p className="muted empty-inline">No pending friend requests.</p>
        </section>
      )}

      <section className="friends-section">
        <h2>Your Friends</h2>
        {friends.length === 0 ? (
          <div className="empty card">
            <p>Your friends will appear here.</p>
            <button type="button" className="madeup" onClick={() => navigate('/friends/add')}>Add Friend</button>
          </div>
        ) : (
          friends.map((f) => (
            <FriendRow
              key={f.id}
              row={f}
              activeChallenge={activeFriendIds.has(f.friend.id)}
              onOpen={() => navigate('/friends')}
              onRemove={() => handleRemove(f)}
              onBlock={() => handleBlock(f)}
            />
          ))
        )}
      </section>

      <section className="friends-section">
        <h2>Active Challenges</h2>
        {activeChallenges.length === 0 ? (
          <div className="empty card">
            <p>Challenge yourself and a friend to stay consistent together.</p>
            <button type="button" className="madeup" onClick={() => navigate('/friends/challenges/create')}>Create Challenge</button>
          </div>
        ) : (
          activeChallenges.map((c) => (
            <ChallengeRow key={c.id} c={c} onOpen={() => navigate(`/friends/challenges/${c.id}`)} />
          ))
        )}
      </section>
    </div>
  )
}
