import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import {
  acceptFriendRequest,
  declineFriendRequest,
  emitFriendsUpdated,
  loadFriendsHub,
  type FriendshipRow,
} from '../lib/friends'

function Avatar({ url }: { url: string | null; name?: string }) {
  return (
    <img
      src={url || '/avatar.png'}
      alt=""
      style={{ width: 44, height: 44, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }}
    />
  )
}

export default function FriendRequests() {
  const navigate = useNavigate()
  const [incoming, setIncoming] = useState<FriendshipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const hub = await loadFriendsHub(user.id)
    setIncoming(hub.incoming)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const respond = async (id: string, accept: boolean) => {
    setBusy(id)
    try {
      if (accept) await acceptFriendRequest(id)
      else await declineFriendRequest(id)
      emitFriendsUpdated()
      await load()
    } catch (e: any) {
      alert(e.message || 'Could not respond')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="friends-screen page-content">
      <button type="button" className="view-qada" onClick={() => navigate('/friends')}>← Back</button>
      <h1>Friend Requests</h1>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : incoming.length === 0 ? (
        <p className="muted">No pending friend requests.</p>
      ) : (
        incoming.map((r) => (
          <div key={r.id} className="card friend-request-card" style={{ marginTop: 12 }}>
            <Avatar url={r.friend.avatar_url} name={r.friend.display_name} />
            <div style={{ flex: 1 }}>
              <div className="friend-name">{r.friend.display_name}</div>
              <div className="muted">@{r.friend.username}</div>
            </div>
            <div className="friend-request-actions">
              <button type="button" className="madeup" disabled={busy === r.id} onClick={() => respond(r.id, true)}>Accept</button>
              <button type="button" disabled={busy === r.id} onClick={() => respond(r.id, false)}>Decline</button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
