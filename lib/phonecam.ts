// A phone browser standing in as the porch camera. The /camera page posts JPEG frames here;
// dashboards watch them as an MJPEG stream, and a new incident takes its photo from the latest one.

import { EventEmitter } from 'node:events'
import { publishChange } from '@/lib/notify'

/** No frame for this long and the phone counts as disconnected. */
const LIVE_WINDOW_MS = 5000

interface PhoneCam {
  frame: Buffer | null
  at: number
  frames: EventEmitter
}

const g = globalThis as unknown as { __thresholdPhoneCam?: PhoneCam }
const cam = (g.__thresholdPhoneCam ??= { frame: null, at: 0, frames: new EventEmitter().setMaxListeners(50) })

export function isPhoneCamLive(now = Date.now()): boolean {
  return Boolean(cam.frame) && now - cam.at < LIVE_WINDOW_MS
}

export function pushPhoneFrame(frame: Buffer) {
  const wasLive = isPhoneCamLive()
  cam.frame = frame
  cam.at = Date.now()
  cam.frames.emit('frame', frame)
  // Dashboards learn about the phone through /api/state, so ping them when it (re)connects.
  if (!wasLive) publishChange()
}

/** The latest frame, if the phone is still sending. */
export function latestPhoneFrame(): Buffer | null {
  return isPhoneCamLive() ? cam.frame : null
}

export function onPhoneFrame(listener: (frame: Buffer) => void): () => void {
  cam.frames.on('frame', listener)
  return () => cam.frames.off('frame', listener)
}
