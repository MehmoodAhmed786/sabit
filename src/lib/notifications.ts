import {
  getNotificationSettings,
  isNotificationEnabled,
  prayerSettingKey,
} from './notificationSettings'
import { supabase } from './supabaseClient'

export type NotificationRoute =
  | '/'
  | '/qada'
  | '/laqabs'
  | '/friends'
  | '/friends/requests'
  | `/prayer/${string}/${string}`
  | `/friends/challenges/${string}`

function canSend() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export function sendNotification(title: string, body: string, tag: string, route: NotificationRoute = '/') {
  if (!canSend()) return false
  try {
    const n = new Notification(title, { body, icon: '/logo.png', tag })
    n.onclick = () => {
      window.focus()
      window.dispatchEvent(new CustomEvent('sabit-navigate', { detail: route }))
      n.close()
    }
    return true
  } catch {
    return false
  }
}

export async function sendEmailNotification(message: { to: string; subject: string; html?: string; text?: string }) {
  try {
    const response = await fetch('/api/send-notification-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Email notification failed:', response.status, errorText)
      return false
    }

    return true
  } catch (error) {
    console.error('Email notification failed:', error)
    return false
  }
}

export async function sendEmailNotificationIfEnabled(subject: string, text: string) {
  const settings = getNotificationSettings()
  if (!settings.email_notifications) return false

  const { data, error } = await supabase.auth.getUser()
  const email = data.user?.email
  if (error || !email) {
    console.warn('Email notifications skipped: no active user email was available.', error)
    return false
  }

  return sendEmailNotification({
    to: email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br />')}</p>`,
  })
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  return Notification.requestPermission()
}

