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
      snap.source === 'live' ? 'Frame from the live Ring view' : snap.source === 'demo' ? 'Demo photo' : 'Ring porch camera'
    return (
      <figure className="space-y-2">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_10px_40px_-12px_rgba(0,0,0,0.8)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/snapshots/${incident.shareToken}?v=${snap.capturedAt}`}
            alt="Porch camera photo taken moments after the door opened"
            className="aspect-video w-full object-cover"
          />
        </div>
        <figcaption className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-lilac" />
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
    <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 p-6 text-center text-sm text-slate-400">
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
            <p className="font-display text-xl font-semibold leading-snug text-white">{d.summary}</p>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
              <dt className="text-slate-400">👕 Wearing</dt>
              <dd className="text-white">{d.clothing}</dd>
              <dt className="text-slate-400">🎒 Carrying</dt>
              <dd className="text-white">{d.carrying}</dd>
              <dt className="text-slate-400">🧭 Heading</dt>
              <dd className="text-white">{d.direction}</dd>
            </dl>
            {d.concerns.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {d.concerns.map((c) => (
                  <li key={c} className="chip border-watch/30 bg-watch/10 text-watch">
                    ⚠ {c}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">
              Description by {d.model}. Clothing and surroundings only, no face or identity analysis.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-400">
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
    <ol className="relative space-y-2 pl-5 text-sm before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-gradient-to-b before:from-lilac/60 before:to-transparent">
      {incident.timeline.map((t, i) => (
        <li key={i} className="relative text-slate-300">
          <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink bg-lilac" />
          <span className="mr-2 font-mono text-xs text-slate-500">{clock(t.at, timezone)}</span>
          {t.text}
        </li>
      ))}
    </ol>
  )
}
