import {
  getNotificationSettings,
  isNotificationEnabled,
  prayerSettingKey,
} from './notificationSettings'

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
  sendNotification(
    `${prayerName} time has arrived.`,
    'May your Salah be accepted.',
    todayTag(`prayer-${prayerKey}`),
    prayerRoute(prayerKey),
  )
}

export function notifyPrePrayer(prayerName: string, prayerKey: string, minutes: number) {
  if (!isNotificationEnabled('notifications_enabled') || !isNotificationEnabled('pre_prayer_enabled')) return
  if (!getNotificationSettings()[prayerSettingKey(prayerKey)]) return
  sendNotification(
    `${prayerName} is in ${minutes} minutes.`,
    'Prepare for Salah.',
    todayTag(`pre-${prayerKey}`),
    prayerRoute(prayerKey),
  )
}

export function notifyIncompletePrayer(prayerName: string, prayerKey: string) {
  if (!isNotificationEnabled('incomplete_prayer_enabled')) return
  if (!getNotificationSettings()[prayerSettingKey(prayerKey)]) return
  sendNotification(
    `${prayerName} is still incomplete.`,
    'Take a moment when you are ready.',
    todayTag(`incomplete-${prayerKey}`),
    prayerRoute(prayerKey),
  )
}

export function notifyDailyCompletionRemaining(remaining: number) {
  if (!isNotificationEnabled('daily_completion_enabled')) return
  if (remaining <= 0) return
  const word = remaining === 1 ? 'prayer' : 'prayers'
  sendNotification(
    `You have ${remaining} ${word} remaining today.`,
    'Open Today to see your progress.',
    todayTag('daily-completion'),
    '/',
  )
}

export function notifyStreakReminder(streakDays: number) {
  if (!isNotificationEnabled('streak_notifications')) return
  if (streakDays <= 0) return
  sendNotification(
    `Keep your ${streakDays}-day streak going.`,
    'Complete today\'s prayers when you can.',
    todayTag('streak-reminder'),
    '/',
  )
}

export function notifyStreakAlmostComplete(streakDays: number) {
  if (!isNotificationEnabled('streak_notifications')) return
  if (streakDays <= 0) return
  sendNotification(
    'One more prayer to complete today\'s streak day.',
    `Your ${streakDays}-day streak is within reach.`,
    todayTag('streak-almost'),
    '/',
  )
}

export function notifyLaqabProgress(laqabName: string, daysRemaining: number) {
  if (!isNotificationEnabled('laqab_notifications')) return
  if (daysRemaining <= 0) return
  const dayWord = daysRemaining === 1 ? 'day' : 'days'
  sendNotification(
    `${daysRemaining} more ${dayWord} until ${laqabName}.`,
    'Stay consistent — you are making progress.',
    todayTag(`laqab-${laqabName}`),
    '/laqabs',
  )
}

export function notifyQadaRemaining(count: number) {
  if (!isNotificationEnabled('qada_notifications')) return
  if (count <= 0) return
  const word = count === 1 ? 'prayer' : 'prayers'
  sendNotification(
    `You have ${count} Qada ${word} remaining.`,
    'Make them up at your own pace.',
    todayTag('qada-remaining'),
    '/qada',
  )
}

export function notifyLaqabUnlocked(laqabName: string, requirementDays: number) {
  if (!isNotificationEnabled('laqab_notifications')) return
  sendNotification(
    'New Laqab unlocked',
    `Alhamdulillah — ${laqabName} (${requirementDays} days of consistency).`,
    `laqab-unlock-${laqabName.toLowerCase()}`,
    '/laqabs',
  )
}

export function notifyFriendRequest(fromName: string) {
  if (!isNotificationEnabled('friend_request_notifications')) return
  sendNotification(
    'Friend request',
    `${fromName} sent you a friend request.`,
    `friend-req-${Date.now()}`,
    '/friends/requests',
  )
}

export function notifyChallengeInvite(fromName: string, challengeName: string, challengeId: string) {
  if (!isNotificationEnabled('challenge_notifications')) return
  sendNotification(
    'Challenge invitation',
    `${fromName} invited you to ${challengeName}.`,
    `challenge-invite-${challengeId}`,
    `/friends/challenges/${challengeId}`,
  )
}

export function notifyChallengeStarting(challengeName: string, challengeId: string) {
  if (!isNotificationEnabled('challenge_notifications')) return
  sendNotification(
    'Challenge starting',
    `Your ${challengeName} challenge starts today.`,
    todayTag(`challenge-start-${challengeId}`),
    `/friends/challenges/${challengeId}`,
  )
}

export function notifyChallengeEnding(challengeName: string, challengeId: string) {
  if (!isNotificationEnabled('challenge_notifications')) return
  sendNotification(
    'Challenge ending soon',
    `Your ${challengeName} challenge ends tomorrow.`,
    todayTag(`challenge-end-${challengeId}`),
    `/friends/challenges/${challengeId}`,
  )
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
