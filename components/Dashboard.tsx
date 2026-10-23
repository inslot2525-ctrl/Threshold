'use client'

import { useCallback, useEffect, useState } from 'react'
import DoorScene from '@/components/DoorScene'
import Icon, { type IconName } from '@/components/Icon'
import { IncidentDetails, Timeline, clock } from '@/components/IncidentCard'
import LivePorchView from '@/components/LivePorchView'
import PhoneCamView from '@/components/PhoneCamView'
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
  phoneCamLive: boolean
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
    return <main className="p-8 font-mono text-muted">{error ?? 'Loading…'}</main>
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-porch text-ink">
            <Icon name="door" className="h-7 w-7" />
          </div>
          <div>
            <h1 className="font-serif text-4xl leading-none text-paper sm:text-5xl">Threshold</h1>
            <p className="mt-1 text-muted">Night-exit alerts for the front door</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl tabular-nums text-paper">{clock(now, state.settings.timezone)}</p>
          <Integrations integrations={state.integrations} />
        </div>
      </header>

      {error && <div className="rounded-lg border border-alarm/50 px-4 py-3 text-alarm">{error}</div>}

      <StatusHero state={state} now={now} onResolve={(id, outcome) => act(() => send(`/api/incidents/${id}`, 'POST', { outcome }))} />

      {/* The porch feed stays up through every state; detection only grabs a still from it. */}
      {state.phoneCamLive && (
        <section className="card">
          <h2 className="heading">
            <span className="icon-tile">
              <Icon name="camera" />
            </span>
            Porch camera
          </h2>
          <div className="mt-5 md:w-2/3">
            <PhoneCamView />
          </div>
        </section>
      )}

      <StatTiles state={state} />

      <HowItWorks />

      <div className="grid gap-6 lg:grid-cols-5 [&>*]:min-w-0">
        <div className="lg:col-span-3">
          <WeeklyTrend digest={state.digest} />
        </div>
        <div className="lg:col-span-2">
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

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <DevicesPanel
          devices={state.devices}
          settings={state.settings}
          onMap={(patch) => act(() => send('/api/settings', 'PUT', patch))}
          onRefresh={() => act(() => send('/api/devices', 'POST'))}
        />
        <SettingsPanel settings={state.settings} onSave={(patch) => act(() => send('/api/settings', 'PUT', patch))} />
      </div>

      <DeveloperPanel
        events={state.events}
        devices={state.devices}
        timezone={state.settings.timezone}
        tokenExpiresAt={state.ringTokenExpiresAt}
        now={now}
        onToken={(token) => act(() => send('/api/ring/token', 'POST', { token }))}
      />

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5 text-sm text-muted">
        <span>Threshold · built on the Ring Partner API</span>
        <span className="flex items-center gap-1.5">
          <Icon name="shield" className="h-4 w-4" /> Clothing descriptions only, never faces
        </span>
      </footer>
    </main>
  )
}

