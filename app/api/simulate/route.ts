import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { clearSimulated, getState, seedHistory } from '@/lib/runtime'
import { SCENARIOS, isSimulatorEnabled, runScenario } from '@/lib/simulator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.union([
  z.object({ scenario: z.string() }),
  z.object({ action: z.enum(['seed_history', 'clear']) }),
])

export async function POST(request: NextRequest) {
  if (!isSimulatorEnabled()) return NextResponse.json({ error: 'Simulator disabled' }, { status: 403 })

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  if ('action' in parsed.data) {
    if (parsed.data.action === 'clear') {
      clearSimulated()
      return NextResponse.json({ cleared: true })
    }
    return NextResponse.json({ seeded: seedHistory() })
  }

  if (!SCENARIOS[parsed.data.scenario]) {
    return NextResponse.json({ error: 'Unknown scenario' }, { status: 404 })
  }
  const webhookUrl = new URL('/api/webhook', request.url).toString()
  const { outdoorCameraId } = getState().settings
  const steps = runScenario(parsed.data.scenario, webhookUrl, outdoorCameraId ?? undefined)
  return NextResponse.json({ started: parsed.data.scenario, steps })
}
