// Wires the pure engine to storage, Ring, Bedrock and alerts. One instance per server process.

import { randomBytes, randomUUID } from 'node:crypto'
import { describeSnapshot, imageFormat, isAiEnabled } from '@/lib/ai/describe'
import { activeIncident, handleEvent, resolveIncident, tick, type Effect } from '@/lib/engine/detector'
import { alertText, publishChange, returnedText, sendExternal } from '@/lib/notify'
import { isRingConfigured } from '@/lib/ring/auth'
import { downloadSnapshot, listDevices } from '@/lib/ring/client'
import {
  SIM_CAMERA_ID,
  SIM_DEVICES,
  SIM_DOOR_ID,
  demoSnapshot,
  historyIncidents,
  isSimulatorEnabled,
} from '@/lib/simulator'
import { loadState, saveState, writeSnapshot, type State } from '@/lib/store'
import type { HomeEvent, Incident, Settings } from '@/lib/types'

const TICK_MS = 2000
/** Ring may record the clip slightly before the motion webhook is sent. */
const SNAPSHOT_LOOKBACK_MS = 60_000

const ids = {
  id: () => randomUUID(),
  token: () => randomBytes(16).toString('base64url'),
}

interface Runtime {
  state: State
  timer: NodeJS.Timeout
}

const g = globalThis as unknown as { __thresholdRuntime?: Runtime }

function commit(state: State) {
  saveState(state)
  publishChange()
}

function note(incident: Incident, text: string) {
  incident.timeline.push({ at: Date.now(), text })
}

export function getState(): State {
  if (!g.__thresholdRuntime) {
    const state = loadState()
    if (isSimulatorEnabled()) {
      if (!state.devices.some((d) => d.source === 'simulator')) state.devices.push(...SIM_DEVICES)
      state.settings.doorSensorId ??= SIM_DOOR_ID
      state.settings.outdoorCameraId ??= SIM_CAMERA_ID
    }
    const timer = setInterval(runTick, TICK_MS)
    timer.unref?.()
    g.__thresholdRuntime = { state, timer }
  }
  return g.__thresholdRuntime.state
}

function runTick() {
  const state = getState()
  const before = activeIncident(state.incidents)?.state
  const effects = tick(state.incidents, state.settings, Date.now())
  if (effects.length || activeIncident(state.incidents)?.state !== before) {
    commit(state)
    void runEffects(effects)
  }
}

/** Returns false if this delivery was already processed. */
export function ingest(event: HomeEvent): boolean {
  const state = getState()
  if (state.processedRequestIds.includes(event.requestId)) return false
  state.processedRequestIds.push(event.requestId)
  state.events.unshift(event)

  const effects = handleEvent(state.incidents, state.settings, event, ids)
  commit(state)
  void runEffects(effects)
  return true
}

async function runEffects(effects: Effect[]) {
  for (const effect of effects) {
    try {
      if (effect.kind === 'fetch_snapshot') await captureAndDescribe(effect.incidentId, effect.cameraId, effect.at)
      if (effect.kind === 'alert') await sendAlert(effect.incidentId)
      if (effect.kind === 'returned_after_alert') await sendReturned(effect.incidentId)
    } catch (error) {
      console.error(`[runtime] ${effect.kind} failed`, error)
    }
  }
}

function findIncident(id: string): Incident | undefined {
  return getState().incidents.find((i) => i.id === id)
}

async function captureAndDescribe(incidentId: string, cameraId: string, at: number) {
  const state = getState()
  const incident = findIncident(incidentId)
  if (!incident) return
  const camera = state.devices.find((d) => d.id === cameraId)

  // Encrypted cameras still answer, but with media we can't read. Don't try.
  if (camera?.e2eEncrypted) {
    incident.snapshot = { status: 'unavailable', reason: 'encrypted' }
    note(incident, 'Camera is end-to-end encrypted. Continuing with door and motion data only')
    return commit(state)
  }

  let image: Buffer | null
  try {
    image =
      camera?.source === 'simulator'
        ? demoSnapshot()
        : await downloadSnapshot(cameraId, at - SNAPSHOT_LOOKBACK_MS)
    if (!image) throw new Error('No demo image found in demo-assets/')
  } catch (error) {
    incident.snapshot = { status: 'unavailable', reason: 'error', detail: String(error) }
    note(incident, 'Could not get a photo from the camera')
    return commit(state)
  }

  const file = writeSnapshot(incident.id, image, imageFormat(image) === 'png' ? 'png' : 'jpg')
  incident.snapshot = { status: 'ok', file, capturedAt: at }
  note(incident, 'Photo saved from the porch camera')
  commit(state)

  if (!isAiEnabled()) return
  try {
    incident.description = await describeSnapshot(image)
    note(incident, 'Description ready for searchers')
  } catch (error) {
    console.error('[runtime] Bedrock describe failed', error)
    note(incident, 'Could not generate a description. Photo is still available')
  }
  commit(state)
}

async function sendAlert(incidentId: string) {
  const state = getState()
  const incident = findIncident(incidentId)
  if (!incident) return
  const sent = await sendExternal(`${state.settings.personName} left home`, alertText(incident, state.settings))
  note(incident, sent ? 'Text alert sent via Amazon SNS' : 'Dashboard alert shown (SNS not configured)')
  commit(state)
}

async function sendReturned(incidentId: string) {
  const state = getState()
  const incident = findIncident(incidentId)
  if (!incident) return
  const sent = await sendExternal(`${state.settings.personName} may be back`, returnedText(incident, state.settings))
  if (sent) note(incident, 'Follow-up text sent: door reopened')
  commit(state)
}

export function resolve(incidentId: string, outcome: 'safe' | 'false_alarm'): Incident | null {
  const state = getState()
  const incident = findIncident(incidentId)
  if (!incident) return null
  resolveIncident(incident, outcome, Date.now(), state.settings.caregiverName)
  commit(state)
  return incident
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const state = getState()
  state.settings = { ...state.settings, ...patch }
  commit(state)
  return state.settings
}

export async function refreshDevices() {
  const state = getState()
  const devices = isSimulatorEnabled() ? [...SIM_DEVICES] : []
  let error: string | null = null
  if (isRingConfigured()) {
    try {
      devices.unshift(...(await listDevices()))
    } catch (e) {
      error = String(e)
    }
  }
  state.devices = devices
  commit(state)
  return { devices, error }
}

export function seedHistory(): number {
  const state = getState()
  state.incidents = state.incidents.filter((i) => !i.simulated || activeIncident([i]))
  const seeded = historyIncidents(Date.now(), ids.id, ids.token)
  state.incidents.push(...seeded)
  state.incidents.sort((a, b) => b.doorOpenedAt - a.doorOpenedAt)
  commit(state)
  return seeded.length
}

export function clearSimulated() {
  const state = getState()
  state.incidents = state.incidents.filter((i) => !i.simulated)
  state.events = state.events.filter((e) => !e.simulated)
  commit(state)
}
