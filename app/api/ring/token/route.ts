import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setPlaygroundToken } from '@/lib/ring/auth'
import { refreshDevices } from '@/lib/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Paste a 30-minute Ring Playground token from the dashboard instead of editing .env.local.
 * Local development only: refused unless the request comes from this machine.
 */
export async function POST(request: NextRequest) {
  // Tunnels such as ngrok present their public hostname, so only direct local requests match.
  // (Next.js adds X-Forwarded-For itself, so that header can't be used to tell them apart.)
  const host = request.headers.get('host') ?? ''
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  if (!isLocal || process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Token pasting is only available in local development' }, { status: 403 })
  }

  const parsed = z.object({ token: z.string().min(20) }).safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Paste the token from the Ring Playground' }, { status: 400 })

  try {
    const expiresAt = setPlaygroundToken(parsed.data.token.trim())
    const { devices, error } = await refreshDevices()
    return NextResponse.json({ expiresAt, devices: devices.length, error })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
