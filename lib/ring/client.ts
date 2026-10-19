// Thin client for the Ring Partner API (https://api.amazonvision.com).

import { getAccessToken } from '@/lib/ring/auth'
import type { Device } from '@/lib/types'

const API_BASE = process.env.RING_API_BASE || 'https://api.amazonvision.com'

export class RingApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function ringFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  })
  if (!res.ok && res.status !== 303) {
    throw new RingApiError(`${init.method || 'GET'} ${path} failed: ${res.status} ${await res.text()}`, res.status)
  }
  return res
}

async function getJson(path: string): Promise<any> {
  return (await ringFetch(path)).json()
}

/**
 * Device discovery plus each device's capabilities (what kind of device it is) and
 * configuration (whether end-to-end encryption makes its media unreadable to partners).
 */
export async function listDevices(): Promise<Device[]> {
  const body = await getJson('/v1/devices')
  const items: any[] = body?.data ?? []

  return Promise.all(
    items.map(async (item): Promise<Device> => {
      const attrs = item.attributes ?? {}

      let kind: Device['kind'] = 'other'
      try {
        const caps = (await getJson(`/v1/devices/${item.id}/capabilities`))?.data?.attributes ?? {}
        // Unsupported capabilities come back as null rather than being omitted.
        if (caps.video) kind = 'camera'
        else if (caps.contact_detection) kind = 'contact_sensor'
      } catch {
        // Leave as "other"; the caregiver can still map it by hand.
      }

      let e2eEncrypted = false
      try {
        const config = await getJson(`/v1/devices/${item.id}/configurations`)
        // A JSON boolean, unlike the "on"/"off" strings elsewhere in this payload.
        e2eEncrypted = config?.data?.attributes?.e2e_encryption?.enabled === true
      } catch {
        // Sensors may have no camera configuration at all.
      }

      let online: boolean | null = null
      try {
        const status = await getJson(`/v1/devices/${item.id}/status`)
        online = status?.data?.attributes?.online ?? null
      } catch {
        // Status is nice to have.
      }

      return {
        id: item.id,
        name: attrs.name || attrs.description || 'Ring device',
        source: 'ring',
        kind,
        online,
        e2eEncrypted,
        hasVideo: kind === 'camera',
      }
    })
  )
}

const SNAPSHOT_ATTEMPTS = 4
const SNAPSHOT_RETRY_MS = 3000

async function requestSnapshot(deviceId: string, start: number, end: number): Promise<Buffer> {
  const res = await ringFetch(`/v1/devices/${deviceId}/media/image/download`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'latest_in_range',
      start_timestamp: start,
      end_timestamp: end,
      image_options: { format: 'jpeg', resolution: { width: 1280, height: 720 } },
    }),
  })

  // Ring answers with a 303 to a pre-signed URL; follow it ourselves so the bearer token isn't forwarded.
  const location = res.headers.get('location')
  const media = location ? await fetch(location) : res
  if (!media.ok) {
    // 416 MEDIA_NOT_FOUND arrives from the pre-signed URL when nothing was recorded in the range.
    throw new RingApiError(`Snapshot download failed: ${media.status} ${await media.text()}`, media.status)
  }
  return Buffer.from(await media.arrayBuffer())
}

/**
 * Latest snapshot from `start` onward. Media can lag the motion webhook by a few
 * seconds, so a 416 (nothing recorded yet) is retried with the window extended to now.
 * Note: a 403 TIME_RANGE_NOT_AUTHORIZED means `start` predates what the token may see.
 */
export async function downloadSnapshot(deviceId: string, start: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestSnapshot(deviceId, start, Date.now())
    } catch (error) {
      if (!(error instanceof RingApiError) || attempt >= SNAPSHOT_ATTEMPTS) throw error
      if (error.status === 403 && error.message.includes('TIME_RANGE_NOT_AUTHORIZED')) {
        start = Date.now() - 10_000
        continue
      }
      if (error.status !== 416) throw error
      await new Promise((r) => setTimeout(r, SNAPSHOT_RETRY_MS))
    }
  }
}
