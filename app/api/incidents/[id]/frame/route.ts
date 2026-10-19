import { NextRequest, NextResponse } from 'next/server'
import { attachLiveFrame } from '@/lib/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024

/** A JPEG frame captured from the live Ring view, used when there is no recorded snapshot. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const image = Buffer.from(await request.arrayBuffer())

  const isJpeg = image.length > 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
  if (!isJpeg || image.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Expected a JPEG under 5 MB' }, { status: 400 })
  }

  const attached = await attachLiveFrame(id, image)
  return NextResponse.json({ attached })
}
