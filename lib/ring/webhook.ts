// Ring webhook v1.1: signature verification and normalization.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { HomeEvent } from '@/lib/types'

const WebhookSchema = z.object({
  meta: z.object({
    version: z.string(),
    time: z.string(),
    request_id: z.string(),
    account_id: z.string().optional(),
  }),
  data: z.object({
    id: z.string(),
    type: z.string(),
    attributes: z.object({
      source: z.string(),
      source_type: z.string(),
      timestamp: z.union([z.number(), z.string()]),
      sub_type: z.string().optional(),
      component_ids: z.array(z.string()).optional(),
    }),
  }),
})

export type RingWebhook = z.infer<typeof WebhookSchema>

/** Hex HMAC-SHA256 over the raw body, as Ring sends in X-Signature ("sha256=<hex>"). */
export function signBody(key: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', key).update(rawBody, 'utf8').digest('hex')
}

/** Verify against the raw body bytes. Re-serialized JSON would not match. */
export function verifySignature(key: string, rawBody: string, header: string | null): boolean {
  if (!header) return false
  const expected = Buffer.from(signBody(key, rawBody))
  const received = Buffer.from(header.trim())
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function parseWebhook(rawBody: string): RingWebhook | null {
  try {
    const parsed = WebhookSchema.safeParse(JSON.parse(rawBody))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function toHomeEvent(webhook: RingWebhook, simulated: boolean): HomeEvent {
  const { meta, data } = webhook
  const ts = data.attributes.timestamp
  return {
    requestId: meta.request_id,
    type: data.type,
    subType: data.attributes.sub_type,
    // Route on data.type and read the device from attributes.source; data.id is not a contract.
    deviceId: data.attributes.source,
    at: typeof ts === 'number' ? ts : Date.parse(ts),
    receivedAt: Date.now(),
    simulated,
  }
}

/** Build a Ring-shaped webhook body. Used by the simulator so demos exercise the real path. */
export function buildWebhook(input: {
  type: string
  deviceId: string
  at: number
  subType?: string
  requestId: string
}): RingWebhook {
  return {
    meta: {
      version: '1.1',
      time: new Date().toISOString(),
      request_id: input.requestId,
      account_id: 'ava1.ring.account.SIMULATED',
    },
    data: {
      id: `${input.deviceId}_${input.type}_${input.at}`,
      type: input.type,
      attributes: {
        source: input.deviceId,
        source_type: 'devices',
        timestamp: input.at,
        ...(input.subType ? { sub_type: input.subType } : {}),
      },
    },
  }
}
