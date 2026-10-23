// Turns the phone camera into the door sensor + porch camera pair. When the phone sees motion,
// Rekognition checks for a person; a person appearing after a quiet spell becomes the same
// door-open, door-close and person-motion events a Ring sensor and camera would send.

import { randomUUID } from 'node:crypto'
import { detectPerson } from '@/lib/ai/labels'
import { activeIncident } from '@/lib/engine/detector'
import { getState, ingest } from '@/lib/runtime'

/** At most one Rekognition check this often. */
const CHECK_EVERY_MS = 1500
/** A person seen again after this long with nobody in frame counts as a new trip through the door. */
const QUIET_MS = 10_000

const g = globalThis as unknown as { __thresholdPhoneWatch?: { checking: boolean; lastCheckAt: number; lastPersonAt: number } }
const watch = (g.__thresholdPhoneWatch ??= { checking: false, lastCheckAt: 0, lastPersonAt: 0 })

export async function onPhoneMotion(frame: Buffer) {
  if (getState().settings.usePhoneCamera === false) return
  const now = Date.now()
  if (watch.checking || now - watch.lastCheckAt < CHECK_EVERY_MS) return
  watch.checking = true
  watch.lastCheckAt = now

  const state = getState()
  let person: boolean
  try {
    person = await detectPerson(frame)
  } catch (error) {
    console.error('[phonewatch] person check failed', error)
    // Without Rekognition, fall back to the same rule as Ring cameras with Smart Alerts off.
    person = state.settings.acceptGenericMotion
  } finally {
    watch.checking = false
  }
  if (!person) return

  const newTrip = now - watch.lastPersonAt > QUIET_MS
  watch.lastPersonAt = now
  if (!newTrip) return

  const { doorSensorId, outdoorCameraId } = state.settings
  if (!doorSensorId) return
  // Already counting down on this exit; nothing to add.
  if (activeIncident(state.incidents)?.state === 'watching') return

  const event = (type: string, deviceId: string, at: number, subType?: string) =>
    ingest({ requestId: randomUUID(), type, subType, deviceId, at, receivedAt: Date.now(), simulated: false })

  // On an alerted incident this door-open reads as "came back in", as with a real sensor.
  event('contact_sensor_faulted', doorSensorId, now)
  event('contact_sensor_cleared', doorSensorId, now + 1000)
  if (outdoorCameraId) event('motion_detected', outdoorCameraId, now + 1000, 'human')
}
