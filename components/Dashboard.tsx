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
  integrations: { ring: boolean; webhookSigned: boolean; bedrock: boolean; sns: boolean; simulator: boolean }
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
    return <main className="p-8 text-slate-400">{error ?? 'Loading…'}</main>
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Threshold</h1>
          <p className="text-sm text-slate-400">Night-exit alerts for {state.settings.personName}&apos;s front door</p>
        </div>
        <Integrations integrations={state.integrations} />
      </header>

      {error && <div className="rounded-md border border-alarm/50 bg-alarm/10 px-3 py-2 text-sm">{error}</div>}

      <StatusHero state={state} now={now} onResolve={(id, outcome) => act(() => send(`/api/incidents/${id}`, 'POST', { outcome }))} />

      <div className="grid gap-5 md:grid-cols-2">
        <WeeklyTrend digest={state.digest} />
        <RecentIncidents incidents={state.incidents.filter((i) => i.id !== state.active?.id)} settings={state.settings} />
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

      <div className="grid gap-5 md:grid-cols-2">
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
  const chips: [string, boolean][] = [
    ['Ring API', integrations.ring],
    ['Signed webhooks', integrations.webhookSigned],
    ['Bedrock', integrations.bedrock],
    ['SNS texts', integrations.sns],
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([label, on]) => (
        <span
          key={label}
          className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-calm/40 text-calm' : 'border-line text-slate-500'}`}
        >
          {on ? '●' : '○'} {label}
        </span>
      ))}
    </div>
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
    return (
      <section className="card border-calm/30">
        <p className="text-sm font-medium text-calm">All quiet</p>
        <p className="mt-1 text-xl text-white">{armedText(settings)}</p>
        <p className="mt-1 text-sm text-slate-400">
          You&apos;ll be alerted if {name} goes out and doesn&apos;t come back within{' '}
          {Math.round(settings.returnGraceSeconds / 60) || `${settings.returnGraceSeconds}s`}
          {settings.returnGraceSeconds >= 60 ? ' minutes' : ''}.
        </p>
      </section>
    )
  }

  if (active.state === 'watching') {
    const remaining = Math.max(0, Math.ceil((active.doorOpenedAt + settings.returnGraceSeconds * 1000 - now) / 1000))
    return (
      <section className="card border-watch/50 bg-watch/5">
        <p className="text-sm font-medium text-watch">Watching</p>
        <p className="mt-1 text-xl text-white">
          Front door opened at {clock(active.doorOpenedAt, settings.timezone)}
          {active.personSeenAt ? `. ${name} was seen outside.` : '.'}
        </p>
        <p className="mt-1 text-sm text-slate-300">
          {active.personSeenAt
            ? `Alerting in ${formatDuration(remaining)} unless the door opens again.`
            : 'Checking the porch camera for someone outside…'}
        </p>
        <div className="mt-4">
          <Timeline incident={active} timezone={settings.timezone} />
        </div>
      </section>
    )
  }

  const minutesOut = Math.max(1, Math.floor((now - active.doorOpenedAt) / 60_000))
  const camera = state.devices.find((d) => d.id === settings.outdoorCameraId)
  const canStreamLive = camera?.source === 'ring' && !camera.e2eEncrypted
  return (
    <section className="card border-alarm bg-alarm/10" role="alert">
      <p className="text-sm font-semibold uppercase tracking-wide text-alarm">{name} has left home</p>
      <p className="mt-1 text-2xl font-semibold text-white">
        Out since {clock(active.doorOpenedAt, settings.timezone)} · {minutesOut} min
      </p>
      {canStreamLive && (
        <div className="mt-4 md:w-1/2">
          <p className="label">Porch right now</p>
          <LivePorchView
            autoStart
            captureForIncidentId={active.snapshot?.status === 'ok' ? undefined : active.id}
          />
        </div>
      )}
      <div className="mt-4">
        <IncidentDetails incident={active} settings={settings} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <a className="btn-primary" href={`/share/${active.shareToken}`} target="_blank" rel="noreferrer">
          Open search-party page
        </a>
        <button className="btn" onClick={() => onResolve(active.id, 'safe')}>
          {name} is safe
        </button>
        <button className="btn" onClick={() => onResolve(active.id, 'false_alarm')}>
          False alarm
        </button>
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
    <section className="card">
      <h2 className="label">Night exits, last 6 weeks</h2>
      <p className={`mb-4 text-sm ${rising ? 'text-watch' : 'text-slate-300'}`}>{digest.message}</p>
      <div className="flex h-32 items-end gap-2" aria-label="Weekly night exits chart">
        {digest.weeks.map((w, i) => (
          <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 flex-col justify-end gap-px">
              <div
                className="w-full rounded-t bg-slate-600"
                style={{ height: `${((w.doorOpenings - w.exits) / max) * 100}%` }}
                title={`${w.doorOpenings - w.exits} door openings with no exit`}
              />
              <div
                className={`w-full ${i === digest.weeks.length - 1 && rising ? 'bg-watch' : 'bg-slate-300'}`}
                style={{ height: `${(w.exits / max) * 100}%` }}
                title={`${w.exits} night exits`}
              />
            </div>
            <span className="text-xs text-slate-500">{i === digest.weeks.length - 1 ? 'Now' : `-${digest.weeks.length - 1 - i}w`}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-400">
        <span><span className="mr-1 inline-block h-2 w-2 bg-slate-300" />Went outside</span>
        <span><span className="mr-1 inline-block h-2 w-2 bg-slate-600" />Opened door only</span>
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
}

function RecentIncidents({ incidents, settings }: { incidents: Incident[]; settings: Settings }) {
  return (
    <section className="card">
      <h2 className="label">Recent nights</h2>
      {incidents.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {incidents.slice(0, 8).map((i) => (
            <li key={i.id} className="flex items-center justify-between py-2">
              <span>
                {new Date(i.doorOpenedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                <span className="text-slate-400">{clock(i.doorOpenedAt, settings.timezone)}</span>
                {i.simulated && <span className="ml-2 text-xs text-slate-500">sim</span>}
              </span>
              <span className="text-slate-300">{STATE_LABEL[i.state]}</span>
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
      <h2 className="label">Demo simulator</h2>
      <p className="mb-3 text-sm text-slate-400">
        Sends signed, Ring-format webhooks from simulated devices into the same pipeline real Ring events use.
      </p>
      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <button key={s.id} className="btn" onClick={() => onRun(s.id)}>
            ▶ {s.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        <button className="btn" onClick={onDemoTiming}>Use demo timing (20s grace, always on)</button>
        <button className="btn" onClick={onSeed}>Seed 6 weeks of history</button>
        <button className="btn" onClick={onClear}>Clear simulated data</button>
      </div>
    </section>
  )
}

function TokenBox({ expiresAt, now, onToken }: { expiresAt: number | null; now: number; onToken: (t: string) => void }) {
  const [value, setValue] = useState('')
  const remaining = expiresAt ? Math.floor((expiresAt - now) / 1000) : null
  const status =
    remaining === null
      ? 'No Playground token in use'
      : remaining > 0
        ? `Playground token valid for ${formatDuration(remaining)}`
        : 'Playground token expired'
  return (
    <div className="mb-4 rounded-md border border-line p-3">
      <p className={`mb-2 text-xs ${remaining !== null && remaining <= 0 ? 'text-alarm' : 'text-slate-400'}`}>{status}</p>
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
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label mb-0">Ring devices</h2>
        <button className="btn py-1 text-xs" onClick={onRefresh}>Refresh from Ring</button>
      </div>
      <TokenBox expiresAt={tokenExpiresAt} now={now} onToken={onToken} />
      <ul className="mb-4 space-y-1 text-sm">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {d.name} {d.source === 'simulator' && <span className="text-xs text-slate-500">(simulated)</span>}
            </span>
            {d.e2eEncrypted && (
              <span className="shrink-0 rounded border border-line px-1.5 text-xs text-slate-400" title="Video is end-to-end encrypted: alerts use sensors only">
                🔒 E2EE
              </span>
            )}
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
      <h2 className="label">Settings</h2>
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
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.acceptGenericMotion} onChange={(e) => set('acceptGenericMotion', e.target.checked)} />
          Treat unclassified motion as a person (Ring Smart Alerts off)
        </label>
      </div>
      <button className="btn-primary mt-4" onClick={() => onSave(draft)}>Save</button>
    </section>
  )
}

function EventLog({ events, devices, timezone }: { events: HomeEvent[]; devices: Device[]; timezone: string }) {
  const name = (id: string) => devices.find((d) => d.id === id)?.name ?? id
  return (
    <section className="card">
      <h2 className="label">Raw Ring events</h2>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">No webhooks received yet.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
          {events.map((e) => (
            <li key={e.requestId} className="flex gap-3 text-slate-300">
              <span className="text-slate-500">{clock(e.at, timezone)}</span>
              <span className="text-white">{e.type}{e.subType ? `:${e.subType}` : ''}</span>
              <span className="truncate text-slate-400">{name(e.deviceId)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
