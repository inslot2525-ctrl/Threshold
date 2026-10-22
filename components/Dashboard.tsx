'use client'

import { useCallback, useEffect, useState } from 'react'
import Backdrop, { type Mood } from '@/components/Backdrop'
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

function moodOf(active: Incident | null): Mood {
  if (!active) return 'calm'
  return active.state === 'watching' ? 'watch' : 'alarm'
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
    return (
      <main className="grid min-h-screen place-items-center text-slate-400">
        <Backdrop />
        <p className="font-display text-lg lowercase">{error ?? 'waking up…'}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:py-10">
      <Backdrop mood={moodOf(state.active)} />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-lime via-calm to-lilac font-display text-xl font-extrabold text-ink shadow-[0_0_30px_-4px_rgba(196,181,253,0.6)]">
            ✦
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold lowercase tracking-tight text-white">threshold</h1>
            <p className="text-sm text-slate-400">
              night-exit alerts for <span className="text-lilac">{state.settings.personName}</span>&apos;s front door
            </p>
          </div>
        </div>
        <Integrations integrations={state.integrations} />
      </header>

      {error && (
        <div className="rounded-2xl border border-alarm/40 bg-alarm/10 px-4 py-2.5 text-sm text-alarm">{error}</div>
      )}

      <StatusHero state={state} now={now} onResolve={(id, outcome) => act(() => send(`/api/incidents/${id}`, 'POST', { outcome }))} />

      <div className="grid gap-5 md:grid-cols-5">
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

      <footer className="pb-4 pt-2 text-center text-xs text-slate-500">
        built on ring · amazon bedrock · amazon sns <span className="text-lilac">✦</span> no faces, ever
      </footer>
    </main>
  )
}

