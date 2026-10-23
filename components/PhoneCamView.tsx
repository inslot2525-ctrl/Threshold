'use client'

// The phone camera's feed (MJPEG from /api/phonecam), shown wherever the Ring live view would be.

import { useEffect, useState } from 'react'

/** The server closes each feed after 10 minutes; reconnect before then. */
const RECONNECT_MS = 5 * 60_000

export default function PhoneCamView() {
  const [session, setSession] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setSession(Date.now()), RECONNECT_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/phonecam?s=${session}`}
        alt="Live porch camera"
        className="aspect-video w-full object-cover"
        onError={() => setTimeout(() => setSession(Date.now()), 2000)}
      />
      <span className="tag absolute left-2 top-2 rounded-sm bg-black/75 px-2 py-1 text-white">
        <span className="blink h-1.5 w-1.5 rounded-full bg-alarm" />
        LIVE · Porch camera
      </span>
    </div>
  )
}
