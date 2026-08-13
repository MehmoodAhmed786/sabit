import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { emitFriendsUpdated, searchUsers, sendFriendRequest, type SearchUser } from '../lib/friends'

function Avatar({ user }: { user: SearchUser }) {
  return (
    <img
      src={user.avatar_url || '/avatar.png'}
      alt=""
      style={{ width: 44, height: 44, borderRadius: 999, objectFit: 'cover' }}
    />
  )
}

export default function AddFriend() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const runSearch = async () => {
    if (query.trim().length < 2) {
      setError('Enter at least 2 characters')
      return
    }
    setSearching(true)
    setError(null)
    setMessage(null)
    try {
      const users = await searchUsers(query.trim())
      setResults(users)
      if (!users.length) setMessage('No users found.')
    } catch (e: any) {
      setError(e.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const add = async (user: SearchUser) => {
    setBusy(user.id)
    setError(null)
    try {
      await sendFriendRequest(user.id)
      setSent((s) => new Set(s).add(user.id))
      setMessage('Friend request sent.')
      emitFriendsUpdated()
    } catch (e: any) {
      setError(e.message || 'Could not send request')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="friends-screen page-content">
      <button type="button" className="view-qada" onClick={() => navigate('/friends')}>← Back</button>
      <h1>Add Friend</h1>
      <p className="muted">Search by username or invite code.</p>

      <div className="add-friend-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Username or invite code"
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button type="button" className="madeup" onClick={runSearch} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {message && <p className="muted" style={{ marginTop: 8 }}>{message}</p>}
      {error && <p style={{ color: '#7a5c52', marginTop: 8 }}>{error}</p>}

      <div className="add-friend-results">
        {results.map((u) => (
          <div key={u.id} className="card friend-search-result">
            <Avatar user={u} />
            <div style={{ flex: 1 }}>
              <div className="friend-name">{u.display_name}</div>
              <div className="muted">@{u.username}</div>
            </div>
            {sent.has(u.id) ? (
              <span className="muted">Sent</span>
            ) : (
              <button type="button" className="madeup" disabled={busy === u.id} onClick={() => add(u)}>
                Add Friend
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
