'use client'

// Live porch view over Ring's WHEP (WebRTC) API, adapted from the signaling flow in
// AmazonAppDev/ring-api-helloworld. Optionally grabs one frame for the incident photo.

import { useCallback, useEffect, useRef, useState } from 'react'

/** Let the picture settle (exposure, keyframe) before grabbing a frame. */
const CAPTURE_DELAY_MS = 1500
const CAPTURE_RETRY_MS = 1000
const CAPTURE_MAX_TRIES = 15
/** 0-255. Night footage is dark but not this dark; below it the frame is effectively blank. */
const MIN_LUMA = 8

function averageLuma(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const { data } = ctx.getImageData(0, 0, width, height)
  let sum = 0
  let count = 0
  // Sample every 16th pixel; plenty for a brightness check.
  for (let i = 0; i < data.length; i += 64) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    count++
  }
  return count ? sum / count : 0
}

type Status = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

export default function LivePorchView({
  autoStart,
  captureForIncidentId,
}: {
  autoStart: boolean
  /** When set, the first good frame is sent to this incident as its photo. */
  captureForIncidentId?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sessionUrlRef = useRef<string | null>(null)
  const capturedRef = useRef(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(async () => {
    pcRef.current?.close()
    pcRef.current = null
    const sessionUrl = sessionUrlRef.current
    sessionUrlRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (sessionUrl) {
      await fetch('/api/live', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionUrl }),
      }).catch(() => {})
    }
  }, [])

  const captureFrame = useCallback(
    async function attempt(tries = 0): Promise<void> {
      const video = videoRef.current
      if (!captureForIncidentId || capturedRef.current || !video) return
      const retry = () => {
        if (tries < CAPTURE_MAX_TRIES) setTimeout(() => attempt(tries + 1), CAPTURE_RETRY_MS)
      }
      if (!video.videoWidth) return retry()

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0)
      // The first frames of a stream are often black; don't hand searchers a black photo.
      if (averageLuma(ctx, canvas.width, canvas.height) < MIN_LUMA) return retry()

      capturedRef.current = true
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob) {
        await fetch(`/api/incidents/${captureForIncidentId}/frame`, { method: 'POST', body: blob }).catch(() => {})
      }
    },
    [captureForIncidentId]
  )

  const start = useCallback(async () => {
    await stop()
    setError(null)
    setStatus('connecting')
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pcRef.current = pc
      // Handlers go on before createOffer, or early events can be missed.
      pc.ontrack = (e) => {
        const video = videoRef.current
        if (!video || e.track.kind !== 'video') return
        video.srcObject = e.streams[0] ?? new MediaStream([e.track])
        video.play().catch(() => {})
        // Ring ends live sessions after a while; don't keep showing "LIVE" over a frozen frame.
        e.track.onended = () => setStatus('ended')
        e.track.onmute = () => setStatus('ended')
        e.track.onunmute = () => setStatus('live')
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') setStatus('ended')
      }
      // Ring only accepts recvonly tracks; sendrecv audio (as in the hello-world sample) is unsupported.
      pc.addTransceiver('video', { direction: 'recvonly' })

      await pc.setLocalDescription(await pc.createOffer())
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve()
        const timeout = setTimeout(resolve, 3000)
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout)
            resolve()
          }
        }
      })

      const res = await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdpOffer: pc.localDescription!.sdp }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not start live view')
      sessionUrlRef.current = body.sessionUrl
      await pc.setRemoteDescription({ type: 'answer', sdp: body.sdpAnswer })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
      await stop()
    }
  }, [stop])

  useEffect(() => {
    if (autoStart) start()
    return () => {
      stop()
    }
  }, [autoStart, start, stop])

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-line bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="aspect-video w-full"
          onPlaying={() => {
            setStatus('live')
            setTimeout(() => captureFrame(), CAPTURE_DELAY_MS)
          }}
        />
        <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          {status === 'live' ? '● LIVE · Ring' : status === 'connecting' ? 'Connecting to Ring…' : 'Ring live view'}
        </span>
        {status !== 'live' && status !== 'connecting' && (
          <button className="btn-primary absolute inset-0 m-auto h-fit w-fit" onClick={start}>
            {status === 'idle' ? 'View porch live' : 'Reconnect'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-alarm">{error}</p>}
    </div>
  )
}
