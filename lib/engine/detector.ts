// The night-exit state machine. Pure: takes incidents + an event (or the clock)
// and returns side effects for the runtime to carry out. No I/O here.
//
//   door opens in risk window ──► watching
//   person seen outside within corroboration window ──► (snapshot requested)
//   return grace elapses, door not reopened ──► alerted
//   door reopens after closing ──► returned
//   nobody seen outside ──► no_exit (logged only)

import { formatClock, isArmed } from '@/lib/engine/time'
import { ACTIVE_STATES, type HomeEvent, type Incident, type Settings } from '@/lib/types'

export type Effect =
  | { kind: 'fetch_snapshot'; incidentId: string; cameraId: string; at: number }
  | { kind: 'alert'; incidentId: string }
  | { kind: 'returned_after_alert'; incidentId: string }

export interface IdSource {
  id(): string
  token(): string
}

/** Camera may catch the person a moment before the door sensor reports. */
const CAMERA_LEAD_MS = 5_000

const PERSON_SUBTYPES = new Set(['human'])

export function activeIncident(incidents: Incident[]): Incident | undefined {
  return incidents.find((i) => ACTIVE_STATES.includes(i.state))
}

function log(incident: Incident, at: number, text: string) {
  incident.timeline.push({ at, text })
}

export function isPersonMotion(event: HomeEvent, settings: Settings): boolean {
  if (event.type !== 'motion_detected') return false
  if (event.subType && PERSON_SUBTYPES.has(event.subType)) return true
  // Smart Alerts off: Ring sends plain "motion" with no classification.
  return settings.acceptGenericMotion && (!event.subType || event.subType === 'motion')
}

export function handleEvent(
  incidents: Incident[],
  settings: Settings,
  event: HomeEvent,
  ids: IdSource
): Effect[] {
  const effects: Effect[] = []
  const active = activeIncident(incidents)
  const tz = settings.timezone

  if (settings.doorSensorId && event.deviceId === settings.doorSensorId) {
    if (event.type === 'contact_sensor_faulted') {
      // An open after the door has already closed behind them means someone came back in.
      if (active?.doorClosedAt && event.at > active.doorClosedAt) {
        const wasAlerted = active.state === 'alerted'
        active.state = 'returned'
        active.resolvedAt = event.at
        log(active, event.at, `Door opened again at ${formatClock(event.at, tz)}, likely back inside`)
        if (wasAlerted) effects.push({ kind: 'returned_after_alert', incidentId: active.id })
        return effects
      }
      if (active) return effects // still open from the same exit

      if (!isArmed(event.at, settings)) return effects

      const incident: Incident = {
        id: ids.id(),
        shareToken: ids.token(),
        state: 'watching',
        doorOpenedAt: event.at,
        timeline: [],
        simulated: event.simulated,
      }
      log(incident, event.at, `Front door opened at ${formatClock(event.at, tz)}`)
      incidents.unshift(incident)
      return effects
    }

    if (event.type === 'contact_sensor_cleared' && active && !active.doorClosedAt) {
      active.doorClosedAt = event.at
      log(active, event.at, `Door closed at ${formatClock(event.at, tz)}`)
    }
    return effects
  }

  if (
    settings.outdoorCameraId &&
    event.deviceId === settings.outdoorCameraId &&
    active?.state === 'watching' &&
    !active.personSeenAt &&
    isPersonMotion(event, settings)
  ) {
    const elapsed = event.at - active.doorOpenedAt
    if (elapsed >= -CAMERA_LEAD_MS && elapsed <= settings.corroborationSeconds * 1000) {
      active.personSeenAt = event.at
      active.personSubType = event.subType
      log(active, event.at, `Person seen outside by the porch camera at ${formatClock(event.at, tz)}`)
      effects.push({
        kind: 'fetch_snapshot',
        incidentId: active.id,
        cameraId: settings.outdoorCameraId,
        at: event.at,
      })
    }
  }

  return effects
}

/** Advance timers. Call every few seconds. */
export function tick(incidents: Incident[], settings: Settings, now: number): Effect[] {
  const effects: Effect[] = []
  const incident = activeIncident(incidents)
  if (!incident || incident.state !== 'watching') return effects

  const sinceOpen = now - incident.doorOpenedAt
  const graceMs = settings.returnGraceSeconds * 1000
  const corroborationMs = settings.corroborationSeconds * 1000
  const hasCamera = Boolean(settings.outdoorCameraId)

  if (!incident.personSeenAt && hasCamera && sinceOpen > corroborationMs) {
    incident.state = 'no_exit'
    incident.resolvedAt = now
    log(incident, now, 'Nobody was seen outside. Logged, no alert sent')
    return effects
  }

  // Without a camera the door sensor is all we have, so alert on the door alone.
  if ((incident.personSeenAt || !hasCamera) && sinceOpen >= graceMs) {
    incident.state = 'alerted'
    incident.alertedAt = now
    const waited = sinceOpen < 60_000 ? `${Math.round(sinceOpen / 1000)}s` : `${Math.round(sinceOpen / 60_000)} min`
    log(incident, now, `Not back after ${waited}. Alert sent to caregiver`)
    if (!hasCamera) {
      incident.snapshot = { status: 'unavailable', reason: 'no_camera' }
    }
    effects.push({ kind: 'alert', incidentId: incident.id })
  }

  return effects
}

export function resolveIncident(
  incident: Incident,
  outcome: 'safe' | 'false_alarm',
  now: number,
  by: string
) {
  incident.state = outcome
  incident.resolvedAt = now
  log(incident, now, outcome === 'safe' ? `${by} marked safe` : `${by} marked as a false alarm`)
}
