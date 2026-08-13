import { supabase } from './supabaseClient'

export type PrivacySettings = {
  allow_friend_challenges: boolean
  allow_friends_see_challenge_progress: boolean
  allow_friend_requests: boolean
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  allow_friend_challenges: true,
  allow_friends_see_challenge_progress: true,
  allow_friend_requests: true,
}

export const PRIVACY_LABELS: { key: keyof PrivacySettings; label: string; hint?: string }[] = [
  { key: 'allow_friend_challenges', label: 'Allow Friend Challenges', hint: 'Participate in private consistency challenges' },
  { key: 'allow_friends_see_challenge_progress', label: 'Allow Friends to See Challenge Progress', hint: 'Friends see only high-level challenge progress, never your prayer history' },
  { key: 'allow_friend_requests', label: 'Allow Friend Requests', hint: 'Others can find and add you' },
]

export async function loadPrivacySettings(userId: string): Promise<PrivacySettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('allow_friend_challenges, allow_friends_see_challenge_progress, allow_friend_requests')
    .eq('user_id', userId)
    .maybeSingle()

  if (error && !error.message.includes('does not exist')) throw error
  return { ...DEFAULT_PRIVACY_SETTINGS, ...(data ?? {}) }
}

export async function savePrivacySettings(userId: string, patch: Partial<PrivacySettings>) {
  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}
