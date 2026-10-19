import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateSettings } from '@/lib/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const SettingsPatch = z
  .object({
    personName: z.string().min(1).max(40),
    caregiverName: z.string().min(1).max(40),
    timezone: z.string().refine(isTimezone, 'Unknown timezone'),
    armMode: z.enum(['schedule', 'always', 'off']),
    windowStart: hhmm,
    windowEnd: hhmm,
    corroborationSeconds: z.number().int().min(10).max(600),
    returnGraceSeconds: z.number().int().min(10).max(3600),
    acceptGenericMotion: z.boolean(),
    doorSensorId: z.string().nullable(),
    outdoorCameraId: z.string().nullable(),
  })
  .partial()

export async function PUT(request: NextRequest) {
  const parsed = SettingsPatch.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })
  }
  return NextResponse.json({ settings: updateSettings(parsed.data) })
}
