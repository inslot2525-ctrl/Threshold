'use client'

// Makes whatever device has the dashboard open ring like a phone call when an alert fires:
// a loud two-tone ring, vibration where supported, and a full-screen red takeover until
// someone taps "I'm on it". Browsers only allow sound after a tap, so the device is armed once.

import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'

const RING_EVERY_MS = 2500
/** Ring, ring, pause: the rhythm people already answer to. */
const VIBRATE = [400, 200, 400, 1500]

type WakeLock = { release(): Promise<void> }

function ring(ctx: AudioContext) {
  const now = ctx.currentTime
  for (const [start, freq] of [[0, 880], [0.45, 660], [0.9, 880], [1.35, 660]] as const) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + start)
    gain.gain.exponentialRampToValueAtTime(0.35, now + start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + start)
    osc.stop(now + start + 0.42)
  }
}

export default function PhoneAlarm({
  alertId,
  personName,
  minutesOut,
}: {
  /** The incident currently in the alerted state, if any. */
  alertId: string | null
  personName: string
  minutesOut: number
}) {
  const ctxRef = useRef<AudioContext | null>(null)
  const wakeRef = useRef<WakeLock | null>(null)
  const [armed, setArmed] = useState(false)
  const [acknowledged, setAcknowledged] = useState<string | null>(null)

  const ringing = armed && alertId !== null && acknowledged !== alertId

  const arm = async () => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctxRef.current ??= new Ctx()
    await ctxRef.current.resume()
    // A short chirp confirms the sound works (and unlocks audio on iPhone).
    const osc = ctxRef.current.createOscillator()
    const gain = ctxRef.current.createGain()
    gain.gain.value = 0.15
    osc.frequency.value = 1200
    osc.connect(gain).connect(ctxRef.current.destination)
    osc.start()
    osc.stop(ctxRef.current.currentTime + 0.12)
    // Keep the screen on so the alarm isn't missed behind a locked phone.
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } }).wakeLock
    wakeRef.current = (await wakeLock?.request('screen').catch(() => null)) ?? null
    // Only ring for alerts that start from now on, not one already on screen.
    setAcknowledged(alertId)
    setArmed(true)
  }

  const disarm = () => {
    wakeRef.current?.release().catch(() => {})
    wakeRef.current = null
    setArmed(false)
  }

  useEffect(() => {
    if (!ringing) {
      navigator.vibrate?.(0)
      return
    }
    const go = () => {
      if (ctxRef.current) ring(ctxRef.current)
      navigator.vibrate?.(VIBRATE)
    }
    go()
    const timer = setInterval(go, RING_EVERY_MS)
    return () => {
      clearInterval(timer)
      navigator.vibrate?.(0)
    }
  }, [ringing])

  useEffect(() => () => wakeRef.current?.release().catch(() => {}) as unknown as void, [])

  if (ringing) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-alarm px-6 text-center text-ink" role="alertdialog" aria-live="assertive">
        <span className="blink grid h-24 w-24 place-items-center rounded-full bg-ink text-alarm">
          <Icon name="bell" className="h-12 w-12" />
        </span>
        <div>
          <p className="font-serif text-5xl leading-tight sm:text-7xl">{personName} has left home</p>
          <p className="mt-3 font-mono text-xl">{minutesOut} min out · front door</p>
        </div>
        <button className="rounded-xl bg-ink px-8 py-4 text-xl font-semibold text-paper" onClick={() => setAcknowledged(alertId)}>
          I&apos;m on it
        </button>
      </div>
    )
  }

  return (
    <button
      className={`fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg ${
        armed ? 'border-calm/40 bg-panel text-calm' : 'border-porch bg-porch text-ink'
      }`}
      onClick={armed ? disarm : arm}
      title={armed ? 'This device will ring on an alert. Tap to turn off.' : 'Ring this device when an alert fires'}
    >
      <Icon name="bell" className="h-4 w-4" />
      {armed ? 'Alarm on' : 'Ring this device on alerts'}
    </button>
  )
}
