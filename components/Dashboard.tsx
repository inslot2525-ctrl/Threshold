'use client'

import { useCallback, useEffect, useState } from 'react'
import { IncidentDetails, Timeline, clock } from '@/components/IncidentCard'
import LivePorchView from '@/components/LivePorchView'
import type { Digest } from '@/lib/engine/digest'
import type { Device, HomeEvent, Incident, Settings } from '@/lib/types'

interface DashboardState {
  now: number
  settings: Settings
  devices: Device[]
  active: Incident | null
  incidents: Incident[]
  events: HomeEvent[]
  digest: Digest
  ringTokenExpiresAt: number | null
  integrations: { ring: boolean; webhookSigned: boolean; bedrock: boolean; describer: string; sns: boolean; simulator: boolean }
  scenarios: { id: string; label: string }[]
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      setState(await res.json())
      setError(null)
    } catch {
      setError('Lost connection to Threshold. Retrying…')
    }
  }, [])

  useEffect(() => {
    load()
    const source = new EventSource('/api/stream')
    source.addEventListener('change', load)
    const clockTimer = setInterval(() => setNow(Date.now()), 1000)
    // Fallback poll in case the stream drops behind a proxy.
    const poll = setInterval(load, 15_000)
    return () => {
      source.close()
      clearInterval(clockTimer)
      clearInterval(poll)
    }
  }, [load])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [load]
  )

  if (!state) {
    return <main className="p-8 font-mono text-sm text-muted">{error ?? 'Loading…'}</main>
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="flex items-center gap-2.5 font-serif text-4xl leading-none text-paper">
            <span className="inline-block h-3 w-3 rounded-sm bg-porch" aria-hidden />
            Threshold
          </h1>
          <p className="mt-2 text-sm text-muted">Night-exit alerts for {state.settings.personName}&apos;s front door</p>
        </div>
        <Integrations integrations={state.integrations} />
      </header>

      {error && <div className="rounded-md border border-alarm/50 px-3 py-2 text-sm text-alarm">{error}</div>}

      <StatusHero state={state} now={now} onResolve={(id, outcome) => act(() => send(`/api/incidents/${id}`, 'POST', { outcome }))} />

      <div className="grid gap-4 md:grid-cols-5">
        <div className="md:col-span-3">
          <WeeklyTrend digest={state.digest} />
        </div>
        <div className="md:col-span-2">
          <RecentIncidents incidents={state.incidents.filter((i) => i.id !== state.active?.id)} settings={state.settings} />
        </div>
      </div>

      {state.integrations.simulator && (
        <SimulatorPanel
          scenarios={state.scenarios}
          onRun={(scenario) => act(() => send('/api/simulate', 'POST', { scenario }))}
          onSeed={() => act(() => send('/api/simulate', 'POST', { action: 'seed_history' }))}
          onClear={() => act(() => send('/api/simulate', 'POST', { action: 'clear' }))}
          onDemoTiming={() =>
            act(() => send('/api/settings', 'PUT', { armMode: 'always', returnGraceSeconds: 20, corroborationSeconds: 30 }))
          }
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <DevicesPanel
          devices={state.devices}
          settings={state.settings}
          tokenExpiresAt={state.ringTokenExpiresAt}
          now={now}
          onToken={(token) => act(() => send('/api/ring/token', 'POST', { token }))}
          onMap={(patch) => act(() => send('/api/settings', 'PUT', patch))}
          onRefresh={() => act(() => send('/api/devices', 'POST'))}
        />
        <SettingsPanel settings={state.settings} onSave={(patch) => act(() => send('/api/settings', 'PUT', patch))} />
      </div>

      <EventLog events={state.events} devices={state.devices} timezone={state.settings.timezone} />
    </main>
  )
}

function Integrations({ integrations }: { integrations: DashboardState['integrations'] }) {
  const items: [string, boolean][] = [
    ['Ring API', integrations.ring],
    ['Signed webhooks', integrations.webhookSigned],
    [integrations.describer, integrations.bedrock],
    ['SNS', integrations.sns],
  ]
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, on]) => (
        <li key={label} className={`tag ${on ? 'text-paper' : 'text-muted/60'}`} title={on ? 'Connected' : 'Not configured'}>
          <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-calm' : 'border border-muted/60'}`} />
          {label}
        </li>
      ))}
    </ul>
  )
}

function armedText(settings: Settings) {
  if (settings.armMode === 'always') return 'Watching the front door now (always on)'
  if (settings.armMode === 'off') return 'Watching is paused'
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    const d = new Date(2000, 0, 1, h, m)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return `Watching the front door ${fmt(settings.windowStart)} – ${fmt(settings.windowEnd)}`
}

