import { NextResponse } from 'next/server'
import { buildDigest } from '@/lib/engine/digest'
import { activeIncident } from '@/lib/engine/detector'
import { isAiEnabled } from '@/lib/ai/describe'
import { isRingConfigured } from '@/lib/ring/auth'
import { getState } from '@/lib/runtime'
import { SCENARIOS, isSimulatorEnabled } from '@/lib/simulator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const state = getState()
  const now = Date.now()
  return NextResponse.json({
    now,
    settings: state.settings,
    devices: state.devices,
    active: activeIncident(state.incidents) ?? null,
    // Seeded history only feeds the trend chart; keep it out of the incident list.
    incidents: state.incidents.filter((i) => i.timeline.length > 1 || !i.simulated).slice(0, 15),
    events: state.events.slice(0, 40),
    digest: buildDigest(state.incidents, now),
    integrations: {
      ring: isRingConfigured(),
      webhookSigned: Boolean(process.env.RING_HMAC_KEY),
      bedrock: isAiEnabled(),
      sns: Boolean(process.env.SNS_TOPIC_ARN),
      simulator: isSimulatorEnabled(),
    },
    scenarios: isSimulatorEnabled()
      ? Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label }))
      : [],
  })
}
