import { PrayerTimes, Coordinates, CalculationMethod, Madhab } from 'adhan'

export type PrayerStatus = 'completed' | 'upcoming' | 'current' | 'missed'

export type PrayerSchedule = {
  key: string
  name: string
  time: string
  startsAt: Date
  endsAt: Date
  status: PrayerStatus
}

export const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const
export const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']

export function toDisplayPrayerName(name: string) {
  const key = name.toLowerCase()
  const idx = PRAYER_KEYS.indexOf(key as (typeof PRAYER_KEYS)[number])
  return idx >= 0 ? PRAYER_NAMES[idx] : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}
const FALLBACK_TIMES = ['5:01 AM', '12:30 PM', '4:45 PM', '7:08 PM', '8:32 PM']

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function parseTimeToday(timeStr: string): Date {
  const d = new Date()
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (!match) return d
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const meridiem = match[3]?.toUpperCase()
  if (meridiem === 'PM' && hours < 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0
  d.setHours(hours, minutes, 0, 0)
  return d
}

function getCoordinates(): Promise<Coordinates | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(new Coordinates(pos.coords.latitude, pos.coords.longitude)),
      () => resolve(null),
      { maximumAge: 1000 * 60 * 60 },
    )
  })
}

function buildSchedule(coords: Coordinates, date: Date): PrayerSchedule[] {
  const params = CalculationMethod.MuslimWorldLeague()
  params.madhab = Madhab.Shafi
  const times = new PrayerTimes(coords, date, params)
  const tomorrow = new Date(date)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextTimes = new PrayerTimes(coords, tomorrow, params)

  const starts = [times.fajr, times.dhuhr, times.asr, times.maghrib, times.isha]
  const ends = [times.dhuhr, times.asr, times.maghrib, times.isha, nextTimes.fajr]

  return PRAYER_KEYS.map((key, i) => ({
    key,
    name: PRAYER_NAMES[i],
    time: formatTime(starts[i]),
    startsAt: starts[i],
    endsAt: ends[i],
    status: 'upcoming' as PrayerStatus,
  }))
}

function buildFallbackSchedule(): PrayerSchedule[] {
  const starts = FALLBACK_TIMES.map(parseTimeToday)
  const ends = [
    starts[1],
    starts[2],
    starts[3],
    starts[4],
    (() => {
      const fajr = new Date(starts[0])
      fajr.setDate(fajr.getDate() + 1)
      return fajr
    })(),
  ]
  return PRAYER_KEYS.map((key, i) => ({
    key,
    name: PRAYER_NAMES[i],
    time: FALLBACK_TIMES[i],
    startsAt: starts[i],
    endsAt: ends[i],
    status: 'upcoming' as PrayerStatus,
  }))
}

/** Derive live status from clock + DB record (completed/missed are sticky). */
export function resolvePrayerStatus(
  prayer: Pick<PrayerSchedule, 'startsAt' | 'endsAt'>,
  dbStatus: string | undefined,
  now = new Date(),
): PrayerStatus {
  if (dbStatus === 'completed' || dbStatus === 'missed') return dbStatus
  if (now >= prayer.endsAt) return 'missed'
  if (now >= prayer.startsAt) return 'current'
  return 'upcoming'
}

export async function getPrayerScheduleForDate(date: Date): Promise<PrayerSchedule[]> {
  const coords = await getCoordinates()
  if (coords) {
    try {
      return buildSchedule(coords, date)
    } catch {
      return buildFallbackScheduleForDate(date)
    }
  }
  return buildFallbackScheduleForDate(date)
}

function buildFallbackScheduleForDate(date: Date): PrayerSchedule[] {
  const base = buildFallbackSchedule()
  const target = new Date(date)
  return base.map((p) => {
    const startsAt = new Date(p.startsAt)
    startsAt.setFullYear(target.getFullYear(), target.getMonth(), target.getDate())
    const endsAt = new Date(p.endsAt)
    endsAt.setFullYear(target.getFullYear(), target.getMonth(), target.getDate())
    if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1)
    return { ...p, startsAt, endsAt, time: formatTime(startsAt) }
  })
}

export async function getPrayerScheduleForToday(): Promise<PrayerSchedule[]> {
  return getPrayerScheduleForDate(new Date())
}

/** @deprecated use getPrayerScheduleForToday */
export async function getPrayerTimesForToday(): Promise<
  { key: string; name: string; time: string; status: PrayerStatus }[]
> {
  const schedule = await getPrayerScheduleForToday()
  const now = new Date()
  return schedule.map((p) => ({
    key: p.key,
    name: p.name,
    time: p.time,
    status: resolvePrayerStatus(p, undefined, now),
  }))
}

export function localDateString(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayDateString(d = new Date()) {
  return localDateString(d)
}

export function parseLocalDate(dateStr: string) {
  const [y, m, day] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function addDays(d: Date, days: number) {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  next.setHours(0, 0, 0, 0)
  return next
}
