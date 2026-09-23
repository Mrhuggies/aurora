import { derive } from './physics'
import { BIN_MS, type Derived, type Sample, type Timeline } from './types'

export const SPEEDS = [
  { label: '1 h / 8 s', minutesPerSecond: 7.5 },
  { label: '1 h / 3 s', minutesPerSecond: 20 },
  { label: '1 h / 1 s', minutesPerSecond: 60 },
] as const

const KEYS = ['speed', 'density', 'temp', 'bx', 'by', 'bz', 'bt', 'xray', 'dst'] as const

export interface Frame {
  sample: Sample
  derived: Derived
  progress: number
}

export class Player {
  timeline: Timeline
  /** Fractional sample index. */
  pos = 0
  playing = true
  speedIndex = 1
  /** Per-sample aurora intensity, for the timeline strip and peak finding. */
  intensities: Float32Array
  frame: Frame
  onLoop?: () => void

  constructor(timeline: Timeline) {
    this.timeline = timeline
    this.intensities = this.computeIntensities()
    this.pos = this.defaultStart()
    this.frame = this.compute()
  }

  setTimeline(timeline: Timeline) {
    const t = this.frame.sample.t
    this.timeline = timeline
    this.intensities = this.computeIntensities()
    this.seekTime(t)
  }

  /** Replace the data and rewind to the default starting point (used for the first real load). */
  load(timeline: Timeline) {
    this.timeline = timeline
    this.intensities = this.computeIntensities()
    this.pos = this.defaultStart()
    this.frame = this.compute()
  }

  get length() {
    return this.timeline.samples.length
  }

  tick(dt: number) {
    if (this.playing && this.length > 1) {
      const samplesPerSecond = SPEEDS[this.speedIndex].minutesPerSecond / (BIN_MS / 60000)
      this.pos += dt * samplesPerSecond
      if (this.pos >= this.length - 1) {
        this.pos = 0
        this.onLoop?.()
      }
    }
    this.frame = this.compute()
    return this.frame
  }

  seek(fraction: number) {
    this.pos = Math.max(0, Math.min(1, fraction)) * (this.length - 1)
    this.frame = this.compute()
  }

  seekTime(t: number) {
    const s = this.timeline.samples
    if (s.length === 0) return
    this.seek((t - s[0].t) / (s[s.length - 1].t - s[0].t || 1))
  }

  step(hours: number) {
    this.pos = Math.max(0, Math.min(this.length - 1, this.pos + (hours * 3600000) / BIN_MS))
    this.frame = this.compute()
  }

  jumpToPeak() {
    let best = 0
    for (let i = 1; i < this.intensities.length; i++) if (this.intensities[i] > this.intensities[best]) best = i
    // Arrive a little before the peak so the build-up is audible.
    this.pos = Math.max(0, best - (90 * 60000) / BIN_MS)
    this.frame = this.compute()
  }

  jumpToNow() {
    this.pos = Math.max(0, this.length - 1 - (30 * 60000) / BIN_MS)
    this.frame = this.compute()
  }

  private defaultStart() {
    // Open six hours before the most active moment so a first-time visitor hears a storm develop.
    let best = 0
    for (let i = 1; i < this.intensities.length; i++) if (this.intensities[i] > this.intensities[best]) best = i
    return Math.max(0, best - (6 * 3600000) / BIN_MS)
  }

  private computeIntensities() {
    const s = this.timeline.samples
    const out = new Float32Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = derive(s[i]).intensity
    return out
  }

  private compute(): Frame {
    const s = this.timeline.samples
    const i = Math.min(Math.floor(this.pos), s.length - 1)
    const j = Math.min(i + 1, s.length - 1)
    const f = this.pos - i
    const a = s[i]
    const b = s[j]
    const sample = { ...a, t: a.t + (b.t - a.t) * f }
    for (const k of KEYS) sample[k] = a[k] + (b[k] - a[k]) * f
    return { sample, derived: derive(sample), progress: this.pos / Math.max(1, s.length - 1) }
  }
}
