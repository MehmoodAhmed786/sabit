import { supabase } from './supabaseClient'

export type PrayerRecord = {
  id: string
  user_id: string
  date: string
  prayer_name: string
  status: 'upcoming' | 'completed' | 'missed'
}

export type QadaRecord = {
  id: string
  original_date: string
  prayer_name: string
  status: 'pending' | 'made_up'
}

export type PeriodRange = { start: string | null; end: string }

export function inPeriod(date: string, range: PeriodRange) {
  if (!range.start) return true
  return date >= range.start && date <= range.end
}

export function computeProgressStats(
  records: PrayerRecord[],
  qadaRecords: QadaRecord[],
  periodRange: PeriodRange,
  daysCount: number,
) {
  const filtered = periodRange.start
    ? records.filter((r) => r.date >= periodRange.start! && r.date <= periodRange.end)
    : records

  const qadaInPeriod = qadaRecords.filter((q) => inPeriod(q.original_date, periodRange))
  const pendingQada = qadaInPeriod.filter((q) => q.status === 'pending')
  const madeUpQada = qadaInPeriod.filter((q) => q.status === 'made_up')

  const onTimeCompleted = filtered.filter((r) => r.status === 'completed')
  const missedRecords = filtered.filter((r) => r.status === 'missed')

  const qadaKey = (date: string, prayer: string) => `${date}:${prayer.toLowerCase()}`
  const pendingKeys = new Set(pendingQada.map((q) => qadaKey(q.original_date, q.prayer_name)))

  const orphanMissed = missedRecords.filter(
    (r) => !qadaRecords.some(
      (q) => q.original_date === r.date && q.prayer_name.toLowerCase() === r.prayer_name.toLowerCase(),
    ),
  )
  const missedCount =
    pendingQada.length +
    orphanMissed.filter((r) => !pendingKeys.has(qadaKey(r.date, r.prayer_name))).length

  const completedCount = onTimeCompleted.length + madeUpQada.length
  const totalExpected = daysCount * 5
  const completionPct = totalExpected
    ? Math.round((completedCount / totalExpected) * 1000) / 10
    : 100

  const prayerNames = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
  const prayerRates = prayerNames.map((name) => {
    const key = name.toLowerCase()
    const completed =
      onTimeCompleted.filter((r) => r.prayer_name.toLowerCase() === key).length +
      madeUpQada.filter((q) => q.prayer_name.toLowerCase() === key).length
    const pct = daysCount ? Math.round((completed / daysCount) * 1000) / 10 : 0
    return { name, pct, completed }
  })

  return {
    filtered,
    pendingQada,
    madeUpQada,
    missedCount,
    completedCount,
    completionPct,
    prayerRates,
    totalExpected,
  }
}

export async function markQadaMadeUp(userId: string, qadaId: string) {
  const { error } = await supabase
    .from('qada_records')
    .update({
      status: 'made_up',
      made_up_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', qadaId)
    .eq('user_id', userId)
  if (error) throw error
  window.dispatchEvent(new Event('sabit-prayer-updated'))
}