function Integrations({ integrations }: { integrations: DashboardState['integrations'] }) {
  const items: [string, boolean][] = [
    ['Ring', integrations.ring],
    [integrations.describer, integrations.bedrock],
    ['SNS', integrations.sns],
  ]
  return (
    <ul className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-1">
      {items.map(([label, on]) => (
        <li key={label} className={`tag ${on ? 'text-paper/80' : 'text-muted/60'}`} title={on ? 'Connected' : 'Not configured'}>
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
      <section className="card grid items-center gap-6 border-l-4 border-l-calm md:grid-cols-[1fr,260px]">
        <div>
          <p className="tag rounded-full bg-calm/10 px-3 py-1 text-calm">
            <span className="h-2 w-2 rounded-full bg-calm" />
            Armed
          </p>
          <p className="mt-4 font-serif text-6xl leading-none text-paper sm:text-7xl">All quiet.</p>
          <p className="mt-4 text-xl text-paper/90">{armedText(settings)}</p>
          <p className="mt-2 text-muted">
            You&apos;ll get an alert if {name} goes out and doesn&apos;t come back within {grace}
            {settings.returnGraceSeconds >= 60 ? ' minutes' : ''}. Sleep well.
          </p>
        </div>
        <div className="mx-auto w-full max-w-[260px]">
          <DoorScene mood="calm" />
        </div>
      </section>
    )
  }

  if (active.state === 'watching') {
    const remaining = Math.max(0, Math.ceil((active.doorOpenedAt + settings.returnGraceSeconds * 1000 - now) / 1000))
    return (
      <section className="card grid items-center gap-6 border-l-4 border-l-watch md:grid-cols-[1fr,260px]">
        <div>
          <p className="tag rounded-full bg-watch/10 px-3 py-1 text-watch">
            <span className="blink h-2 w-2 rounded-full bg-watch" />
            Watching
          </p>
          <p className="mt-4 font-serif text-5xl leading-tight text-paper sm:text-6xl">
            Door opened at {clock(active.doorOpenedAt, settings.timezone)}
            {active.personSeenAt ? '.' : '…'}
          </p>
          <p className="mt-3 text-lg text-paper/85">
            {active.personSeenAt
              ? `${name} was seen outside. Alerting unless the door opens again.`
              : 'Checking the porch camera for someone outside…'}
          </p>
          {active.personSeenAt && (
            <div className="mt-5 inline-flex items-baseline gap-3 rounded-xl border border-watch/40 px-5 py-3">
              <span className="label mb-0">Alert in</span>
              <span className="font-mono text-4xl tabular-nums text-watch">{formatDuration(remaining)}</span>
            </div>
          )}
          <div className="mt-6 border-t border-line pt-4">
            <Timeline incident={active} timezone={settings.timezone} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[260px]">
          <DoorScene mood="watch" />
        </div>
      </section>
    )
  }

  const minutesOut = Math.max(1, Math.floor((now - active.doorOpenedAt) / 60_000))
  const camera = state.devices.find((d) => d.id === settings.outdoorCameraId)
  const canStreamLive = camera?.source === 'ring' && !camera.e2eEncrypted
  return (
    <section className="overflow-hidden rounded-xl border-2 border-alarm bg-panel" role="alert">
      <div className="flex items-center justify-between gap-3 bg-alarm px-5 py-3 text-ink sm:px-7">
        <p className="flex items-center gap-2.5 text-lg font-bold">
          <span className="blink h-2.5 w-2.5 rounded-full bg-ink" />
          {name} has left home
        </p>
        <p className="font-mono text-lg font-semibold">{minutesOut} min out</p>
      </div>
      <div className="p-5 sm:p-7">
        <div className="grid items-center gap-6 md:grid-cols-[1fr,220px]">
          <div>
            <p className="font-serif text-5xl leading-tight text-paper sm:text-6xl">
              Out since {clock(active.doorOpenedAt, settings.timezone)}.
            </p>
            <p className="mt-3 text-lg text-paper/85">
              The door closed behind {name} and hasn&apos;t opened again. Share the search page with neighbours.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a className="btn-primary" href={`/share/${active.shareToken}`} target="_blank" rel="noreferrer">
                <Icon name="share" className="h-5 w-5" /> Open search-party page
              </a>
              <button className="btn" onClick={() => onResolve(active.id, 'safe')}>
                <Icon name="check" className="h-5 w-5 text-calm" /> {name} is safe
              </button>
              <button className="btn text-muted" onClick={() => onResolve(active.id, 'false_alarm')}>
                False alarm
              </button>
            </div>
          </div>
          <div className="mx-auto hidden w-full max-w-[220px] md:block">
            <DoorScene mood="alarm" />
          </div>
        </div>
        {!state.phoneCamLive && canStreamLive && (
          <div className="mt-6 md:w-1/2">
            <p className="label">Porch, live</p>
            <LivePorchView autoStart captureForIncidentId={active.snapshot?.status === 'ok' ? undefined : active.id} />
          </div>
        )}
        <div className="mt-6 border-t border-line pt-6">
          <IncidentDetails incident={active} settings={settings} />
        </div>
      </div>
    </section>
  )
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function perWeek(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function StatTiles({ state }: { state: DashboardState }) {
  const { digest, incidents, devices, settings } = state
  const lastExit = incidents.find((i) => i.personSeenAt && i.state !== 'false_alarm')
  const online = devices.filter((d) => d.online !== false).length
  const rising = digest.thisWeek >= Math.max(2, digest.baseline * 2)

  const tiles: { icon: IconName; label: string; value: string; note: string; tone?: string }[] = [
    {
      icon: 'moon',
      label: 'Exits this week',
      value: String(digest.thisWeek),
      note: rising ? 'Higher than usual' : 'Within the usual range',
      tone: rising ? 'text-watch' : undefined,
    },
    { icon: 'chart', label: 'Usual per week', value: perWeek(digest.baseline), note: 'Average of the last 5 weeks' },
    {
      icon: 'history',
      label: 'Last night out',
      value: lastExit ? clock(lastExit.doorOpenedAt, settings.timezone) : '—',
      note: lastExit
        ? new Date(lastExit.doorOpenedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
        : 'No exits recorded',
    },
    { icon: 'wifi', label: 'Devices online', value: `${online}/${devices.length}`, note: 'Door sensor and cameras' },
  ]

  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card p-5 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="label mb-0">{t.label}</span>
            <Icon name={t.icon} className="h-5 w-5 text-muted" />
          </div>
          <p className={`mt-3 font-serif text-5xl leading-none ${t.tone ?? 'text-paper'}`}>{t.value}</p>
          <p className="mt-2 text-sm text-muted">{t.note}</p>
        </div>
      ))}
    </section>
  )
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'door', title: 'Door opens', text: 'The Ring contact sensor reports the front door opening at night.' },
  { icon: 'camera', title: 'Camera confirms', text: 'The porch camera sees a person, not a car, a delivery or a cat.' },
  { icon: 'clock', title: 'Short wait', text: 'If they come straight back in, nobody gets woken up.' },
  { icon: 'bell', title: 'You get alerted', text: 'Email, live porch view and a description of what they are wearing.' },
]

