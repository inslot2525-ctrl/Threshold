// Shared domain types for Threshold.

/** A Ring webhook event, normalized. Times are epoch milliseconds. */
export interface HomeEvent {
  requestId: string
  type: string
  /** motion_detected only: human | vehicle | package_delivery | other_motion | motion */
  subType?: string
  deviceId: string
  at: number
  receivedAt: number
  simulated: boolean
}

export type ArmMode = 'schedule' | 'always' | 'off'

export interface Settings {
  personName: string
  caregiverName: string
  timezone: string
  armMode: ArmMode
  /** Risk window in local "HH:MM". May cross midnight. */
  windowStart: string
  windowEnd: string
  /** How long after the door opens a person must be seen outside for it to count as an exit. */
  corroborationSeconds: number
  /** How long to wait for the door to reopen before alerting. */
  returnGraceSeconds: number
  /** Count plain "motion" (Smart Alerts off) as a person. */
  acceptGenericMotion: boolean
  doorSensorId: string | null
  outdoorCameraId: string | null
}

export type IncidentState =
  | 'watching' // door opened in the risk window, waiting to see if they come back
  | 'alerted' // caregiver has been notified
  | 'returned' // door reopened: likely back inside
  | 'safe' // caregiver confirmed safe
  | 'false_alarm'
  | 'no_exit' // door opened, but nobody was seen outside

export interface Description {
  summary: string
  clothing: string
  carrying: string
  direction: string
  concerns: string[]
  model: string
  generatedAt: number
}

export type Snapshot =
  | { status: 'ok'; file: string; capturedAt: number; source: 'recorded' | 'live' | 'demo' }
  | { status: 'unavailable'; reason: 'encrypted' | 'no_camera' | 'error'; detail?: string }

export interface TimelineEntry {
  at: number
  text: string
}

export interface Incident {
  id: string
  shareToken: string
  state: IncidentState
  doorOpenedAt: number
  doorClosedAt?: number
  personSeenAt?: number
  personSubType?: string
  alertedAt?: number
  resolvedAt?: number
  snapshot?: Snapshot
  description?: Description
  timeline: TimelineEntry[]
  simulated: boolean
}

export interface Device {
  id: string
  name: string
  source: 'ring' | 'simulator'
  /** From capabilities: a camera has `video`, a door/window sensor has `contact_detection`. */
  kind: 'camera' | 'contact_sensor' | 'other'
  online: boolean | null
  /** Cameras with TAKE/E2EE on return video we can't read. */
  e2eEncrypted: boolean
  hasVideo: boolean
}

export const ACTIVE_STATES: IncidentState[] = ['watching', 'alerted']
