'use client'

// Live porch view over Ring's WHEP (WebRTC) API, adapted from the signaling flow in
// AmazonAppDev/ring-api-helloworld. Optionally grabs one frame for the incident photo.

import { useCallback, useEffect, useRef, useState } from 'react'

/** Let the picture settle (exposure, keyframe) before grabbing a frame. */
const CAPTURE_DELAY_MS = 1500

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

  const captureFrame = useCallback(async () => {
    const video = videoRef.current
    if (!captureForIncidentId || capturedRef.current || !video?.videoWidth) return
    capturedRef.current = true
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (blob) {
      await fetch(`/api/incidents/${captureForIncidentId}/frame`, { method: 'POST', body: blob }).catch(() => {})
    }
  }, [captureForIncidentId])

  const start = useCallback(async () => {
    await stop()
    setError(null)
    setStatus('connecting')
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pcRef.current = pc
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') setStatus('ended')
      }

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
            setTimeout(captureFrame, CAPTURE_DELAY_MS)
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
