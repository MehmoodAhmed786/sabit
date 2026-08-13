import { supabase } from './supabaseClient'

/** DB stores lowercase prayer names; UI shows title case. */
export function toDbPrayerName(name: string) {
  return name.toLowerCase()
}

export function toDisplayPrayerName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

export async function ensureProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (existing) return

  const base = (user.email?.split('@')[0] ?? 'user').toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const safeBase = base.length >= 3 ? base : 'user'
  const username = `${safeBase}_${user.id.replace(/-/g, '').slice(0, 4)}`.slice(0, 20)

  await supabase.from('profiles').insert({
    id: user.id,
    username,
    display_name: user.user_metadata?.full_name ?? safeBase,
    avatar_url: user.user_metadata?.avatar_url ?? null,
  })

  await supabase.from('streaks').upsert(
    { user_id: user.id, current_streak: 0, longest_streak: 0 },
    { onConflict: 'user_id' },
  )

  await supabase.from('user_settings').upsert(
    { user_id: user.id },
    { onConflict: 'user_id' },
  )
}

export const LAQAB_TOTAL = 12
