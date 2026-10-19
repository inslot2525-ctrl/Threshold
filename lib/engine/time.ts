import type { Settings } from '@/lib/types'

/** Minutes since local midnight for `at` in the given IANA timezone. */
export function localMinutes(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

/** Whether an exit at `at` should be watched. Handles windows that cross midnight. */
export function isArmed(at: number, settings: Settings): boolean {
  if (settings.armMode === 'always') return true
  if (settings.armMode === 'off') return false

  const now = localMinutes(at, settings.timezone)
  const start = parseHHMM(settings.windowStart)
  const end = parseHHMM(settings.windowEnd)
  if (start === end) return true
  return start < end ? now >= start && now < end : now >= start || now < end
}

export function formatClock(at: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at))
}
