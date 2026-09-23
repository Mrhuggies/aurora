import type { CSSProperties } from 'react'
import type { Frame } from '../data/player'
import type { Timeline } from '../data/types'
import type { ViewId } from '../scene/Stage'
import { formatAgo, formatClock, formatDay, kpLabel, minus } from './format'

interface Props {
  frame: Frame
  data: Timeline | null
  mode: string | null
  view: ViewId
  onView: (v: ViewId) => void
  audioOn: boolean
  onToggleAudio: () => void
  showKey: boolean
  onToggleKey: () => void
}

const VIEWS: { id: ViewId; label: string; key: string }[] = [
  { id: 'sky', label: 'Sky', key: '1' },
  { id: 'earth', label: 'Earth', key: '2' },
  { id: 'magnetosphere', label: 'Magnetosphere', key: '3' },
]

const clamp = (x: number) => Math.min(1, Math.max(0, x))

function Readout(props: { label: string; value: string; unit?: string; note?: string; level?: number; tone?: string }) {
  return (
    <div className="readout" style={props.tone ? ({ '--tone': `var(${props.tone})` } as CSSProperties) : undefined}>
      <span className="r-label">{props.label}</span>
      <span className="r-value">
        {props.value}
        {props.unit && <span className="r-unit">{props.unit}</span>}
      </span>
      {props.note && <span className="r-note">{props.note}</span>}
      {props.level !== undefined && (
        <span className="r-bar" aria-hidden>
          <span style={{ transform: `scaleX(${clamp(props.level)})` }} />
        </span>
      )}
    </div>
  )
}

export function describe({ sample: s, derived: d }: Frame): string {
  const parts: string[] = []
  if (d.gScale >= 1) {
    parts.push(`G${d.gScale} geomagnetic storm — the oval has pushed down to about ${Math.round(d.ovalEdge)}° magnetic latitude`)
  } else if (s.bz < -5 && s.speed > 500) {
    parts.push('Fast wind and a strongly southward field — energy is pouring into the magnetosphere')
  } else if (s.bz < -3) {
    parts.push('The field has turned south and is reconnecting with Earth’s — the aurora brightens')
  } else if (s.bz > 3) {
    parts.push('Northward field keeps the magnetosphere mostly closed — faint, distant arcs')
  } else if (s.speed > 550) {
    parts.push('A fast stream from a coronal hole is buffeting the magnetosphere')
  } else {
    parts.push('Quiet conditions — soft arcs low on the northern horizon')
  }
  if (s.xray >= 1e-5) parts.push(`${d.flareClass} solar flare`)
  if (d.standoff < 8) parts.push(`magnetopause squeezed to ${d.standoff.toFixed(1)} Rₑ`)
  return parts.join(' · ')
}

export function Hud(p: Props) {
  const { sample: s, derived: d } = p.frame
  const live = p.data?.source === 'live'
  const kpTone = d.gScale >= 3 ? '--c-storm' : d.gScale >= 1 ? '--c-amber' : '--c-kp'
  return (
    <>
      <header className="hud hud-tl">
        <div className="brand">
          <span className="wordmark sm">Aurora</span>
        </div>
        <div className={`source ${live ? 'live' : 'sim'}`}>
          <span className={`dot ${live ? 'live' : 'simulated'}`} />
          {live ? 'Live · NOAA SWPC' : p.data ? 'Simulated week' : 'Loading…'}
        </div>
        <div className="when">
          <span className="day">{formatDay(s.t)}</span>
          <span className="clock">{formatClock(s.t)}</span>
          <span className="utc">UTC</span>
        </div>
        <div className="ago">{formatAgo(s.t, live ? Date.now() : (p.data?.samples.at(-1)?.t ?? Date.now()))}</div>
      </header>

      <section className="hud readouts" aria-label="Current conditions">
        <Readout label="Solar wind" value={String(Math.round(s.speed))} unit="km/s" level={(s.speed - 250) / 600} tone="--c-wind" />
        <Readout label="Density" value={s.density.toFixed(1)} unit="p/cm³" level={s.density / 20} tone="--c-density" />
        <Readout label="Field Bt" value={s.bt.toFixed(1)} unit="nT" level={s.bt / 25} tone="--c-bt" />
        <Readout
          label="Bz"
          value={minus(s.bz)}
          unit="nT"
          note={s.bz < -1 ? '↓ south' : s.bz > 1 ? '↑ north' : '· neutral'}
          level={Math.abs(s.bz) / 15}
          tone={s.bz < -1 ? '--c-storm' : '--c-calm'}
        />
        <Readout label="Kp" value={kpLabel(s.kp)} note={d.gScale ? `G${d.gScale} storm` : undefined} level={s.kp / 9} tone={kpTone} />
        <Readout label="X-ray" value={d.flareClass} level={d.flareLevel} tone={s.xray >= 1e-5 ? '--c-storm' : '--c-flare'} />
        <div className="rule" />
        <Readout label="Coupling" value={String(Math.round(d.intensity * 100))} unit="%" level={d.intensity} tone="--c-aurora" />
        <Readout label="Magnetopause" value={d.standoff.toFixed(1)} unit="Rₑ" level={(12 - d.standoff) / 6} tone="--c-calm" />
        <Readout label="Oval edge" value={`${Math.round(d.ovalEdge)}°`} unit="mag lat" />
        {p.mode && <Readout label="Harmony" value={p.mode} tone="--c-violet" />}
      </section>

      <p className="hud caption" aria-live="off">{describe(p.frame)}</p>

      <nav className="hud hud-tr" aria-label="View and sound">
        <div className="seg" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={p.view === v.id}
              className={p.view === v.id ? 'on' : ''}
              onClick={() => p.onView(v.id)}
              title={`${v.label} (${v.key})`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button className={`pill ${p.audioOn ? 'on' : ''}`} onClick={p.onToggleAudio} aria-pressed={p.audioOn} title="Sound (M)">
            <SoundIcon on={p.audioOn} /> {p.audioOn ? 'Sound on' : 'Sound off'}
          </button>
          <button className={`pill ${p.showKey ? 'on' : ''}`} onClick={p.onToggleKey} aria-pressed={p.showKey} title="Key (K)">
            Key
          </button>
        </div>
      </nav>
    </>
  )
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor" />
      {on ? (
        <path d="M11 5.5c1 .8 1.5 1.6 1.5 2.5s-.5 1.7-1.5 2.5M12.8 3.5c1.5 1.3 2.2 2.8 2.2 4.5s-.7 3.2-2.2 4.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  )
}