function HowItWorks() {
  return (
    <section className="card">
      <h2 className="heading">
        <span className="icon-tile">
          <Icon name="shield" />
        </span>
        How Threshold keeps watch
      </h2>
      <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-porch">
                <Icon name={s.icon} className="h-5 w-5" />
              </span>
              <span className="font-mono text-sm text-muted">0{i + 1}</span>
              {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-line lg:block" aria-hidden />}
            </div>
            <p className="mt-3 text-lg font-semibold text-paper">{s.title}</p>
            <p className="mt-1 text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function WeeklyTrend({ digest }: { digest: Digest }) {
  const max = Math.max(1, ...digest.weeks.map((w) => w.doorOpenings))
  const rising = digest.thisWeek >= Math.max(2, digest.baseline * 2)
  return (
    <section className="card h-full">
      <h2 className="heading">
        <span className="icon-tile">
          <Icon name="chart" />
        </span>
        Night exits, last 6 weeks
      </h2>
      <p className={`mb-6 mt-3 ${rising ? 'text-watch' : 'text-muted'}`}>{digest.message}</p>
      <div className="flex h-48 gap-3 border-b border-line" aria-label="Weekly night exits chart">
        {digest.weeks.map((w, i) => {
          const last = i === digest.weeks.length - 1
          return (
            <div key={w.weekStart} className="group relative flex min-h-0 flex-1 flex-col justify-end gap-[2px]">
              {w.doorOpenings > 0 && (
                <span className="absolute -top-6 left-0 right-0 text-center font-mono text-sm text-muted opacity-0 transition-opacity group-hover:opacity-100">
                  {w.exits}
                </span>
              )}
              <div
                className="w-full rounded-t-md bg-line"
                style={{ height: `${((w.doorOpenings - w.exits) / max) * 100}%` }}
                title={`${w.doorOpenings - w.exits} door openings with no exit`}
              />
              <div
                className={`w-full ${w.doorOpenings - w.exits === 0 ? 'rounded-t-md' : ''} ${last && rising ? 'bg-watch' : 'bg-paper/80'}`}
                style={{ height: `${(w.exits / max) * 100}%` }}
                title={`${w.exits} night exits`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-3">
        {digest.weeks.map((w, i) => (
          <span key={w.weekStart} className={`flex-1 text-center font-mono text-sm ${i === digest.weeks.length - 1 ? 'text-paper' : 'text-muted'}`}>
            {i === digest.weeks.length - 1 ? 'This wk' : `-${digest.weeks.length - 1 - i}w`}
          </span>
        ))}
      </div>
      <div className="mt-5 flex gap-5 text-sm text-muted">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-paper/80" />
          Went outside
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-line" />
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

const STATE_STYLE: Record<Incident['state'], string> = {
  watching: 'bg-watch/10 text-watch',
  alerted: 'bg-alarm/10 text-alarm',
  returned: 'bg-calm/10 text-calm',
  safe: 'bg-calm/10 text-calm',
  false_alarm: 'bg-white/5 text-muted',
  no_exit: 'bg-white/5 text-muted',
  expired: 'bg-white/5 text-muted',
}

function RecentIncidents({ incidents, settings }: { incidents: Incident[]; settings: Settings }) {
  return (
    <section className="card h-full">
      <h2 className="heading">
        <span className="icon-tile">
          <Icon name="history" />
        </span>
        Recent nights
      </h2>
      {incidents.length === 0 ? (
        <p className="mt-4 text-muted">Nothing yet. Quiet nights so far.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {incidents.slice(0, 6).map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block text-paper">
                  {new Date(i.doorOpenedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
                <span className="font-mono text-sm text-muted">
                  {clock(i.doorOpenedAt, settings.timezone)}
                  {i.simulated && ' · simulated'}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${STATE_STYLE[i.state]}`}>
                {STATE_LABEL[i.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const SCENARIO_ICON: Record<string, IconName> = {
  night_exit: 'walk',
  steps_out_returns: 'history',
  door_only: 'door',
  delivery: 'camera',
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
      <h2 className="heading">
        <span className="icon-tile">
          <Icon name="play" />
        </span>
        Try a scenario
      </h2>
      <p className="mt-2 text-muted">
        Simulated door and camera events, sent in Ring&apos;s own webhook format through the same pipeline real devices use.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className="group flex flex-col items-start gap-3 rounded-xl border border-line p-4 text-left transition-colors hover:border-porch/60 hover:bg-porch/[0.06]"
            onClick={() => onRun(s.id)}
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/5 text-paper transition-colors group-hover:bg-porch group-hover:text-ink">
              <Icon name={SCENARIO_ICON[s.id] ?? 'play'} />
            </span>
            <span className="font-medium leading-snug text-paper">{s.label}</span>
            <span className="mt-auto flex items-center gap-1.5 text-sm text-porch">
              <Icon name="play" className="h-3.5 w-3.5" /> Run
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
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

function DevicesPanel({
  devices,
  settings,
  onMap,
  onRefresh,
}: {
  devices: Device[]
  settings: Settings
  onMap: (patch: Partial<Settings>) => void
  onRefresh: () => void
}) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="heading">
          <span className="icon-tile">
            <Icon name="wifi" />
          </span>
          Ring devices
        </h2>
        <button className="btn px-3 py-1.5 text-sm" onClick={onRefresh}>Refresh</button>
      </div>
      <ul className="mt-5 space-y-2.5">
        {devices.map((d) => {
          const role =
            d.id === settings.doorSensorId ? 'Front door' : d.id === settings.outdoorCameraId ? 'Porch camera' : null
          return (
            <li key={d.id} className="flex items-center gap-4 rounded-xl border border-line px-4 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5 text-paper">
                <Icon name={d.hasVideo ? 'camera' : d.kind === 'contact_sensor' ? 'sensor' : 'wifi'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-paper">{d.name}</span>
                <span className="text-sm text-muted">
                  {d.hasVideo ? 'Camera' : d.kind === 'contact_sensor' ? 'Contact sensor' : 'Device'}
                  {d.source === 'simulator' && ' · simulated'}
                  {d.e2eEncrypted && ' · end-to-end encrypted'}
                </span>
              </span>
              {role && <span className="shrink-0 rounded-full bg-porch/10 px-3 py-1 text-sm text-porch">{role}</span>}
            </li>
          )
        })}
      </ul>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <label className="label" htmlFor="door">Front door sensor</label>
          <select
            id="door"
            className="input"
            value={settings.doorSensorId ?? ''}
            onChange={(e) => onMap({ doorSensorId: e.target.value || null })}
          >
            <option value="">Not set</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
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
        </div>
      </div>
    </section>
  )
}

function SettingsPanel({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <section className="card">
      <h2 className="heading">
        <span className="icon-tile">
          <Icon name="sliders" />
        </span>
        Settings
      </h2>
      <div className="mt-5 grid grid-cols-2 gap-4 [&>*]:min-w-0">
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
        <label className="col-span-2 mt-1 flex items-start gap-3 text-paper/90">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-porch"
            checked={draft.acceptGenericMotion}
            onChange={(e) => set('acceptGenericMotion', e.target.checked)}
          />
          Treat unclassified motion as a person (for cameras with Ring Smart Alerts off)
        </label>
      </div>
      <button className="btn-primary mt-6" onClick={() => onSave(draft)}>Save settings</button>
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
    <div>
      <p className="label">Ring Playground token</p>
      <p className={`mb-3 text-sm ${expired ? 'text-alarm' : 'text-muted'}`}>{status}</p>
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
          placeholder="Paste a new token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn shrink-0" type="submit">Use</button>
      </form>
    </div>
  )
}

function DeveloperPanel({
  events,
  devices,
  timezone,
  tokenExpiresAt,
  now,
  onToken,
}: {
  events: HomeEvent[]
  devices: Device[]
  timezone: string
  tokenExpiresAt: number | null
  now: number
  onToken: (token: string) => void
}) {
  const name = (id: string) => devices.find((d) => d.id === id)?.name ?? id
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="heading">
          <span className="icon-tile bg-white/5 text-muted">
            <Icon name="code" />
          </span>
          Developer
        </span>
        <span className="text-sm text-muted group-open:hidden">Ring token and raw webhook events</span>
        <span className="hidden text-sm text-muted group-open:inline">Hide</span>
      </summary>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr,2fr]">
        <TokenBox expiresAt={tokenExpiresAt} now={now} onToken={onToken} />
        <div className="min-w-0">
          <p className="label">Raw Ring events, newest first</p>
          {events.length === 0 ? (
            <p className="text-muted">No webhooks received yet.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink p-3 font-mono text-sm">
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
        </div>
      </div>
    </details>
  )
}
