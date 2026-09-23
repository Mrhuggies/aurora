import type { Timeline } from '../data/types'
import { formatClock, formatDay, kpLabel } from './format'

interface Props {
  data: Timeline | null
  onEnter: (withSound: boolean) => void
}

function summary(data: Timeline) {
  const s = data.samples
  let peakKp = 0
  let maxSpeed = 0
  for (const x of s) {
    peakKp = Math.max(peakKp, x.kp)
    maxSpeed = Math.max(maxSpeed, x.speed)
  }
  return { peakKp, maxSpeed, from: s[0].t, to: s[s.length - 1].t }
}

export function Intro({ data, onEnter }: Props) {
  const sum = data ? summary(data) : null
  return (
    <div className="intro">
      <div className="intro-inner">
        <p className="eyebrow">Space weather · light · sound</p>
        <h1 className="wordmark">Aurora</h1>
        <p className="lede">
          Right now a wind of charged particles is streaming off the Sun at hundreds of kilometres a second. Where it
          couples into Earth’s magnetic field, energy pours down toward the poles and sets the upper atmosphere glowing.
        </p>
        <p className="lede dim">
          This replays the last seven days of that wind, as measured a million and a half kilometres upstream and
          timed to its arrival at Earth. Every curtain of light and every note is driven by the real measurements.
        </p>

        <div className="intro-status" aria-live="polite">
          {!data && <span className="pulse">Contacting NOAA Space Weather Prediction Center…</span>}
          {data && sum && (
            <>
              <span className={`dot ${data.source}`} />
              {data.source === 'live' ? (
                <span>
                  Live NOAA data · {formatDay(sum.from)} → {formatDay(sum.to)} {formatClock(sum.to)} UTC · peak Kp{' '}
                  {kpLabel(sum.peakKp)} · wind to {Math.round(sum.maxSpeed)} km/s
                </span>
              ) : (
                <span>NOAA is unreachable ({data.error}). Playing a simulated week instead.</span>
              )}
            </>
          )}
        </div>

        <div className="intro-actions">
          <button className="btn primary" onClick={() => onEnter(true)} disabled={!data}>
            Enter with sound
          </button>
          <button className="btn ghost" onClick={() => onEnter(false)} disabled={!data}>
            Enter silently
          </button>
        </div>
        <p className="hint">Headphones recommended · drag to look around · press K for the key</p>
      </div>
    </div>
  )
}
