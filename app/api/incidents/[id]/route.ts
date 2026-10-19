import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolve } from '@/lib/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({ outcome: z.enum(['safe', 'false_alarm']) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'outcome must be safe or false_alarm' }, { status: 400 })

  const incident = resolve(id, parsed.data.outcome)
  if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
  return NextResponse.json({ incident })
}
