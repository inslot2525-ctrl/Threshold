import { NextRequest, NextResponse } from 'next/server'
import { getState } from '@/lib/runtime'
import { readSnapshot } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Snapshot for an incident, addressed by its unguessable share token. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const incident = getState().incidents.find((i) => i.shareToken === token)
  if (incident?.snapshot?.status !== 'ok') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const image = readSnapshot(incident.snapshot.file)
  if (!image) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return new Response(new Uint8Array(image), {
    headers: {
      'Content-Type': incident.snapshot.file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'private, max-age=60',
    },
  })
}