function StatusHero({
  state,
  now,
  onResolve,
}: {
  state: DashboardState
  now: number
  onResolve: (id: string, outcome: 'safe' | 'false_alarm') => void
}) {
  const { active, settings } = state
  const name = settings.personName

  if (!active) {
    const grace = Math.round(settings.returnGraceSeconds / 60) || `${settings.returnGraceSeconds}s`
    return (
      <section className="card border-l-4 border-l-calm">
        <p className="tag text-calm">
          <span className="h-1.5 w-1.5 rounded-full bg-calm" />
          Armed
        </p>
        <p className="mt-3 font-serif text-5xl leading-none text-paper sm:text-6xl">All quiet.</p>
        <p className="mt-3 text-paper/90">{armedText(settings)}</p>
        <p className="mt-1 text-sm text-muted">
          You&apos;ll be alerted if {name} goes out and doesn&apos;t come back within {grace}
          {settings.returnGraceSeconds >= 60 ? ' minutes' : ''}.
        </p>
      </section>
    )
  }

  if (active.state === 'watching') {
    const remaining = Math.max(0, Math.ceil((active.doorOpenedAt + settings.returnGraceSeconds * 1000 - now) / 1000))
    return (
      <section className="card border-l-4 border-l-watch">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="tag text-watch">
              <span className="blink h-1.5 w-1.5 rounded-full bg-watch" />
              Watching
            </p>
            <p className="mt-3 font-serif text-4xl leading-tight text-paper sm:text-5xl">
              Door opened at {clock(active.doorOpenedAt, settings.timezone)}
              {active.personSeenAt ? '.' : '…'}
            </p>
            <p className="mt-2 text-sm text-paper/80">
              {active.personSeenAt
                ? `${name} was seen outside. Alerting unless the door opens again.`
                : 'Checking the porch camera for someone outside…'}
            </p>
          </div>
          {active.personSeenAt && (
            <div className="text-right">
              <p className="label">Alert in</p>
              <p className="font-mono text-4xl tabular-nums text-watch">{formatDuration(remaining)}</p>
            </div>
          )}
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <Timeline incident={active} timezone={settings.timezone} />
        </div>
      </section>
    )
  }

  const minutesOut = Math.max(1, Math.floor((now - active.doorOpenedAt) / 60_000))
  const camera = state.devices.find((d) => d.id === settings.outdoorCameraId)
  const canStreamLive = camera?.source === 'ring' && !camera.e2eEncrypted
  return (
    <section className="overflow-hidden rounded-lg border border-alarm bg-panel" role="alert">
      <div className="flex items-center justify-between gap-3 bg-alarm px-5 py-2 text-ink sm:px-6">
        <p className="tag font-semibold">
          <span className="blink h-2 w-2 rounded-full bg-ink" />
          {name} has left home
        </p>
        <p className="tag font-semibold">{minutesOut} min out</p>
      </div>
      <div className="p-5 sm:p-6">
        <p className="font-serif text-4xl leading-tight text-paper sm:text-5xl">
          Out since {clock(active.doorOpenedAt, settings.timezone)}.
        </p>
        {canStreamLive && (
          <div className="mt-5 md:w-1/2">
            <p className="label">Porch, live</p>
            <LivePorchView autoStart captureForIncidentId={active.snapshot?.status === 'ok' ? undefined : active.id} />
          </div>
        )}
        <div className="mt-5">
          <IncidentDetails incident={active} settings={settings} />
        </div>
        <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
          <a className="btn-primary" href={`/share/${active.shareToken}`} target="_blank" rel="noreferrer">
            Open search-party page
          </a>
          <button className="btn" onClick={() => onResolve(active.id, 'safe')}>
            {name} is safe
          </button>
          <button className="btn text-muted" onClick={() => onResolve(active.id, 'false_alarm')}>
            False alarm
          </button>
        </div>
      </div>
    </section>
  )
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function WeeklyTrend({ digest }: { digest: Digest }) {
  const max = Math.max(1, ...digest.weeks.map((w) => w.doorOpenings))
  const rising = digest.thisWeek >= Math.max(2, digest.baseline * 2)
  return (
    <section className="card h-full">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="heading">Night exits</h2>
        <span className="font-mono text-[11px] text-muted">6 weeks</span>
      </div>
      <p className={`mb-5 mt-1 text-sm ${rising ? 'text-watch' : 'text-muted'}`}>{digest.message}</p>
      <div className="flex h-40 gap-2 border-b border-line" aria-label="Weekly night exits chart">
        {digest.weeks.map((w, i) => {
          const last = i === digest.weeks.length - 1
          return (
            <div key={w.weekStart} className="flex min-h-0 flex-1 flex-col justify-end gap-[2px]">
              <div
                className="w-full rounded-t-sm bg-line"
                style={{ height: `${((w.doorOpenings - w.exits) / max) * 100}%` }}
                title={`${w.doorOpenings - w.exits} door openings with no exit`}
              />
              <div
                className={`w-full ${w.doorOpenings - w.exits === 0 ? 'rounded-t-sm' : ''} ${last && rising ? 'bg-watch' : 'bg-paper/80'}`}
                style={{ height: `${(w.exits / max) * 100}%` }}
                title={`${w.exits} night exits`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {digest.weeks.map((w, i) => (
          <span key={w.weekStart} className={`flex-1 text-center font-mono text-[11px] ${i === digest.weeks.length - 1 ? 'text-paper' : 'text-muted'}`}>
            {i === digest.weeks.length - 1 ? 'This wk' : `-${digest.weeks.length - 1 - i}w`}
          </span>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-paper/80" />
          Went outside
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-line" />
          Opened door only
        </span>
      </div>
    </section>
  )
}

const STATE_LABEL: Record<Incident['state'], string> = {
  watching: 'Watching',
  alerted: 'Alerted',
  returned: 'Came back in',
  safe: 'Marked safe',
  false_alarm: 'False alarm',
  no_exit: 'Door only',
  expired: 'Not resolved',
}

const STATE_COLOR: Record<Incident['state'], string> = {
  watching: 'text-watch',
  alerted: 'text-alarm',
  returned: 'text-calm',
  safe: 'text-calm',
  false_alarm: 'text-muted',
  no_exit: 'text-muted',
  expired: 'text-muted',
}

function RecentIncidents({ incidents, settings }: { incidents: Incident[]; settings: Settings }) {
  return (
    <section className="card h-full">
      <h2 className="heading mb-3">Recent nights</h2>
      {incidents.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {incidents.slice(0, 7).map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                {new Date(i.doorOpenedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                <span className="ml-2 font-mono text-xs text-muted">{clock(i.doorOpenedAt, settings.timezone)}</span>
                {i.simulated && <span className="ml-2 font-mono text-[10px] uppercase text-muted/60">sim</span>}
              </span>
              <span className={`shrink-0 text-xs ${STATE_COLOR[i.state]}`}>{STATE_LABEL[i.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SimulatorPanel({
  scenarios,
  onRun,
  onSeed,
  onClear,
  onDemoTiming,
}: {
  scenarios: DashboardState['scenarios']
  onRun: (id: string) => void
  onSeed: () => void
  onClear: () => void
  onDemoTiming: () => void
}) {
  return (
    <section className="card border-dashed">
      <h2 className="heading">Demo simulator</h2>
      <p className="mb-4 mt-1 text-sm text-muted">
        Sends signed, Ring-format webhooks from simulated devices into the same pipeline real Ring events use.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {scenarios.map((s, i) => (
          <button
            key={s.id}
            className="flex items-baseline gap-3 rounded-md border border-line px-3.5 py-3 text-left text-sm text-paper transition-colors hover:border-porch/60 hover:bg-porch/[0.06]"
            onClick={() => onRun(s.id)}
          >
            <span className="font-mono text-xs text-porch">{String(i + 1).padStart(2, '0')}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-sm">
        <button className="text-muted underline-offset-4 hover:text-paper hover:underline" onClick={onDemoTiming}>
          Use demo timing (20s grace, always on)
        </button>
        <button className="text-muted underline-offset-4 hover:text-paper hover:underline" onClick={onSeed}>
          Seed 6 weeks of history
        </button>
        <button className="text-muted underline-offset-4 hover:text-paper hover:underline" onClick={onClear}>
          Clear simulated data
        </button>
      </div>
    </section>
  )
}

function TokenBox({ expiresAt, now, onToken }: { expiresAt: number | null; now: number; onToken: (t: string) => void }) {
  const [value, setValue] = useState('')
  const remaining = expiresAt ? Math.floor((expiresAt - now) / 1000) : null
  const expired = remaining !== null && remaining <= 0
  const status =
    remaining === null
      ? 'No Playground token in use'
      : remaining > 0
        ? `Playground token valid for ${formatDuration(remaining)}`
        : 'Playground token expired'
  return (
    <div className="mb-4 rounded-md border border-line bg-ink p-3">
      <p className={`mb-2 font-mono text-[11px] ${expired ? 'text-alarm' : 'text-muted'}`}>{status}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          onToken(value.trim())
          setValue('')
        }}
      >
        <input
          type="password"
          autoComplete="off"
          className="input"
          placeholder="Paste a new Ring Playground token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn shrink-0" type="submit">Use</button>
      </form>
    </div>
  )
}

function deviceKind(d: Device) {
  if (d.hasVideo) return 'Camera'
  if (d.kind === 'contact_sensor') return 'Sensor'
  return 'Device'
}

function DevicesPanel({
  devices,
  settings,
  tokenExpiresAt,
  now,
  onToken,
  onMap,
  onRefresh,
}: {
  devices: Device[]
  settings: Settings
  tokenExpiresAt: number | null
  now: number
  onToken: (token: string) => void
  onMap: (patch: Partial<Settings>) => void
  onRefresh: () => void
}) {
  return (
    <section className="card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="heading">Ring devices</h2>
        <button className="btn px-2.5 py-1 text-xs" onClick={onRefresh}>Refresh</button>
      </div>
      <TokenBox expiresAt={tokenExpiresAt} now={now} onToken={onToken} />
      <ul className="mb-5 divide-y divide-line text-sm">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate">
              {d.name}
              {d.source === 'simulator' && <span className="ml-2 font-mono text-[10px] uppercase text-muted/60">sim</span>}
            </span>
            <span className="tag shrink-0 text-muted">
              {d.e2eEncrypted && <span title="Video is end-to-end encrypted: alerts use sensors only">E2EE ·</span>}
              {deviceKind(d)}
            </span>
          </li>
        ))}
      </ul>
      <label className="label" htmlFor="door">Front door sensor</label>
      <select
        id="door"
        className="input mb-3"
        value={settings.doorSensorId ?? ''}
        onChange={(e) => onMap({ doorSensorId: e.target.value || null })}
      >
        <option value="">Not set</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <label className="label" htmlFor="camera">Outdoor camera</label>
      <select
        id="camera"
        className="input"
        value={settings.outdoorCameraId ?? ''}
        onChange={(e) => onMap({ outdoorCameraId: e.target.value || null })}
      >
        <option value="">None (door sensor only)</option>
        {devices.filter((d) => d.hasVideo).map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </section>
  )
}

function SettingsPanel({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <section className="card">
      <h2 className="heading mb-4">Settings</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="person">Person</label>
          <input id="person" className="input" value={draft.personName} onChange={(e) => set('personName', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="caregiver">Caregiver</label>
          <input id="caregiver" className="input" value={draft.caregiverName} onChange={(e) => set('caregiverName', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="arm">When to watch</label>
          <select id="arm" className="input" value={draft.armMode} onChange={(e) => set('armMode', e.target.value as Settings['armMode'])}>
            <option value="schedule">On a schedule</option>
            <option value="always">Always (e.g. while I&apos;m out)</option>
            <option value="off">Paused</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="start">From</label>
          <input id="start" type="time" className="input" value={draft.windowStart} onChange={(e) => set('windowStart', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="end">Until</label>
          <input id="end" type="time" className="input" value={draft.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="grace">Alert after (sec)</label>
          <input id="grace" type="number" className="input" value={draft.returnGraceSeconds} onChange={(e) => set('returnGraceSeconds', Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="corr">Camera window (sec)</label>
          <input id="corr" type="number" className="input" value={draft.corroborationSeconds} onChange={(e) => set('corroborationSeconds', Number(e.target.value))} />
        </div>
        <label className="col-span-2 mt-1 flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-porch"
            checked={draft.acceptGenericMotion}
            onChange={(e) => set('acceptGenericMotion', e.target.checked)}
          />
          Treat unclassified motion as a person (Ring Smart Alerts off)
        </label>
      </div>
      <button className="btn-primary mt-5" onClick={() => onSave(draft)}>Save</button>
    </section>
  )
}

function EventLog({ events, devices, timezone }: { events: HomeEvent[]; devices: Device[]; timezone: string }) {
  const name = (id: string) => devices.find((d) => d.id === id)?.name ?? id
  return (
    <section className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="heading">Raw Ring events</h2>
        <span className="font-mono text-[11px] text-muted">newest first</span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No webhooks received yet.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
          {events.map((e) => (
            <li key={e.requestId} className="flex min-w-0 gap-3">
              <span className="shrink-0 text-muted">{clock(e.at, timezone)}</span>
              <span className="min-w-0 truncate text-paper">
                {e.type}
                {e.subType ? <span className="text-porch">:{e.subType}</span> : ''}
              </span>
              <span className="hidden min-w-0 truncate text-muted sm:inline">{name(e.deviceId)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
