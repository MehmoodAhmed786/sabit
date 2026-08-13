import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { LAQAB_TOTAL } from '../lib/database'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getDeviceTimezone,
  getNotificationScheduleStatus,
  INCOMPLETE_DELAY_OPTIONS,
  loadNotificationSettings,
  NOTIFICATION_TOGGLES,
  PRE_PRAYER_OPTIONS,
  saveNotificationSettings,
  type NotificationSettings,
  type NotificationToggleKey,
} from '../lib/notificationSettings'
import {
  getBrowserNotificationPermission,
  requestNotificationPermissionForSettings,
} from '../lib/notifications'
import {
  DEFAULT_PRIVACY_SETTINGS,
  loadPrivacySettings,
  PRIVACY_LABELS,
  savePrivacySettings,
  type PrivacySettings,
} from '../lib/privacySettings'
import { getInviteCode } from '../lib/friends'

type ProfileRow = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  created_at: string
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <div style={{ background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #eee' }}>{children}</div>
    </section>
  )
}

export default function Profile() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [notifications, setNotifications] = useState<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS })
  const [notifPermission, setNotifPermission] = useState(getBrowserNotificationPermission())
  const [stats, setStats] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [savingNotif, setSavingNotif] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notifMessage, setNotifMessage] = useState<string | null>(null)
  const [scheduleStatus, setScheduleStatus] = useState(getNotificationScheduleStatus())
  const [privacy, setPrivacy] = useState<PrivacySettings>({ ...DEFAULT_PRIVACY_SETTINGS })
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [savingPrivacy, setSavingPrivacy] = useState(false)
  const [privacyMessage, setPrivacyMessage] = useState<string | null>(null)

  const fetchAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const u = await supabase.auth.getUser()
      const userData = u.data.user
      setUser(userData)
      setNotifPermission(getBrowserNotificationPermission())
      if (!userData) { setLoading(false); return }
      const uid = userData.id

      const [pRes, streakRes, prayersRes, qadaRes, laqabsRes, notifRes, privacyRes, code] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
        supabase.from('streaks').select('current_streak,longest_streak').eq('user_id', uid).maybeSingle(),
        supabase.from('prayer_records').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'completed'),
        supabase.from('qada_records').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'pending'),
        supabase.from('user_laqabs').select('laqab_id', { count: 'exact', head: true }).eq('user_id', uid),
        loadNotificationSettings(uid),
        loadPrivacySettings(uid),
        getInviteCode(uid),
      ])

      if (pRes.error) throw pRes.error
      void notifRes

      setProfile(pRes.data)
      setNotifications({ ...DEFAULT_NOTIFICATION_SETTINGS, ...notifRes })
      setPrivacy({ ...DEFAULT_PRIVACY_SETTINGS, ...privacyRes })
      setInviteCode(code)
      setStats({
        current_streak: streakRes.data?.current_streak ?? 0,
        longest_streak: streakRes.data?.longest_streak ?? 0,
        prayers_completed: prayersRes.count ?? 0,
        qada_remaining: qadaRes.count ?? 0,
        laqabs: laqabsRes.count ?? 0,
      })
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    const tick = () => setScheduleStatus(getNotificationScheduleStatus())
    tick()
    const id = window.setInterval(tick, 5000)
    return () => window.clearInterval(id)
  }, [])

  const saveProfile = async () => {
    if (!profile || !user) return
    setSaving(true)
    setError(null)
    try {
      const { error } = await supabase.from('profiles').update({
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      }).eq('id', user.id)
      if (error) throw error
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setSaving(false) }
  }

  const toggleNotification = async (key: NotificationToggleKey, value: boolean) => {
    const next = { ...notifications, [key]: value }

    if (key === 'notifications_enabled' && value) {
      const perm = await requestNotificationPermissionForSettings()
      setNotifPermission(perm)
      if (perm !== 'granted') {
        setNotifMessage('Notifications are disabled. Enable them in your browser settings for this site.')
        return
      }
    }

    if (key === 'pre_prayer_enabled' && value && next.pre_prayer_minutes === 0) {
      next.pre_prayer_minutes = 10
    }

    setNotifications(next)
  }

  const saveNotifications = async () => {
    if (!user) return
    setSavingNotif(true)
    setNotifMessage(null)
    setError(null)
    try {
      if (notifications.notifications_enabled) {
        const perm = await requestNotificationPermissionForSettings()
        setNotifPermission(perm)
        if (perm !== 'granted') {
          setNotifMessage('Enable notifications in your browser to receive alerts.')
          setSavingNotif(false)
          return
        }
      }
      await saveNotificationSettings(user.id, {
        ...notifications,
        timezone: getDeviceTimezone(),
      })
      setNotifMessage('Notification settings saved.')
      setScheduleStatus(getNotificationScheduleStatus())
      window.dispatchEvent(new Event('sabit-notifications-updated'))
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setSavingNotif(false) }
  }

  const exportData = async () => {
    const uid = user?.id
    if (!uid) return
    const { data, error } = await supabase.from('prayer_records').select('*').eq('user_id', uid)
    if (error) { setError(error.message); return }
    const csv = (data || []).map((r: any) => Object.values(r).map((v) => JSON.stringify(v ?? '')).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sabit-prayer-history-${uid}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const deletePrayerHistory = async () => {
    if (!confirm('Delete all your prayer history? This cannot be undone.')) return
    const uid = user?.id
    if (!uid) return
    const { error } = await supabase.from('prayer_records').delete().eq('user_id', uid)
    if (error) { setError(error.message); return }
    await fetchAll()
    alert('Prayer history deleted')
  }

  const savePrivacy = async () => {
    if (!user) return
    setSavingPrivacy(true)
    setPrivacyMessage(null)
    setError(null)
    try {
      await savePrivacySettings(user.id, privacy)
      setPrivacyMessage('Privacy settings saved.')
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setSavingPrivacy(false) }
  }

  const doLogout = async () => { await supabase.auth.signOut(); location.href = '/' }

  if (loading) return <div className="page-content">Loading profile…</div>
  if (error) return <div className="page-content">Error: {error} <button type="button" onClick={fetchAll}>Retry</button></div>

  const notifDisabled = !notifications.notifications_enabled

  return (
    <div className="page-content">
      <button type="button" className="view-qada" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>← Back</button>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <img
          src={profile?.avatar_url || user?.user_metadata?.avatar_url || '/avatar.png'}
          alt="avatar"
          style={{ width: 72, height: 72, borderRadius: 999, objectFit: 'cover' }}
        />
        <div>
          <h2 style={{ margin: 0 }}>{profile?.display_name || user?.email || 'My Profile'}</h2>
          <div className="muted">@{profile?.username}</div>
          <div className="muted">Member since: {new Date(profile?.created_at || user?.created_at || Date.now()).toLocaleDateString()}</div>
        </div>
      </header>

      <Section title="Personal Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <button type="button" onClick={() => navigate('/progress')} className="stat">
            <div className="muted">Current Streak</div>
            <div style={{ fontWeight: 700 }}>{stats?.current_streak ?? 0} days</div>
          </button>
          <button type="button" onClick={() => navigate('/progress')} className="stat">
            <div className="muted">Longest Streak</div>
            <div style={{ fontWeight: 700 }}>{stats?.longest_streak ?? 0} days</div>
          </button>
          <button type="button" onClick={() => navigate('/progress')} className="stat">
            <div className="muted">Prayers Completed</div>
            <div style={{ fontWeight: 700 }}>{stats?.prayers_completed ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/qada')} className="stat">
            <div className="muted">Qada Remaining</div>
            <div style={{ fontWeight: 700 }}>{stats?.qada_remaining ?? 0}</div>
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="muted">Laqabs</div>
          <div style={{ fontWeight: 700 }}>{stats?.laqabs ?? 0} / {LAQAB_TOTAL}</div>
        </div>
      </Section>

      <Section title="Friends & Challenges">
        <p className="muted" style={{ marginTop: 0 }}>Private accountability with friends — no public leaderboard.</p>
        {inviteCode && (
          <p className="muted" style={{ marginTop: 8 }}>Your invite code: <strong>{inviteCode}</strong></p>
        )}
        <button type="button" className="madeup" style={{ marginTop: 12 }} onClick={() => navigate('/friends')}>
          Open Friends & Challenges
        </button>
      </Section>

      <Section title="Privacy">
        <div className="notif-list">
          {PRIVACY_LABELS.map(({ key, label, hint }) => (
            <label key={key} className="notif-row">
              <div>
                <div>{label}</div>
                {hint && <div className="muted">{hint}</div>}
              </div>
              <input
                type="checkbox"
                checked={!!privacy[key]}
                onChange={(e) => setPrivacy((p) => ({ ...p, [key]: e.target.checked }))}
              />
            </label>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={savePrivacy} disabled={savingPrivacy}>
            {savingPrivacy ? 'Saving…' : 'Save Privacy Settings'}
          </button>
          {privacyMessage && <p className="muted" style={{ marginTop: 8 }}>{privacyMessage}</p>}
        </div>
      </Section>

      <Section title="Account">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'block' }}>
            Username
            <input
              value={profile?.username ?? ''}
              onChange={(e) => setProfile((p) => p ? { ...p, username: e.target.value.toLowerCase() } : p)}
              pattern="[a-z0-9_]{3,20}"
              style={{ width: '100%', marginTop: 6 }}
            />
          </label>
          <label style={{ display: 'block' }}>
            Display name
            <input
              value={profile?.display_name ?? ''}
              onChange={(e) => setProfile((p) => p ? { ...p, display_name: e.target.value } : p)}
              style={{ width: '100%', marginTop: 6 }}
            />
          </label>
          <label style={{ display: 'block' }}>
            Avatar URL
            <input
              value={profile?.avatar_url ?? ''}
              onChange={(e) => setProfile((p) => p ? { ...p, avatar_url: e.target.value || null } : p)}
              style={{ width: '100%', marginTop: 6 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={saveProfile} disabled={saving}>Save</button>
            <button type="button" onClick={fetchAll}>Reset</button>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="muted">Email</div>
            <div>{user?.email}</div>
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={doLogout}>Log Out</button>
          </div>
        </div>
      </Section>

      <Section title="Notifications">
        <div className="muted" style={{ marginBottom: 12 }}>
          Timezone: <strong>{notifications.timezone || getDeviceTimezone()}</strong>
          {' · '}
          Browser permission: <strong>{notifPermission === 'unsupported' ? 'Not supported' : notifPermission}</strong>
        </div>
        {notifPermission === 'denied' && (
          <div className="card" style={{ marginBottom: 12, background: '#fffaf8' }}>
            <p style={{ margin: 0 }}>Notifications are disabled.</p>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Open your browser settings for this site and allow notifications, then return here.
            </p>
          </div>
        )}
        <div className="notif-list">
          {NOTIFICATION_TOGGLES.map(({ key, label, hint }) => (
            <label key={key} className="notif-row">
              <div>
                <div>{label}</div>
                {hint && <div className="muted">{hint}</div>}
              </div>
              <input
                type="checkbox"
                checked={!!notifications[key]}
                disabled={key !== 'notifications_enabled' && notifDisabled}
                onChange={(e) => toggleNotification(key, e.target.checked)}
              />
            </label>
          ))}
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Pre-prayer timing</div>
            <select
              value={notifications.pre_prayer_minutes}
              disabled={notifDisabled || !notifications.pre_prayer_enabled}
              onChange={(e) => {
                const minutes = Number(e.target.value)
                setNotifications((n) => ({
                  ...n,
                  pre_prayer_minutes: minutes,
                  pre_prayer_enabled: minutes > 0 ? n.pre_prayer_enabled : false,
                }))
              }}
              style={{ width: '100%' }}
            >
              {PRE_PRAYER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Incomplete prayer reminder</div>
            <select
              value={notifications.incomplete_prayer_delay_minutes}
              disabled={notifDisabled || !notifications.incomplete_prayer_enabled}
              onChange={(e) => setNotifications((n) => ({ ...n, incomplete_prayer_delay_minutes: Number(e.target.value) }))}
              style={{ width: '100%' }}
            >
              {INCOMPLETE_DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={saveNotifications} disabled={savingNotif}>
            {savingNotif ? 'Saving…' : 'Save Notifications'}
          </button>
          {notifMessage && <p className="muted" style={{ marginTop: 8 }}>{notifMessage}</p>}
          {scheduleStatus.lastError && (
            <p style={{ marginTop: 8, color: '#7a5c52' }}>
              Couldn&apos;t schedule reminders. {scheduleStatus.lastError}{' '}
              <button type="button" className="view-qada" onClick={saveNotifications}>Try Again</button>
            </p>
          )}
          {!scheduleStatus.lastError && scheduleStatus.scheduled > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              {scheduleStatus.scheduled} reminders scheduled for today.
            </p>
          )}
        </div>
      </Section>

      <Section title="Your Data">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={exportData}>Export Prayer History</button>
          <button type="button" onClick={deletePrayerHistory} style={{ background: '#fee' }}>Delete Prayer History</button>
        </div>
      </Section>

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <button type="button" onClick={doLogout} style={{ background: '#f5f5f5' }}>Log Out</button>
      </div>
    </div>
  )
}