export async function requestNotificationPermissionForSettings(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.requestPermission()
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

function todayTag(suffix: string) {
  return `${suffix}-${new Date().toISOString().slice(0, 10)}`
}

function prayerRoute(prayerKey: string) {
  const date = new Date().toISOString().slice(0, 10)
  return `/prayer/${date}/${prayerKey.toLowerCase()}` as NotificationRoute
}

export function notifyPrayerTimeArrived(prayerName: string, prayerKey: string) {
  const s = getNotificationSettings()
  if (!s.notifications_enabled) return
  if (!s[prayerSettingKey(prayerKey)]) return
  const title = `${prayerName} time has arrived.`
  const body = 'May your Salah be accepted.'
  sendNotification(title, body, todayTag(`prayer-${prayerKey}`), prayerRoute(prayerKey))
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyPrePrayer(prayerName: string, prayerKey: string, minutes: number) {
  if (!isNotificationEnabled('notifications_enabled') || !isNotificationEnabled('pre_prayer_enabled')) return
  if (!getNotificationSettings()[prayerSettingKey(prayerKey)]) return
  const title = `${prayerName} is in ${minutes} minutes.`
  const body = 'Prepare for Salah.'
  sendNotification(title, body, todayTag(`pre-${prayerKey}`), prayerRoute(prayerKey))
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyIncompletePrayer(prayerName: string, prayerKey: string) {
  if (!isNotificationEnabled('incomplete_prayer_enabled')) return
  if (!getNotificationSettings()[prayerSettingKey(prayerKey)]) return
  const title = `${prayerName} is still incomplete.`
  const body = 'Take a moment when you are ready.'
  sendNotification(title, body, todayTag(`incomplete-${prayerKey}`), prayerRoute(prayerKey))
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyDailyCompletionRemaining(remaining: number) {
  if (!isNotificationEnabled('daily_completion_enabled')) return
  if (remaining <= 0) return
  const word = remaining === 1 ? 'prayer' : 'prayers'
  const title = `You have ${remaining} ${word} remaining today.`
  const body = 'Open Today to see your progress.'
  sendNotification(title, body, todayTag('daily-completion'), '/')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyStreakReminder(streakDays: number) {
  if (!isNotificationEnabled('streak_notifications')) return
  if (streakDays <= 0) return
  const title = `Keep your ${streakDays}-day streak going.`
  const body = 'Complete today\'s prayers when you can.'
  sendNotification(title, body, todayTag('streak-reminder'), '/')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyStreakAlmostComplete(streakDays: number) {
  if (!isNotificationEnabled('streak_notifications')) return
  if (streakDays <= 0) return
  const title = 'One more prayer to complete today\'s streak day.'
  const body = `Your ${streakDays}-day streak is within reach.`
  sendNotification(title, body, todayTag('streak-almost'), '/')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyLaqabProgress(laqabName: string, daysRemaining: number) {
  if (!isNotificationEnabled('laqab_notifications')) return
  if (daysRemaining <= 0) return
  const dayWord = daysRemaining === 1 ? 'day' : 'days'
  const title = `${daysRemaining} more ${dayWord} until ${laqabName}.`
  const body = 'Stay consistent — you are making progress.'
  sendNotification(title, body, todayTag(`laqab-${laqabName}`), '/laqabs')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyQadaRemaining(count: number) {
  if (!isNotificationEnabled('qada_notifications')) return
  if (count <= 0) return
  const word = count === 1 ? 'prayer' : 'prayers'
  const title = `You have ${count} Qada ${word} remaining.`
  const body = 'Make them up at your own pace.'
  sendNotification(title, body, todayTag('qada-remaining'), '/qada')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyLaqabUnlocked(laqabName: string, requirementDays: number) {
  if (!isNotificationEnabled('laqab_notifications')) return
  const title = 'New Laqab unlocked'
  const body = `Alhamdulillah — ${laqabName} (${requirementDays} days of consistency).`
  sendNotification(title, body, `laqab-unlock-${laqabName.toLowerCase()}`, '/laqabs')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyFriendRequest(fromName: string) {
  if (!isNotificationEnabled('friend_request_notifications')) return
  const title = 'Friend request'
  const body = `${fromName} sent you a friend request.`
  sendNotification(title, body, `friend-req-${Date.now()}`, '/friends/requests')
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyChallengeInvite(fromName: string, challengeName: string, challengeId: string) {
  if (!isNotificationEnabled('challenge_notifications')) return
  const title = 'Challenge invitation'
  const body = `${fromName} invited you to ${challengeName}.`
  sendNotification(title, body, `challenge-invite-${challengeId}`, `/friends/challenges/${challengeId}`)
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyChallengeStarting(challengeName: string, challengeId: string) {
  if (!isNotificationEnabled('challenge_notifications')) return
  const title = 'Challenge starting'
  const body = `Your ${challengeName} challenge starts today.`
  sendNotification(title, body, todayTag(`challenge-start-${challengeId}`), `/friends/challenges/${challengeId}`)
  void sendEmailNotificationIfEnabled(title, body)
}

export function notifyChallengeEnding(challengeName: string, challengeId: string) {
  if (!isNotificationEnabled('challenge_notifications')) return
  const title = 'Challenge ending soon'
  const body = `Your ${challengeName} challenge ends tomorrow.`
  sendNotification(title, body, todayTag(`challenge-end-${challengeId}`), `/friends/challenges/${challengeId}`)
  void sendEmailNotificationIfEnabled(title, body)
}

/** @deprecated Auto-miss no longer sends guilt notifications — use notifyIncompletePrayer */
export function notifyMissedPrayer(_prayerName: string) {}

/** @deprecated Qada added silently on auto-miss — use notifyQadaRemaining daily */
export function notifyQadaAdded(_prayerName: string) {}

/** Streak break is not announced — avoids guilt-based messaging */
export function notifyStreakBroken(_previousStreak: number) {}

/** @deprecated Use notifyPrayerTimeArrived */
export function notifyPrayerReminder(prayerName: string, _timeLabel: string, prayerKey?: string) {
  notifyPrayerTimeArrived(prayerName, prayerKey ?? prayerName.toLowerCase())
}
