import { describe, expect, it } from 'vitest'
import { handleEvent, tick } from '@/lib/engine/detector'
import { buildDigest } from '@/lib/engine/digest'
import { isArmed } from '@/lib/engine/time'
import { defaultSettings } from '@/lib/store'
import type { HomeEvent, Incident, Settings } from '@/lib/types'

const DOOR = 'door-1'
const CAM = 'cam-1'

// 2026-10-20 02:00 UTC
const NIGHT = Date.UTC(2026, 9, 20, 2, 0, 0)
// 2026-10-20 14:00 UTC
const DAY = Date.UTC(2026, 9, 20, 14, 0, 0)

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(),
    timezone: 'UTC',
    doorSensorId: DOOR,
    outdoorCameraId: CAM,
    corroborationSeconds: 90,
    returnGraceSeconds: 600,
    ...overrides,
  }
}

let n = 0
const ids = { id: () => `inc-${++n}`, token: () => `tok-${n}` }

function ev(type: string, deviceId: string, at: number, subType?: string): HomeEvent {
  return { requestId: `r-${++n}`, type, subType, deviceId, at, receivedAt: at, simulated: false }
}

function run(incidents: Incident[], s: Settings, events: HomeEvent[]) {
  return events.flatMap((e) => handleEvent(incidents, s, e, ids))
}

describe('risk window', () => {
  it('handles a window that crosses midnight', () => {
    const s = settings({ windowStart: '22:00', windowEnd: '06:00' })
    expect(isArmed(Date.UTC(2026, 9, 20, 23, 30), s)).toBe(true)
    expect(isArmed(Date.UTC(2026, 9, 20, 3, 0), s)).toBe(true)
    expect(isArmed(Date.UTC(2026, 9, 20, 6, 0), s)).toBe(false)
    expect(isArmed(Date.UTC(2026, 9, 20, 12, 0), s)).toBe(false)
  })

  it('respects always and off', () => {
    expect(isArmed(DAY, settings({ armMode: 'always' }))).toBe(true)
    expect(isArmed(NIGHT, settings({ armMode: 'off' }))).toBe(false)
  })

  it('uses the configured timezone', () => {
    // 02:00 UTC is 07:30 in Kolkata: outside a 22:00-06:00 window
    expect(isArmed(NIGHT, settings({ timezone: 'Asia/Kolkata' }))).toBe(false)
  })
})

