// Weekly trend of night exits. A rise is an early sign that wandering risk is growing.

import type { Incident } from '@/lib/types'

export interface WeekBucket {
  weekStart: number
  exits: number
  doorOpenings: number
}

export interface Digest {
  weeks: WeekBucket[]
  thisWeek: number
  baseline: number
  message: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** "0" or "1.5", never "0.0". */
function perWeek(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function buildDigest(incidents: Incident[], now: number, weeks = 6): Digest {
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: now - (weeks - i) * WEEK_MS,
    exits: 0,
    doorOpenings: 0,
  }))

  for (const incident of incidents) {
    if (incident.state === 'false_alarm') continue
    const index = weeks - 1 - Math.floor((now - incident.doorOpenedAt) / WEEK_MS)
    if (index < 0 || index >= weeks) continue
    buckets[index].doorOpenings += 1
    if (incident.state !== 'no_exit') buckets[index].exits += 1
  }

  const thisWeek = buckets[weeks - 1].exits
  const previous = buckets.slice(0, -1)
  const baseline = previous.length
    ? previous.reduce((sum, b) => sum + b.exits, 0) / previous.length
    : 0

  let message: string
  if (thisWeek === 0) {
    message = 'No night exits this week.'
  } else if (thisWeek >= Math.max(2, baseline * 2)) {
    message = `${thisWeek} night exits this week, up from about ${perWeek(baseline)} a week. Worth raising with their doctor.`
  } else {
    message = `${thisWeek} night exit${thisWeek === 1 ? '' : 's'} this week, in line with the usual ${perWeek(baseline)} a week.`
  }

  return { weeks: buckets, thisWeek, baseline, message }
}
