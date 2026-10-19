import { NextResponse } from 'next/server'
import { refreshDevices } from '@/lib/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Re-discover devices from Ring (and re-check camera encryption). */
export async function POST() {
  const { devices, error } = await refreshDevices()
  return NextResponse.json({ devices, error }, { status: error && !devices.length ? 502 : 200 })
}