describe('night exit', () => {
  it('alerts when a person leaves and the door does not reopen', () => {
    const s = settings()
    const incidents: Incident[] = []
    const effects = run(incidents, s, [
      ev('contact_sensor_faulted', DOOR, NIGHT),
      ev('contact_sensor_cleared', DOOR, NIGHT + 3_000),
      ev('motion_detected', CAM, NIGHT + 6_000, 'human'),
    ])
    expect(effects).toEqual([{ kind: 'fetch_snapshot', incidentId: incidents[0].id, cameraId: CAM, at: NIGHT + 6_000 }])
    expect(incidents[0].state).toBe('watching')

    expect(tick(incidents, s, NIGHT + 599_000)).toEqual([])
    expect(tick(incidents, s, NIGHT + 600_000)).toEqual([{ kind: 'alert', incidentId: incidents[0].id }])
    expect(incidents[0].state).toBe('alerted')
  })

  it('resolves as returned when the door reopens after closing', () => {
    const s = settings()
    const incidents: Incident[] = []
    run(incidents, s, [
      ev('contact_sensor_faulted', DOOR, NIGHT),
      ev('contact_sensor_cleared', DOOR, NIGHT + 3_000),
      ev('motion_detected', CAM, NIGHT + 6_000, 'human'),
      ev('contact_sensor_faulted', DOOR, NIGHT + 120_000),
    ])
    expect(incidents[0].state).toBe('returned')
    expect(tick(incidents, s, NIGHT + 700_000)).toEqual([])
  })

  it('sends a follow-up when they return after an alert', () => {
    const s = settings()
    const incidents: Incident[] = []
    run(incidents, s, [
      ev('contact_sensor_faulted', DOOR, NIGHT),
      ev('contact_sensor_cleared', DOOR, NIGHT + 3_000),
      ev('motion_detected', CAM, NIGHT + 6_000, 'human'),
    ])
    tick(incidents, s, NIGHT + 600_000)
    const effects = run(incidents, s, [ev('contact_sensor_faulted', DOOR, NIGHT + 900_000)])
    expect(effects).toEqual([{ kind: 'returned_after_alert', incidentId: incidents[0].id }])
  })

  it('logs a door opening with nobody outside as no_exit, without alerting', () => {
    const s = settings()
    const incidents: Incident[] = []
    run(incidents, s, [ev('contact_sensor_faulted', DOOR, NIGHT), ev('contact_sensor_cleared', DOOR, NIGHT + 4_000)])
    expect(tick(incidents, s, NIGHT + 91_000)).toEqual([])
    expect(incidents[0].state).toBe('no_exit')
  })

  it('ignores exits outside the risk window', () => {
    const incidents: Incident[] = []
    run(incidents, settings(), [ev('contact_sensor_faulted', DOOR, DAY)])
    expect(incidents).toHaveLength(0)
  })

  it('ignores vehicles, deliveries and animals on the camera', () => {
    const s = settings()
    const incidents: Incident[] = []
    const effects = run(incidents, s, [
      ev('contact_sensor_faulted', DOOR, NIGHT),
      ev('motion_detected', CAM, NIGHT + 5_000, 'vehicle'),
      ev('motion_detected', CAM, NIGHT + 6_000, 'package_delivery'),
      ev('motion_detected', CAM, NIGHT + 7_000, 'other_motion'),
    ])
    expect(effects).toEqual([])
    expect(incidents[0].personSeenAt).toBeUndefined()
  })

  it('only counts unclassified motion when allowed', () => {
    const incidents: Incident[] = []
    const strict = settings({ acceptGenericMotion: false })
    run(incidents, strict, [ev('contact_sensor_faulted', DOOR, NIGHT), ev('motion_detected', CAM, NIGHT + 5_000, 'motion')])
    expect(incidents[0].personSeenAt).toBeUndefined()

    const loose: Incident[] = []
    run(loose, settings(), [ev('contact_sensor_faulted', DOOR, NIGHT), ev('motion_detected', CAM, NIGHT + 5_000, 'motion')])
    expect(loose[0].personSeenAt).toBe(NIGHT + 5_000)
  })

  it('ignores a person seen long after the door opened', () => {
    const incidents: Incident[] = []
    run(incidents, settings(), [ev('contact_sensor_faulted', DOOR, NIGHT), ev('motion_detected', CAM, NIGHT + 200_000, 'human')])
    expect(incidents[0].personSeenAt).toBeUndefined()
  })

  it('alerts on the door alone when there is no outdoor camera', () => {
    const s = settings({ outdoorCameraId: null })
    const incidents: Incident[] = []
    run(incidents, s, [ev('contact_sensor_faulted', DOOR, NIGHT), ev('contact_sensor_cleared', DOOR, NIGHT + 3_000)])
    expect(tick(incidents, s, NIGHT + 600_000)).toEqual([{ kind: 'alert', incidentId: incidents[0].id }])
    expect(incidents[0].snapshot).toEqual({ status: 'unavailable', reason: 'no_camera' })
  })

  it('does not open a second incident while one is active', () => {
    const incidents: Incident[] = []
    run(incidents, settings(), [ev('contact_sensor_faulted', DOOR, NIGHT), ev('contact_sensor_faulted', DOOR, NIGHT + 1_000)])
    expect(incidents).toHaveLength(1)
  })
})

describe('weekly digest', () => {
  it('flags a rise in night exits', () => {
    const week = 7 * 24 * 60 * 60 * 1000
    const make = (at: number, state: Incident['state']): Incident => ({
      id: String(at),
      shareToken: 't',
      state,
      doorOpenedAt: at,
      timeline: [],
      simulated: false,
    })
    const now = NIGHT
    const incidents = [
      make(now - 1000, 'returned'),
      make(now - 2000, 'alerted'),
      make(now - 3000, 'safe'),
      make(now - 3 * week, 'returned'),
      make(now - 2 * week, 'no_exit'),
      make(now - 4000, 'false_alarm'),
    ]
    const digest = buildDigest(incidents, now)
    expect(digest.thisWeek).toBe(3)
    expect(digest.message).toMatch(/up from/)
  })
})
