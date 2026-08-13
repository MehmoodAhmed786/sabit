import { supabase } from './supabaseClient'

export type FriendProfile = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

export type FriendshipRow = {
  id: string
  requester_id: string
  receiver_id: string
  status: 'pending' | 'accepted' | 'declined' | 'blocked'
  created_at: string
  accepted_at: string | null
  friend: FriendProfile
  direction: 'incoming' | 'outgoing' | 'accepted'
}

export type SearchUser = FriendProfile

export async function activateDueChallenges() {
  await supabase.rpc('activate_due_challenges')
}

export async function searchUsers(query: string): Promise<SearchUser[]> {
  const { data, error } = await supabase.rpc('search_users_for_friend', { p_query: query })
  if (error) throw error
  return (data ?? []) as SearchUser[]
}

export async function sendFriendRequest(targetId: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_friend_request', { p_target_id: targetId })
  if (error) throw error
  return data as string
}

export async function acceptFriendRequest(friendshipId: string) {
  const { error } = await supabase.rpc('respond_friend_request', {
    p_friendship_id: friendshipId,
    p_accept: true,
  })
  if (error) throw error
}

export async function declineFriendRequest(friendshipId: string) {
  const { error } = await supabase.rpc('respond_friend_request', {
    p_friendship_id: friendshipId,
    p_accept: false,
  })
  if (error) throw error
}

export async function removeFriend(friendshipId: string) {
  const { error } = await supabase.rpc('remove_friend', { p_friendship_id: friendshipId })
  if (error) throw error
}

export async function blockUser(userId: string) {
  const { error } = await supabase.rpc('block_user', { p_user_id: userId })
  if (error) throw error
}

async function loadProfiles(ids: string[]): Promise<Map<string, FriendProfile>> {
  if (!ids.length) return new Map()
  const { data, error } = await supabase.rpc('get_friend_profiles', { p_user_ids: ids })
  if (error) throw error
  return new Map((data ?? []).map((p: FriendProfile) => [p.id, p]))
}

export async function loadFriendsHub(userId: string): Promise<{
  friends: FriendshipRow[]
  incoming: FriendshipRow[]
  outgoing: FriendshipRow[]
}> {
  const { data, error } = await supabase
    .from('friends')
    .select('*')
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false })

  if (error) throw error

  const rows = data ?? []
  const otherIds = rows.map((r) => (r.requester_id === userId ? r.receiver_id : r.requester_id))
  const profiles = await loadProfiles(otherIds)

  const mapRow = (r: (typeof rows)[0]): FriendshipRow => {
    const otherId = r.requester_id === userId ? r.receiver_id : r.requester_id
    const friend = profiles.get(otherId) ?? {
      id: otherId,
      username: 'user',
      display_name: 'User',
      avatar_url: null,
    }
    let direction: FriendshipRow['direction'] = 'accepted'
    if (r.status === 'pending') {
      direction = r.receiver_id === userId ? 'incoming' : 'outgoing'
    }
    return { ...r, friend, direction } as FriendshipRow
  }

  const mapped = rows.map(mapRow)
  return {
    friends: mapped.filter((r) => r.status === 'accepted'),
    incoming: mapped.filter((r) => r.status === 'pending' && r.direction === 'incoming'),
    outgoing: mapped.filter((r) => r.status === 'pending' && r.direction === 'outgoing'),
  }
}

export async function getInviteCode(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('invite_code')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.invite_code ?? null
}

export function emitFriendsUpdated() {
  window.dispatchEvent(new Event('sabit-friends-updated'))
}
