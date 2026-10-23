// Presentational only, so the server-rendered share page can use it too.

import type { Incident, Settings } from '@/lib/types'

export function clock(at: number, timezone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(at)
  )
}

function SnapshotBlock({ incident, timezone }: { incident: Incident; timezone: string }) {
  const snap = incident.snapshot
  if (snap?.status === 'ok') {
    const caption =
      snap.source === 'live' ? 'Frame from the live Ring view' : snap.source === 'phone' ? 'Live porch camera' : snap.source === 'demo' ? 'Demo photo' : 'Ring porch camera'
    return (
      <figure className="space-y-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/snapshots/${incident.shareToken}?v=${snap.capturedAt}`}
          alt="Porch camera photo taken moments after the door opened"
          className="aspect-video w-full rounded-md border border-line bg-black object-cover"
        />
        <figcaption className="font-mono text-[11px] text-muted">
          {caption} · {clock(snap.capturedAt, timezone)}
        </figcaption>
      </figure>
    )
  }
  const text =
    snap?.reason === 'encrypted'
      ? 'This camera uses end-to-end encryption, so there is no photo. Door and motion sensors still work.'
      : snap?.reason === 'no_camera'
        ? 'No outdoor camera is set up. Alert is based on the door sensor.'
        : snap?.reason === 'error'
          ? 'No recorded photo from the camera yet.'
          : 'Waiting for a photo from the porch camera…'
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
      {text}
    </div>
  )
}

export function IncidentDetails({ incident, settings }: { incident: Incident; settings: Settings }) {
  const d = incident.description
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <SnapshotBlock incident={incident} timezone={settings.timezone} />
      <div className="space-y-4">
        {d ? (
          <>
            <p className="font-serif text-2xl leading-snug text-paper">{d.summary}</p>
            <dl className="grid grid-cols-[auto,1fr] gap-x-5 gap-y-1.5 border-y border-line py-3 text-sm">
              <dt className="label mb-0 self-center">Wearing</dt>
              <dd>{d.clothing}</dd>
              <dt className="label mb-0 self-center">Carrying</dt>
              <dd>{d.carrying}</dd>
              <dt className="label mb-0 self-center">Heading</dt>
              <dd>{d.direction}</dd>
            </dl>
            {d.concerns.length > 0 && (
              <ul className="space-y-1 text-sm text-watch">
                {d.concerns.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span aria-hidden>!</span>
                    {c}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              Description by {d.model}. Clothing and surroundings only, no face or identity analysis.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            {incident.snapshot?.status === 'ok' && Date.now() - incident.snapshot.capturedAt < 60_000
              ? 'Writing a description for searchers…'
              : 'No description available.'}
          </p>
        )}
        <Timeline incident={incident} timezone={settings.timezone} />
      </div>
    </div>
  )
}

export function Timeline({ incident, timezone }: { incident: Incident; timezone: string }) {
  return (
    <ol className="space-y-1 text-sm">
      {incident.timeline.map((t, i) => (
        <li key={i} className="grid grid-cols-[4.5rem,1fr] gap-2 text-paper/85">
          <span className="font-mono text-xs leading-5 text-muted">{clock(t.at, timezone)}</span>
          {t.text}
        </li>
      ))}
    </ol>
  )
}
