'use client'

// Turns a phone into the porch camera: point it at the door and it streams frames to Threshold.
// Camera access needs HTTPS, so open this page through `npm run dev:phone`.

import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'

const FRAME_MS = 250
const FRAME_WIDTH = 640

type Status = 'idle' | 'starting' | 'live' | 'error'

export default function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(0)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null)

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStatus('idle')
  }

  useEffect(() => stop, [])

  const start = async (deviceId?: string) => {
    stop()
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This page needs HTTPS for camera access. Open the https:// link, not http://.')
      return setStatus('error')
    }
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      setCameraId(track.getSettings().deviceId ?? null)
      // Labels (e.g. "Back Ultra Wide Camera") are only readable once permission is granted.
      const all = await navigator.mediaDevices.enumerateDevices()
      setCameras(all.filter((d) => d.kind === 'videoinput'))
      // Some phones reach the ultra-wide through zoom below 1x instead of a separate camera.
      const caps = (track.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number; step: number } }
      const current = (track.getSettings() as { zoom?: number }).zoom
      setZoom(caps.zoom ? { ...caps.zoom, value: current ?? 1 } : null)
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()

      const canvas = document.createElement('canvas')
      let busy = false
      timerRef.current = setInterval(async () => {
        if (busy || !video.videoWidth) return
        busy = true
        canvas.width = FRAME_WIDTH
        canvas.height = Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH)
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7))
        if (blob) {
          await fetch('/api/phonecam', { method: 'POST', body: blob })
            .then((r) => r.ok && setSent((n) => n + 1))
            .catch(() => {})
        }
        busy = false
      }, FRAME_MS)
      setStatus('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-porch text-ink">
          <Icon name="camera" className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-serif text-3xl leading-none text-paper">Porch camera</h1>
          <p className="mt-1 text-sm text-muted">This phone streams to the Threshold dashboard</p>
        </div>
      </header>

      <div className="relative overflow-hidden rounded-xl border border-line bg-black">
        <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
        <span className="tag absolute left-3 top-3 rounded-sm bg-black/75 px-2 py-1 text-white">
          {status === 'live' && <span className="blink h-1.5 w-1.5 rounded-full bg-alarm" />}
          {status === 'live' ? 'Streaming' : status === 'starting' ? 'Starting…' : 'Camera off'}
        </span>
        {status !== 'live' && status !== 'starting' && (
          <button className="btn-primary absolute inset-0 m-auto h-fit w-fit text-lg" onClick={() => start(cameraId ?? undefined)}>
            <Icon name="play" className="h-5 w-5" /> Start camera
          </button>
        )}
      </div>

      {status === 'live' && (
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-muted">{sent} frames sent</p>
          <button className="btn" onClick={stop}>Stop</button>
        </div>
      )}
      {cameras.length > 1 && (
        <div>
          <p className="label">Lens</p>
          <div className="flex flex-wrap gap-2">
            {cameras.map((c, i) => (
              <button
                key={c.deviceId}
                className={c.deviceId === cameraId ? 'btn-primary' : 'btn'}
                onClick={() => start(c.deviceId)}
              >
                {cameraLabel(c, i)}
              </button>
            ))}
          </div>
        </div>
      )}
      {zoom && status === 'live' && (
        <div>
          <label className="label" htmlFor="zoom">Zoom {zoom.value.toFixed(1)}x</label>
          <input
            id="zoom"
            type="range"
            className="w-full accent-[#F2B84B]"
            min={zoom.min}
            max={Math.min(zoom.max, 5)}
            step={zoom.step || 0.1}
            value={zoom.value}
            onChange={(e) => {
              const value = Number(e.target.value)
              setZoom({ ...zoom, value })
              const track = streamRef.current?.getVideoTracks()[0]
              track?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).catch(() => {})
            }}
          />
        </div>
      )}
      {error && <p className="rounded-lg border border-alarm/50 px-4 py-3 text-alarm">{error}</p>}
      <p className="text-sm text-muted">
        Point the back camera at the front door and keep this screen open. When someone leaves, Threshold takes
        the alert photo from this feed.
      </p>
    </main>
  )
}

/** Short, readable lens names; phones label them like "Back Ultra Wide Camera" or "camera2 2, facing back". */
function cameraLabel(camera: MediaDeviceInfo, index: number): string {
  const label = camera.label.toLowerCase()
  if (label.includes('ultra')) return 'Ultra wide'
  if (label.includes('tele')) return 'Telephoto'
  if (label.includes('front') || label.includes('user')) return 'Front'
  if (label.includes('dual') || label.includes('triple')) return 'Back (auto)'
  if (label.includes('back') || label.includes('rear') || label.includes('environment')) return `Back ${index + 1}`
  return camera.label || `Camera ${index + 1}`
}
