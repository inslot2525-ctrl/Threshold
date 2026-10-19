import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getState } from '@/lib/runtime'
import { RingApiError, startWhepSession, stopWhepSession } from '@/lib/ring/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * WHEP signaling proxy for the live porch view. Always streams the configured outdoor
 * camera, never a device named by the client, and never an encrypted one.
 */
export async function POST(request: NextRequest) {
  const parsed = z.object({ sdpOffer: z.string().min(1) }).safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Missing sdpOffer' }, { status: 400 })

  const state = getState()
  const camera = state.devices.find((d) => d.id === state.settings.outdoorCameraId)
  if (!camera || camera.source !== 'ring') {
    return NextResponse.json({ error: 'No Ring camera is set as the outdoor camera' }, { status: 409 })
  }
  if (camera.e2eEncrypted) {
    return NextResponse.json({ error: 'This camera is end-to-end encrypted; live view is unavailable to apps' }, { status: 409 })
  }

  try {
    return NextResponse.json(await startWhepSession(camera.id, parsed.data.sdpOffer))
  } catch (error) {
    const status = error instanceof RingApiError ? error.status : 502
    const message =
      status === 401
        ? 'Ring rejected the access token. It has probably expired: generate a new one in the Ring Playground and update RING_ACCESS_TOKEN.'
        : String(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  const parsed = z.object({ sessionUrl: z.string().url() }).safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Missing sessionUrl' }, { status: 400 })
  try {
    await stopWhepSession(parsed.data.sessionUrl)
    return NextResponse.json({ closed: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 })
  }
}
