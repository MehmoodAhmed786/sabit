import { supabase } from './supabaseClient'
import type { FriendProfile } from './friends'

export type ChallengeMember = {
  user_id: string
  member_status: 'invited' | 'accepted' | 'declined' | 'left'
  display_name: string
  username: string
  avatar_url: string | null
  is_self: boolean
  progress_visible: boolean
  qualifying_days: number | null
  today_completed: number | null
}

export type ChallengeDetail = {
  id: string
  name: string
  type: string
  start_date: string
  end_date: string
  status: 'pending' | 'active' | 'completed' | 'cancelled'
  creator_id: string
  total_days: number
  current_day: number
  members: ChallengeMember[]
}

export type ChallengeSummary = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  creator_id: string
  member_status: string
  current_day: number
  total_days: number
}

type ChallengesSummaryResponse = {
  active: ChallengeSummary[]
  invites: (ChallengeSummary & { inviter?: FriendProfile })[]
  completed: ChallengeSummary[]
}

export async function loadMyChallenges(_userId: string): Promise<ChallengesSummaryResponse> {
  const { data, error } = await supabase.rpc('get_my_challenges_summary')
  if (error) throw error
  const payload = (data ?? { active: [], invites: [], completed: [] }) as ChallengesSummaryResponse
  return {
    active: payload.active ?? [],
    invites: payload.invites ?? [],
    completed: payload.completed ?? [],
  }
}

export async function getChallengeDetail(challengeId: string): Promise<ChallengeDetail> {
  const { data, error } = await supabase.rpc('get_challenge_detail', { p_challenge_id: challengeId })
  if (error) throw error
  return data as ChallengeDetail
}

export async function createChallenge(params: {
  name: string
  startDate: string
  endDate: string
  memberIds: string[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_friend_challenge', {
    p_name: params.name,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_member_ids: params.memberIds,
  })
  if (error) throw error
  return data as string
}

export async function acceptChallengeInvite(challengeId: string) {
  const { error } = await supabase.rpc('respond_challenge_invite', {
    p_challenge_id: challengeId,
    p_accept: true,
  })
  if (error) throw error
}

export async function declineChallengeInvite(challengeId: string) {
  const { error } = await supabase.rpc('respond_challenge_invite', {
    p_challenge_id: challengeId,
    p_accept: false,
  })
  if (error) throw error
}

export async function leaveChallenge(challengeId: string) {
  const { error } = await supabase.rpc('leave_challenge', { p_challenge_id: challengeId })
  if (error) throw error
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function formatChallengeDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export async function friendHasActiveChallenge(friendIds: string[], _userId: string): Promise<Set<string>> {
  if (!friendIds.length) return new Set()
  const { data, error } = await supabase.rpc('get_friend_ids_in_active_challenges', {
    p_friend_ids: friendIds,
  })
  if (error) throw error
  return new Set((data ?? []) as string[])
}
