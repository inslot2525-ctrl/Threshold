import { notFound } from 'next/navigation'
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
      <meta httpEquiv="refresh" content="20" />
      <header>
        {stillMissing ? (
          <p className="tag rounded-sm bg-alarm px-2 py-1 font-semibold text-ink">Please help look</p>
        ) : (
          <p className="tag rounded-sm bg-calm px-2 py-1 font-semibold text-ink">Update: no longer missing</p>
        )}
        <h1 className="mt-4 font-serif text-4xl leading-tight text-paper sm:text-5xl">
          {settings.personName} left home at {clock(incident.doorOpenedAt, settings.timezone)}
        </h1>
        <p className="mt-3 text-sm text-muted">
          They live with memory loss and may be confused. Stay calm, speak gently, and call {settings.caregiverName} or
          emergency services if you see them.
        </p>
      </header>
      <section className="card">
        <IncidentDetails incident={incident} settings={settings} />
      </section>
      <p className="font-mono text-[11px] text-muted">This page refreshes every 20 seconds.</p>
    </main>
  )
}
