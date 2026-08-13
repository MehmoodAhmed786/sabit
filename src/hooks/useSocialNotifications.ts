import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isNotificationEnabled } from '../lib/notificationSettings'
import { notifyChallengeInvite, notifyFriendRequest } from '../lib/notifications'

export function useSocialNotifications(userId: string | undefined) {
  const seenFriends = useRef<Set<string>>(new Set())
  const seenInvites = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`social-notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'friends', filter: `receiver_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as { id: string; status: string; requester_id: string }
          if (row.status !== 'pending') return
          if (seenFriends.current.has(row.id)) return
          if (!isNotificationEnabled('friend_request_notifications')) return
          seenFriends.current.add(row.id)

          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', row.requester_id)
            .maybeSingle()

          notifyFriendRequest(profile?.display_name ?? 'Someone')
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'challenge_members', filter: `user_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as { id: string; challenge_id: string; status: string }
          if (row.status !== 'invited') return
          if (seenInvites.current.has(row.id)) return
          if (!isNotificationEnabled('challenge_notifications')) return
          seenInvites.current.add(row.id)

          const { data: challenge } = await supabase
            .from('friend_challenges')
            .select('id, name, creator_id')
            .eq('id', row.challenge_id)
            .maybeSingle()

          if (!challenge) return

          const { data: creator } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', challenge.creator_id)
            .maybeSingle()

          notifyChallengeInvite(creator?.display_name ?? 'A friend', challenge.name, challenge.id)
        },
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [userId])
}
