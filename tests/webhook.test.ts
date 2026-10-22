import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseDescription } from '@/lib/ai/describe'
import { buildWebhook, parseWebhook, toHomeEvent, verifySignature } from '@/lib/ring/webhook'

const KEY = 'test-signing-key'

// Payload copied from Ring's sensor webhook documentation.
const RING_SENSOR_BODY = `{
  "meta": {
    "version": "1.1",
    "time": "2026-03-10T14:22:20.258000314Z",
    "request_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-1773152538431-contact_senso",
    "account_id": "ava1.ring.account.XXXXXXXX"
  },
  "data": {
    "id": "dev_contact_sensor_faulted_1773152538431",
    "type": "contact_sensor_faulted",
    "attributes": { "source": "ava1.ring.device.ABC", "source_type": "devices", "timestamp": 1773152538431 },
    "relationships": { "devices": { "links": { "self": "/v1/devices/ava1.ring.device.ABC" } } }
  }
}`

describe('webhook signature', () => {
  const header = 'sha256=' + createHmac('sha256', KEY).update(RING_SENSOR_BODY).digest('hex')

  it('accepts a valid signature over the raw body', () => {
    expect(verifySignature(KEY, RING_SENSOR_BODY, header)).toBe(true)
  })

  it('rejects a body that was re-serialized', () => {
    const reserialized = JSON.stringify(JSON.parse(RING_SENSOR_BODY))
    expect(verifySignature(KEY, reserialized, header)).toBe(false)
  })

  it('rejects a missing or wrong signature', () => {
    expect(verifySignature(KEY, RING_SENSOR_BODY, null)).toBe(false)
    expect(verifySignature('other-key', RING_SENSOR_BODY, header)).toBe(false)
  })
})

describe('webhook parsing', () => {
  it('normalizes a documented sensor event', () => {
    const webhook = parseWebhook(RING_SENSOR_BODY)
    expect(webhook).not.toBeNull()
    const event = toHomeEvent(webhook!, false)
    expect(event).toMatchObject({
      type: 'contact_sensor_faulted',
      deviceId: 'ava1.ring.device.ABC',
      at: 1773152538431,
    })
  })

  it('reads motion sub_type', () => {
    const body = JSON.stringify(
      buildWebhook({ type: 'motion_detected', deviceId: 'cam', at: 1, subType: 'human', requestId: 'r1' })
    )
    expect(toHomeEvent(parseWebhook(body)!, true).subType).toBe('human')
  })

  it('rejects non-Ring payloads', () => {
    expect(parseWebhook('{"hello":"world"}')).toBeNull()
    expect(parseWebhook('not json')).toBeNull()
  })
})

describe('description parsing', () => {
  it('extracts JSON even with surrounding text', () => {
    const d = parseDescription(
      'Here you go:\n{"summary":"Person in a light robe heading left","clothing":"light robe","carrying":"nothing","direction":"left","concerns":["no coat"]}',
      'model-x'
    )
    expect(d.summary).toMatch(/robe/)
    expect(d.concerns).toEqual(['no coat'])
  })

  it('drops everything else when the model sees no person', () => {
    const d = parseDescription(
      '{"person_visible":false,"summary":"A blue abstract wave","clothing":"None","carrying":"None","direction":"None","concerns":["art"]}',
      'model-x'
    )
    expect(d.summary).toBe('No person visible in this frame.')
    expect(d.clothing).toBe('unknown')
    expect(d.concerns).toEqual([])
  })
})
