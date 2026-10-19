// Demo simulator. Emits Ring-shaped, HMAC-signed webhooks into our own /api/webhook,
// so a demo exercises exactly the code path a real Ring account would.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildWebhook, signBody } from '@/lib/ring/webhook'
import type { Device, Incident } from '@/lib/types'

export const SIM_DOOR_ID = 'sim.front-door-contact-sensor'
export const SIM_CAMERA_ID = 'sim.porch-camera'

export function isSimulatorEnabled(): boolean {
  return process.env.SIMULATOR_ENABLED !== 'false'
}

export const SIM_DEVICES: Device[] = [
  { id: SIM_DOOR_ID, name: 'Front door (contact sensor)', source: 'simulator', kind: 'contact_sensor', online: true, e2eEncrypted: false, hasVideo: false },
  { id: SIM_CAMERA_ID, name: 'Porch camera', source: 'simulator', kind: 'camera', online: true, e2eEncrypted: false, hasVideo: true },
]

interface Step {
  afterMs: number
  type: string
  device: 'door' | 'camera'
  subType?: string
}

export const SCENARIOS: Record<string, { label: string; steps: Step[] }> = {
  night_exit: {
    label: 'Walks out and does not come back',
    steps: [
      { afterMs: 0, type: 'contact_sensor_faulted', device: 'door' },
      { afterMs: 3000, type: 'contact_sensor_cleared', device: 'door' },
      { afterMs: 5000, type: 'motion_detected', device: 'camera', subType: 'human' },
    ],
  },
  steps_out_returns: {
    label: 'Steps out, comes back in',
    steps: [
      { afterMs: 0, type: 'contact_sensor_faulted', device: 'door' },
      { afterMs: 3000, type: 'contact_sensor_cleared', device: 'door' },
      { afterMs: 5000, type: 'motion_detected', device: 'camera', subType: 'human' },
      { afterMs: 12000, type: 'contact_sensor_faulted', device: 'door' },
      { afterMs: 14000, type: 'contact_sensor_cleared', device: 'door' },
    ],
  },
  door_only: {
    label: 'Opens the door, nobody goes out',
    steps: [
      { afterMs: 0, type: 'contact_sensor_faulted', device: 'door' },
      { afterMs: 4000, type: 'contact_sensor_cleared', device: 'door' },
    ],
  },
  delivery: {
    label: 'Night delivery at the door (should be ignored)',
    steps: [
      { afterMs: 0, type: 'motion_detected', device: 'camera', subType: 'package_delivery' },
      { afterMs: 2000, type: 'button_press', device: 'camera' },
    ],
  },
}

/**
 * `cameraId` may be a real Ring camera (e.g. the Playground device): camera events are
 * then attributed to it, so the alert photo comes from Ring's real snapshot API.
 */
export function runScenario(name: string, webhookUrl: string, cameraId = SIM_CAMERA_ID): number {
  const scenario = SCENARIOS[name]
  if (!scenario) throw new Error(`Unknown scenario: ${name}`)
  const key = process.env.RING_HMAC_KEY

  for (const step of scenario.steps) {
    setTimeout(async () => {
      const body = JSON.stringify(
        buildWebhook({
          type: step.type,
          subType: step.subType,
          deviceId: step.device === 'door' ? SIM_DOOR_ID : cameraId,
          at: Date.now(),
          requestId: randomUUID(),
        })
      )
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Threshold-Simulated': '1',
            ...(key ? { 'X-Signature': signBody(key, body) } : {}),
          },
          body,
        })
      } catch (error) {
        console.error('[simulator] webhook post failed', error)
      }
    }, step.afterMs)
  }
  return scenario.steps.length
}

/** The porch "camera" for simulated devices: first image in demo-assets/. */
export function demoSnapshot(): Buffer | null {
  const dir = path.join(process.cwd(), 'demo-assets')
  try {
    const file = fs.readdirSync(dir).find((f) => /\.(jpe?g|png)$/i.test(f))
    return file ? fs.readFileSync(path.join(dir, file)) : null
  } catch {
    return null
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Past incidents for the weekly trend: quiet weeks, then night exits picking up.
 * Marked simulated so they're never confused with real history.
 */
export function historyIncidents(now: number, makeId: () => string, makeToken: () => string): Incident[] {
  // [weeks ago, night exits that week, door openings with no exit]
  const plan: [number, number, number][] = [
    [5, 0, 1],
    [4, 1, 1],
    [3, 0, 2],
    [2, 1, 1],
    [1, 2, 1],
    [0, 3, 1],
  ]
  const incidents: Incident[] = []
  for (const [weeksAgo, exits, openings] of plan) {
    for (let n = 0; n < exits + openings; n++) {
      const day = weeksAgo * 7 + (n % 6)
      const at = now - day * DAY_MS - (2 + n) * 60 * 60 * 1000
      if (at > now) continue
      const exited = n < exits
      incidents.push({
        id: makeId(),
        shareToken: makeToken(),
        state: exited ? 'returned' : 'no_exit',
        doorOpenedAt: at,
        doorClosedAt: at + 4000,
        personSeenAt: exited ? at + 6000 : undefined,
        resolvedAt: at + (exited ? 8 * 60 * 1000 : 90 * 1000),
        timeline: [{ at, text: 'Seeded history (simulated)' }],
        simulated: true,
      })
    }
  }
  return incidents.sort((a, b) => b.doorOpenedAt - a.doorOpenedAt)
}
