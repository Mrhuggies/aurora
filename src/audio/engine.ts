import * as Tone from 'tone'
import type { Frame } from '../data/player'

const ROOT = 50 // D3

const MODES = [
  { name: 'Lydian', bz: 4, steps: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Ionian', bz: 1.5, steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Mixolydian', bz: -1.5, steps: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Dorian', bz: -4, steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Aeolian', bz: -8, steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Phrygian', bz: -Infinity, steps: [0, 1, 3, 5, 7, 8, 10] },
] as const

const PROGRESSION = [0, 5, 3, 4, 0, 2, 3, 4]

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

function degree(steps: readonly number[], d: number) {
  const oct = Math.floor(d / steps.length)
  return steps[((d % steps.length) + steps.length) % steps.length] + 12 * oct
}

export class AudioEngine {
  mode: string = MODES[1].name
  private nodes: { dispose(): unknown }[] = []
  private out!: Tone.Gain
  private droneFilter!: Tone.Filter
  private drone!: Tone.FatOscillator
  private droneFifth!: Tone.FatOscillator
  private droneLfo!: Tone.LFO
  private pad!: Tone.PolySynth
  private padFilter!: Tone.Filter
  private pluck!: Tone.PolySynth
  private pluckPan!: Tone.Panner
  private hissFilter!: Tone.Filter
  private hissGain!: Tone.Gain
  private bell!: Tone.PolySynth<Tone.FMSynth>
  private sub!: Tone.MembraneSynth
  private gong!: Tone.MetalSynth

  private modeIndex = 1
  private pendingMode = 1
  private pendingSince = 0
  private chordStep = 0
  private nextChordAt = 0
  private nextPulseAt = 0
  private bzSmooth = 0
  private speedSlow = 400
  private flareRung = -1
  private lastShock = -Infinity
  private started = false

  async start() {
    if (this.started) return
    await Tone.start()
    this.started = true
    const now = Tone.now()
    const keep = <T extends { dispose(): unknown }>(n: T) => (this.nodes.push(n), n)

    this.out = keep(new Tone.Gain(0).toDestination())
    const limiter = keep(new Tone.Limiter(-1)).connect(this.out)
    const comp = keep(new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.05, release: 0.4 })).connect(limiter)
    const reverb = keep(new Tone.Reverb({ decay: 11, preDelay: 0.04, wet: 1 })).connect(comp)
    const verbSend = keep(new Tone.Gain(0.55)).connect(reverb)
    const bus = keep(new Tone.Gain(1)).connect(comp)
    const delay = keep(new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.38, wet: 1 }))
    delay.connect(verbSend)
    delay.connect(bus)
    const delaySend = keep(new Tone.Gain(0.28)).connect(delay)

    this.droneFilter = keep(new Tone.Filter({ type: 'lowpass', frequency: 220, rolloff: -24, Q: 1.2 }))
    const droneGain = keep(new Tone.Gain(0.16))
    this.droneFilter.connect(droneGain)
    droneGain.connect(bus)
    droneGain.connect(verbSend)
    this.drone = keep(new Tone.FatOscillator({ type: 'sawtooth', count: 3, spread: 22, frequency: midiHz(ROOT - 24) }))
    this.droneFifth = keep(new Tone.FatOscillator({ type: 'sawtooth', count: 2, spread: 14, frequency: midiHz(ROOT - 17), volume: -8 }))
    this.drone.connect(this.droneFilter).start(now)
    this.droneFifth.connect(this.droneFilter).start(now)
    this.droneLfo = keep(new Tone.LFO({ frequency: 0.07, min: -500, max: 500 })).start(now)
    this.droneLfo.connect(this.droneFilter.detune)

    this.padFilter = keep(new Tone.Filter({ type: 'lowpass', frequency: 1400, rolloff: -12 }))
    const chorus = keep(new Tone.Chorus({ frequency: 0.25, delayTime: 4, depth: 0.6, wet: 0.5 })).start()
    this.padFilter.connect(chorus)
    chorus.connect(bus)
    chorus.connect(verbSend)
    this.pad = keep(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fattriangle', count: 3, spread: 18 },
      envelope: { attack: 4.5, decay: 2, sustain: 0.75, release: 8 },
      volume: -21,
    })).connect(this.padFilter)
    this.pad.maxPolyphony = 16

    this.pluckPan = keep(new Tone.Panner(0))
    this.pluckPan.connect(delaySend)
    this.pluckPan.connect(verbSend)
    this.pluckPan.connect(bus)
    this.pluck = keep(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.7, sustain: 0, release: 1.4 },
      volume: -20,
    })).connect(this.pluckPan)
    this.pluck.maxPolyphony = 12

    this.hissFilter = keep(new Tone.Filter({ type: 'bandpass', frequency: 600, Q: 0.7 }))
    this.hissGain = keep(new Tone.Gain(0))
    const hiss = keep(new Tone.Noise('pink')).connect(this.hissFilter)
    this.hissFilter.connect(this.hissGain)
    this.hissGain.connect(bus)
    this.hissGain.connect(verbSend)
    hiss.start(now)

    this.bell = keep(new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 12,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 3.5, sustain: 0, release: 3 },
      modulationEnvelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 0.5 },
      volume: -19,
    }))
    this.bell.connect(delaySend)
    this.bell.connect(verbSend)

    this.sub = keep(new Tone.MembraneSynth({
      pitchDecay: 0.4, octaves: 1.5,
      envelope: { attack: 0.03, decay: 2.8, sustain: 0, release: 1.5 },
      volume: -12,
    })).connect(bus)

    this.gong = keep(new Tone.MetalSynth({
      envelope: { attack: 0.01, decay: 6, release: 4 },
      harmonicity: 3.1, modulationIndex: 18, resonance: 900, octaves: 1.2,
      volume: -30,
    }))
    this.gong.frequency.value = 55
    this.gong.connect(verbSend)

    this.out.gain.rampTo(0.9, 3)
    this.nextChordAt = now + 0.2
  }

  get running() {
    return this.started
  }

  update(frame: Frame, dt: number) {
    if (!this.started) return
    const { sample: s, derived: d } = frame
    const now = Tone.now()
    const speedN = clamp((s.speed - 280) / 520)
    const densN = clamp(s.density / 18)
    const btN = clamp(s.bt / 22)
    const kpN = clamp(s.kp / 9)

    this.bzSmooth += (s.bz - this.bzSmooth) * (1 - Math.exp(-dt * 1.2))
    const target = MODES.findIndex((m) => this.bzSmooth > m.bz)
    if (target !== this.pendingMode) {
      this.pendingMode = target
      this.pendingSince = now
    } else if (target !== this.modeIndex && now - this.pendingSince > 2.5) {
      this.modeIndex = target
      this.mode = MODES[target].name
      this.nextChordAt = Math.min(this.nextChordAt, now + 0.3)
    }
    const steps = MODES[this.modeIndex].steps

    this.droneFilter.frequency.rampTo(110 + Math.pow(speedN, 1.4) * 1500 + d.intensity * 300, 1.5)
    this.droneLfo.frequency.rampTo(0.04 + speedN * 0.35, 2)
    this.padFilter.frequency.rampTo(700 + d.intensity * 2600, 2)

    if (now >= this.nextChordAt) {
      const root = PROGRESSION[this.chordStep++ % PROGRESSION.length]
      const voices = [0, 2, 4, 6, 8].slice(0, d.intensity > 0.45 ? 5 : 4)
      const notes = voices.map((v) => midiHz(ROOT + degree(steps, root + v)))
      this.pad.releaseAll(now)
      this.pad.triggerAttack(notes, now + 0.05, 0.5 + d.intensity * 0.3)
      this.nextChordAt = now + 10 - speedN * 4
    }

    const pluckRate = 0.25 + densN * 4.5 + d.intensity * 1.2
    if (Math.random() < 1 - Math.exp(-pluckRate * dt)) {
      const pent = [0, 1, 2, 4, 5]
      const deg = pent[Math.floor(Math.random() * pent.length)] + 7 * (1 + Math.floor(Math.random() * 2))
      this.pluckPan.pan.setValueAtTime(Math.random() * 1.6 - 0.8, now)
      this.pluck.triggerAttackRelease(midiHz(ROOT + degree(steps, deg)), 0.12, now, 0.25 + Math.random() * 0.45)
    }

    this.hissFilter.frequency.rampTo(250 + btN * 4200, 1.5)
    this.hissGain.gain.rampTo(0.012 + btN * btN * 0.09, 1.5)

    if (s.kp >= 3.67 && now >= this.nextPulseAt) {
      this.sub.triggerAttackRelease(midiHz(ROOT - 24), 2, now, 0.3 + kpN * 0.7)
      this.nextPulseAt = now + Math.max(1.6, 9 - s.kp * 0.9)
    }

    // Ring on a rise of ~0.4 decades in flux; the threshold relaxes so the next flare can ring too.
    if (this.flareRung < 0) this.flareRung = d.flareLevel
    this.flareRung = Math.max(Math.min(this.flareRung, d.flareLevel), this.flareRung - dt * 0.01)
    if (s.xray >= 1e-6 && d.flareLevel > this.flareRung + 0.08) {
      const count = s.xray >= 1e-4 ? 5 : s.xray >= 1e-5 ? 3 : 1
      for (let i = 0; i < count; i++) {
        const deg = 14 + [0, 2, 4, 7, 9][i % 5]
        this.bell.triggerAttackRelease(midiHz(ROOT + degree(steps, deg)), 1.5, now + i * 0.18, 0.5)
      }
      this.flareRung = d.flareLevel
    }

    this.speedSlow += (s.speed - this.speedSlow) * (1 - Math.exp(-dt * 0.25))
    if (s.speed - this.speedSlow > 70 && now - this.lastShock > 8) {
      this.gong.triggerAttackRelease(3, now, 0.8)
      this.sub.triggerAttackRelease(midiHz(ROOT - 29), 3, now, 1)
      this.lastShock = now
    }
  }

  async stop() {
    if (!this.started) return
    this.started = false
    this.out.gain.rampTo(0, 0.8)
    const nodes = this.nodes
    this.nodes = []
    await new Promise((r) => setTimeout(r, 900))
    for (const n of nodes.reverse()) n.dispose()
  }
}
