import { bus } from '@/lib/notify'
import { getState } from '@/lib/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Server-sent "change" pings so dashboards refetch /api/state immediately. */
export async function GET() {
  getState() // make sure the engine and its timer are running
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const onChange = () => send('event: change\ndata: {}\n\n')
      const keepAlive = setInterval(() => send(': ping\n\n'), 25_000)
      bus.on('change', onChange)
      cleanup = () => {
        clearInterval(keepAlive)
        bus.off('change', onChange)
      }
      send(': connected\n\n')
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
