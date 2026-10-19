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
 * Device discovery plus each device's configuration, so we know up front which
 * cameras have end-to-end encryption on (their media is unreadable to partners).
 * Ring doesn't say whether a device is a sensor or camera; the caregiver maps that in settings.
 */
export async function listDevices(): Promise<Device[]> {
  const body = await getJson('/v1/devices')
  const items: any[] = body?.data ?? []

  return Promise.all(
    items.map(async (item): Promise<Device> => {
      const attrs = item.attributes ?? {}
      let e2eEncrypted = false
      let hasVideo = false
      try {
        const config = await getJson(`/v1/devices/${item.id}/configurations`)
        const configAttrs = config?.data?.attributes ?? {}
        // A JSON boolean, unlike the "on"/"off" strings elsewhere in this payload.
        e2eEncrypted = configAttrs.e2e_encryption?.enabled === true
        hasVideo = Boolean(configAttrs.video)
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
        online,
        e2eEncrypted,
        hasVideo,
      }
    })
  )
}

/**
 * Download the latest snapshot in [start, end]. Ring answers with a 303 to a
 * pre-signed URL; we follow it ourselves so the bearer token isn't forwarded.
 */
export async function downloadSnapshot(deviceId: string, start: number, end: number): Promise<Buffer> {
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

  const location = res.headers.get('location')
  const media = location ? await fetch(location) : res
  if (!media.ok) throw new RingApiError(`Snapshot download failed: ${media.status}`, media.status)
  return Buffer.from(await media.arrayBuffer())
}