function Integrations({ integrations }: { integrations: DashboardState['integrations'] }) {
  const chips: [string, boolean][] = [
    ['Ring API', integrations.ring],
    ['Signed webhooks', integrations.webhookSigned],
    [integrations.describer, integrations.bedrock],
    ['SNS alerts', integrations.sns],
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([label, on]) => (
        <span
          key={label}
          className={`chip backdrop-blur ${on ? 'border-calm/30 bg-calm/10 text-calm' : 'border-white/10 bg-white/[0.03] text-slate-500'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-calm shadow-[0_0_8px_#6EE7B7]' : 'bg-slate-600'}`} />
          {label}
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
    const grace = Math.round(settings.returnGraceSeconds / 60) || `${settings.returnGraceSeconds}s`
    return (
      <section className="card fade-up overflow-hidden border-calm/20 sm:p-8">
        <div className="flex items-center gap-5">
          <span className="orb text-calm" />
          <div>
            <p className="font-display text-4xl font-bold lowercase tracking-tight sm:text-5xl">
              <span className="gradient-text">all quiet</span> <span className="text-lilac">✦</span>
            </p>
            <p className="mt-1 text-base text-slate-200 sm:text-lg">{armedText(settings)}</p>
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-sm text-slate-400">
          You&apos;ll be alerted if {name} goes out and doesn&apos;t come back within {grace}
          {settings.returnGraceSeconds >= 60 ? ' minutes' : ''}. Sleep well, we&apos;ve got the door.
        </p>
      </section>
    )
  }

  if (active.state === 'watching') {
    const remaining = Math.max(0, Math.ceil((active.doorOpenedAt + settings.returnGraceSeconds * 1000 - now) / 1000))
    return (
      <section className="card fade-up border-watch/40 bg-watch/[0.06] sm:p-8">
        <div className="flex items-center gap-5">
          <span className="orb text-watch" data-fast />
          <div>
            <p className="font-display text-3xl font-bold lowercase tracking-tight text-watch sm:text-4xl">eyes on the door</p>
            <p className="mt-1 text-lg text-white">
              Front door opened at {clock(active.doorOpenedAt, settings.timezone)}
              {active.personSeenAt ? `. ${name} was seen outside.` : '.'}
            </p>
          </div>
          {active.personSeenAt && (
            <div className="ml-auto hidden text-right sm:block">
              <p className="label">alerting in</p>
              <p className="font-display text-4xl font-bold tabular-nums text-white">{formatDuration(remaining)}</p>
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-slate-300">
          {active.personSeenAt
            ? `Alerting in ${formatDuration(remaining)} unless the door opens again.`
            : 'Checking the porch camera for someone outside…'}
        </p>
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          <Timeline incident={active} timezone={settings.timezone} />
        </div>
      </section>
    )
  }

  const minutesOut = Math.max(1, Math.floor((now - active.doorOpenedAt) / 60_000))
  const camera = state.devices.find((d) => d.id === settings.outdoorCameraId)
  const canStreamLive = camera?.source === 'ring' && !camera.e2eEncrypted
  return (
    <section
      className="card fade-up border-alarm/60 bg-alarm/[0.08] shadow-[0_0_80px_-20px_rgba(251,113,133,0.6)] sm:p-8"
      role="alert"
    >
      <div className="flex flex-wrap items-center gap-5">
        <span className="orb text-alarm" data-fast />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-alarm">{name} has left home</p>
          <p className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Out since {clock(active.doorOpenedAt, settings.timezone)}
          </p>
        </div>
        <div className="ml-auto rounded-2xl border border-alarm/40 bg-alarm/10 px-4 py-2 text-center">
          <p className="font-display text-3xl font-bold tabular-nums text-white">{minutesOut}</p>
          <p className="text-[11px] uppercase tracking-widest text-alarm">min out</p>
        </div>
      </div>
      {canStreamLive && (
        <div className="mt-6 md:w-1/2">
          <p className="label">porch right now</p>
          <LivePorchView autoStart captureForIncidentId={active.snapshot?.status === 'ok' ? undefined : active.id} />
        </div>
      )}
      <div className="mt-6">
        <IncidentDetails incident={active} settings={settings} />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <a className="btn-primary" href={`/share/${active.shareToken}`} target="_blank" rel="noreferrer">
          Open search-party page ↗
        </a>
        <button className="btn border-calm/30 text-calm" onClick={() => onResolve(active.id, 'safe')}>
          ✓ {name} is safe
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
    <section className="card h-full">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="heading">night exits</h2>
        <span className="text-xs text-slate-500">last 6 weeks</span>
      </div>
      <p className={`mb-5 mt-1 text-sm ${rising ? 'text-watch' : 'text-slate-400'}`}>
        {rising && '⚠ '}
        {digest.message}
      </p>
      <div className="flex h-40 gap-3" aria-label="Weekly night exits chart">
        {digest.weeks.map((w, i) => {
          const last = i === digest.weeks.length - 1
          return (
            <div key={w.weekStart} className="group flex flex-1 flex-col items-center gap-1.5">
              <div className="flex min-h-0 w-full flex-1 flex-col justify-end gap-[2px]">
                <div
                  className="w-full rounded-t-lg bg-white/10 transition group-hover:bg-white/20"
                  style={{ height: `${((w.doorOpenings - w.exits) / max) * 100}%` }}
                  title={`${w.doorOpenings - w.exits} door openings with no exit`}
                />
                <div
                  className={`w-full rounded-b-md transition group-hover:brightness-125 ${
                    last && rising ? 'bg-gradient-to-t from-alarm to-watch' : 'bg-gradient-to-t from-grape to-lilac'
                  } ${w.doorOpenings - w.exits === 0 ? 'rounded-t-lg' : ''}`}
                  style={{ height: `${(w.exits / max) * 100}%` }}
                  title={`${w.exits} night exits`}
                />
              </div>
              <span className={`text-xs ${last ? 'font-semibold text-white' : 'text-slate-500'}`}>
                {last ? 'now' : `-${digest.weeks.length - 1 - i}w`}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-t from-grape to-lilac" />
          Went outside
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
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
  watching: 'border-watch/30 bg-watch/10 text-watch',
  alerted: 'border-alarm/30 bg-alarm/10 text-alarm',
  returned: 'border-calm/30 bg-calm/10 text-calm',
  safe: 'border-calm/30 bg-calm/10 text-calm',
  false_alarm: 'border-white/10 bg-white/5 text-slate-300',
  no_exit: 'border-lilac/30 bg-lilac/10 text-lilac',
  expired: 'border-white/10 bg-white/5 text-slate-400',
}

function RecentIncidents({ incidents, settings }: { incidents: Incident[]; settings: Settings }) {
  return (
    <section className="card h-full">
      <h2 className="heading mb-3">recent nights</h2>
      {incidents.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing yet. Quiet nights only 🌙</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {incidents.slice(0, 7).map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2 transition hover:bg-white/[0.05]"
            >
              <span>
                {new Date(i.doorOpenedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                <span className="text-slate-400">{clock(i.doorOpenedAt, settings.timezone)}</span>
                {i.simulated && <span className="ml-2 rounded-full bg-white/5 px-1.5 text-[10px] text-slate-500">sim</span>}
              </span>
              <span className={`chip shrink-0 ${STATE_STYLE[i.state]}`}>{STATE_LABEL[i.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const SCENARIO_EMOJI: Record<string, string> = {
  night_exit: '🚪',
  steps_out_returns: '↩️',
  door_only: '🔓',
  delivery: '📦',
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
    <section className="card border-dashed border-lilac/25">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading">demo lab 🧪</h2>
        <span className="text-xs text-slate-500">simulated devices, real pipeline</span>
      </div>
      <p className="mb-4 mt-1 text-sm text-slate-400">
        Sends signed, Ring-format webhooks from simulated devices into the same pipeline real Ring events use.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className="group flex flex-col items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 text-left text-sm font-medium text-white transition hover:-translate-y-0.5 hover:border-lilac/40 hover:bg-lilac/10"
            onClick={() => onRun(s.id)}
          >
            <span className="text-xl transition group-hover:scale-110">{SCENARIO_EMOJI[s.id] ?? '▶'}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
        <button className="btn" onClick={onDemoTiming}>⚡ Demo timing (20s grace, always on)</button>
        <button className="btn" onClick={onSeed}>📈 Seed 6 weeks of history</button>
        <button className="btn" onClick={onClear}>🧹 Clear simulated data</button>
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
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-3.5">
      <p className={`mb-2 flex items-center gap-1.5 text-xs ${expired ? 'text-alarm' : 'text-slate-400'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${expired ? 'bg-alarm' : remaining ? 'bg-calm' : 'bg-slate-600'}`} />
        {status}
      </p>
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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="heading">ring devices</h2>
        <button className="btn px-3 py-1 text-xs" onClick={onRefresh}>↻ Refresh</button>
      </div>
      <TokenBox expiresAt={tokenExpiresAt} now={now} onToken={onToken} />
      <ul className="mb-5 space-y-1.5 text-sm">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/[0.03] px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span>{d.hasVideo ? '📷' : d.kind === 'contact_sensor' ? '🚪' : '📡'}</span>
              <span className="truncate">{d.name}</span>
              {d.source === 'simulator' && <span className="rounded-full bg-white/5 px-1.5 text-[10px] text-slate-500">sim</span>}
            </span>
            {d.e2eEncrypted && (
              <span className="chip shrink-0 border-white/10 text-slate-400" title="Video is end-to-end encrypted: alerts use sensors only">
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
      <h2 className="heading mb-4">settings</h2>
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
        <label className="col-span-2 flex items-center gap-2.5 rounded-2xl bg-white/[0.03] px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lilac"
            checked={draft.acceptGenericMotion}
            onChange={(e) => set('acceptGenericMotion', e.target.checked)}
          />
          Treat unclassified motion as a person (Ring Smart Alerts off)
        </label>
      </div>
      <button className="btn-primary mt-5" onClick={() => onSave(draft)}>Save changes</button>
    </section>
  )
}

function EventLog({ events, devices, timezone }: { events: HomeEvent[]; devices: Device[]; timezone: string }) {
  const name = (id: string) => devices.find((d) => d.id === id)?.name ?? id
  return (
    <section className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="heading">raw ring events</h2>
        <span className="text-xs text-slate-500">webhooks, newest first</span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">No webhooks received yet.</p>
      ) : (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-2xl bg-black/30 p-3 font-mono text-xs">
          {events.map((e) => (
            <li key={e.requestId} className="flex min-w-0 gap-3 rounded-lg px-2 py-1 text-slate-300 hover:bg-white/[0.04]">
              <span className="shrink-0 text-slate-500">{clock(e.at, timezone)}</span>
              <span className="min-w-0 truncate text-lime">
                {e.type}
                {e.subType ? <span className="text-lilac">:{e.subType}</span> : ''}
              </span>
              <span className="hidden min-w-0 truncate text-slate-400 sm:inline">{name(e.deviceId)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
