import { notFound } from 'next/navigation'
import Backdrop from '@/components/Backdrop'
import { IncidentDetails, clock } from '@/components/IncidentCard'
import { getState } from '@/lib/runtime'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Help find them · Threshold', robots: { index: false } }

/**
 * Read-only page a caregiver can forward to neighbors or police.
 * Reachable only by its random token; shows no account or device details.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const state = getState()
  const incident = state.incidents.find((i) => i.shareToken === token)
  if (!incident) notFound()

  const { settings } = state
  const stillMissing = incident.state === 'alerted' || incident.state === 'watching'

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Backdrop mood={stillMissing ? 'alarm' : 'calm'} />
      <meta httpEquiv="refresh" content="20" />
      <header>
        {stillMissing ? (
          <p className="chip border-alarm/40 bg-alarm/10 font-bold uppercase tracking-[0.14em] text-alarm">Please help look</p>
        ) : (
          <p className="chip border-calm/40 bg-calm/10 font-bold uppercase tracking-[0.14em] text-calm">Update: no longer missing</p>
        )}
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {settings.personName} left home at {clock(incident.doorOpenedAt, settings.timezone)}
        </h1>
        <p className="text-sm text-slate-400">
          They live with memory loss and may be confused. Stay calm, speak gently, and call {settings.caregiverName} or
          emergency services if you see them.
        </p>
      </header>
      <section className="card">
        <IncidentDetails incident={incident} settings={settings} />
      </section>
      <p className="text-xs text-slate-500">This page refreshes every 20 seconds.</p>
    </main>
  )
}
