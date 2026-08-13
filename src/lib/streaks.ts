import { supabase } from './supabaseClient'
import { getPrayerScheduleForToday, PRAYER_KEYS, localDateString, parseLocalDate, addDays } from '../utils/prayerUtils'

type StreakRow = {
  current_streak: number
  longest_streak: number
  last_qualifying_date: string | null
  last_evaluated_date?: string | null
}

/** Calendar date of the islamic day that just closed at today's Fajr. */
export function getLastClosedDayDate(fajrToday: Date, now = new Date()): Date | null {
  if (now < fajrToday) return null
  const closed = new Date(fajrToday)
  closed.setDate(closed.getDate() - 1)
  closed.setHours(0, 0, 0, 0)
  return closed
}

export async function dayFullyCompleted(userId: string, date: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('prayer_records')
    .select('prayer_name, status')
    .eq('user_id', userId)
    .eq('date', date)
  if (error) throw error
  const completed = new Set(
    (data ?? []).filter((r) => r.status === 'completed').map((r) => r.prayer_name.toLowerCase()),
  )
  return PRAYER_KEYS.every((k) => completed.has(k))
}

async function fetchStreakRow(userId: string): Promise<StreakRow> {
  const { data, error } = await supabase
    .from('streaks')
    .select('current_streak,longest_streak,last_qualifying_date,last_evaluated_date')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    current_streak: data?.current_streak ?? 0,
    longest_streak: data?.longest_streak ?? 0,
    last_qualifying_date: data?.last_qualifying_date ?? null,
    last_evaluated_date: data?.last_evaluated_date ?? null,
  }
}

async function saveStreak(
  userId: string,
  patch: Partial<StreakRow> & { current_streak: number; longest_streak: number },
) {
  const { error } = await supabase.from('streaks').upsert(
    {
      user_id: userId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

/**
 * At each Fajr, evaluate closed days since last evaluation.
 * Streak breaks if any day did not have all 5 prayers completed before next Fajr.
 */
export async function reconcileStreak(userId: string): Promise<{ broke: boolean; previous: number; current: number }> {
  const schedule = await getPrayerScheduleForToday()
  const fajrToday = schedule.find((p) => p.key === 'fajr')?.startsAt
  if (!fajrToday) return { broke: false, previous: 0, current: 0 }

  const evaluateUpTo = getLastClosedDayDate(fajrToday)
  if (!evaluateUpTo) return { broke: false, previous: 0, current: 0 }

  const row = await fetchStreakRow(userId)
  const previous = row.current_streak
  const evaluateUpToStr = localDateString(evaluateUpTo)

  if (row.last_evaluated_date && row.last_evaluated_date >= evaluateUpToStr) {
    return { broke: false, previous, current: previous }
  }

  const lastEval = row.last_evaluated_date ? parseLocalDate(row.last_evaluated_date) : null
  let cursor = lastEval ? addDays(lastEval, 1) : addDays(evaluateUpTo, -60)
  const oldest = addDays(evaluateUpTo, -90)
  if (cursor < oldest) cursor = oldest

  let current = row.current_streak
  let longest = row.longest_streak
  let lastQual = row.last_qualifying_date

  while (cursor <= evaluateUpTo) {
    const dateStr = localDateString(cursor)
    if (await dayFullyCompleted(userId, dateStr)) {
      current += 1
      longest = Math.max(longest, current)
      lastQual = dateStr
    } else {
      current = 0
    }
    cursor = addDays(cursor, 1)
  }

  await saveStreak(userId, {
    current_streak: current,
    longest_streak: longest,
    last_qualifying_date: lastQual,
    last_evaluated_date: evaluateUpToStr,
  })

  return { broke: previous > 0 && current === 0, previous, current }
}

/** Increment streak immediately when all 5 prayers are completed today. */
export async function tryIncrementStreakForToday(userId: string, today = localDateString()): Promise<boolean> {
  if (!(await dayFullyCompleted(userId, today))) return false

  const row = await fetchStreakRow(userId)
  if (row.last_qualifying_date === today) return false

  const current = row.current_streak + 1
  const longest = Math.max(row.longest_streak, current)

  await saveStreak(userId, {
    current_streak: current,
    longest_streak: longest,
    last_qualifying_date: today,
    last_evaluated_date: today,
  })
  return true
}

export async function getCurrentStreak(userId: string): Promise<number> {
  const row = await fetchStreakRow(userId)
  return row.current_streak
}
