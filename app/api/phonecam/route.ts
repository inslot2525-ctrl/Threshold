import { NextRequest, NextResponse } from 'next/server'
import { latestPhoneFrame, onPhoneFrame, pushPhoneFrame } from '@/lib/phonecam'
import { onPhoneMotion } from '@/lib/phonewatch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 2 * 1024 * 1024
const BOUNDARY = 'phonecam'

/** One JPEG frame from the phone on the /camera page; `X-Motion: 1` when the phone saw movement. */
export async function POST(request: NextRequest) {
  const frame = Buffer.from(await request.arrayBuffer())
  const isJpeg = frame.length > 3 && frame[0] === 0xff && frame[1] === 0xd8 && frame[2] === 0xff
  if (!isJpeg || frame.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Expected a JPEG under 2 MB' }, { status: 400 })
  }
  pushPhoneFrame(frame)
  if (request.headers.get('x-motion') === '1') void onPhoneMotion(frame)
  return NextResponse.json({ ok: true })
}

/** The phone's feed as MJPEG, which an <img> plays directly. */
export async function GET(request: NextRequest) {
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: Buffer) => {
        try {
          controller.enqueue(new TextEncoder().encode(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`))
          controller.enqueue(new Uint8Array(frame))
          controller.enqueue(new TextEncoder().encode('\r\n'))
        } catch {
          cleanup()
        }
      }
      const off = onPhoneFrame(send)
      cleanup = () => off()
      request.signal.addEventListener('abort', () => cleanup())
      const first = latestPhoneFrame()
      if (first) send(first)
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
