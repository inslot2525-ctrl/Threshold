import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@/lib/store'
import type { HomeEvent, Incident } from '@/lib/types'

const person = vi.fn<() => Promise<boolean>>()
const ingested: HomeEvent[] = []
const incidents: Incident[] = []

vi.mock('@/lib/ai/labels', () => ({ detectPerson: () => person() }))
vi.mock('@/lib/runtime', () => ({
  getState: () => ({ settings: { ...defaultSettings(), doorSensorId: 'door', outdoorCameraId: 'cam' }, incidents }),
  ingest: (e: HomeEvent) => ingested.push(e),
}))

const { onPhoneMotion } = await import('@/lib/phonewatch')
const frame = Buffer.from([0xff, 0xd8, 0xff])

describe('phone camera as door sensor + camera', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ingested.length = 0
    incidents.length = 0
    person.mockReset()
  })

  it('turns a person walking through into door open, close and person motion', async () => {
    vi.setSystemTime(1_000_000)
    person.mockResolvedValue(true)
    await onPhoneMotion(frame)
    expect(ingested.map((e) => `${e.type}:${e.deviceId}:${e.subType ?? ''}`)).toEqual([
      'contact_sensor_faulted:door:',
      'contact_sensor_cleared:door:',
      'motion_detected:cam:human',
    ])
  })

  it('ignores motion with no person, and a person who stays in frame', async () => {
    vi.setSystemTime(2_000_000)
    person.mockResolvedValue(false)
    await onPhoneMotion(frame)
    expect(ingested).toHaveLength(0)

    person.mockResolvedValue(true)
    vi.setSystemTime(2_002_000)
    await onPhoneMotion(frame)
    vi.setSystemTime(2_004_000)
    await onPhoneMotion(frame)
    expect(ingested).toHaveLength(3)

    // Back in frame after a quiet spell: a new trip through the door.
    vi.setSystemTime(2_030_000)
    await onPhoneMotion(frame)
    expect(ingested).toHaveLength(6)
  })
})
