import { NextRequest, NextResponse } from 'next/server'
import { ingest } from '@/lib/runtime'
import { parseWebhook, toHomeEvent, verifySignature } from '@/lib/ring/webhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let warnedUnsigned = false

/** Ring webhook receiver. Must answer within 5 seconds, so effects run after we reply. */
export async function POST(request: NextRequest) {
  // Verify first, parse second: the signature covers the raw bytes.
  const rawBody = await request.text()
  const key = process.env.RING_HMAC_KEY

  if (key) {
    if (!verifySignature(key, rawBody, request.headers.get('x-signature'))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (!warnedUnsigned) {
    warnedUnsigned = true
    console.warn('[webhook] RING_HMAC_KEY not set: accepting unsigned webhooks (local dev only)')
  }

  const webhook = parseWebhook(rawBody)
  if (!webhook) return NextResponse.json({ error: 'Not a Ring v1.1 webhook' }, { status: 400 })

  const event = toHomeEvent(webhook, webhook.data.attributes.source.startsWith('sim.'))
  const processed = ingest(event)
  return NextResponse.json({ status: processed ? 'processed' : 'duplicate', request_id: event.requestId })
}
