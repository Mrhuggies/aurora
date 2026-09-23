import type { Derived, Sample } from './types'

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

export function newellCoupling(s: Pick<Sample, 'speed' | 'by' | 'bz'>): number {
  const bPerp = Math.hypot(s.by, s.bz)
  const clock = Math.atan2(s.by, s.bz)
  return Math.pow(s.speed, 4 / 3) * Math.pow(bPerp, 2 / 3) * Math.pow(Math.abs(Math.sin(clock / 2)), 8 / 3)
}

export function dynamicPressure(density: number, speed: number): number {
  return 1.6726e-6 * density * speed * speed
}

export function shueStandoff(bz: number, pressure: number): number {
  return (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * Math.pow(Math.max(pressure, 0.05), -1 / 6.6)
}

export function shueFlaring(bz: number, pressure: number): number {
  return (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(Math.max(pressure, 0.05)))
}

/** Rough equatorward boundary of the oval; well-known rule of thumb (≈66° at Kp 0, ≈48° at Kp 9). */
export function ovalEdgeLatitude(kp: number): number {
  return 66 - 2 * kp
}

export function gScale(kp: number): number {
  const thresholds = [4.67, 5.67, 6.67, 7.67, 8.67]
  let g = 0
  for (const t of thresholds) if (kp >= t) g++
  return g
}

export function flareClass(flux: number): { label: string; level: number } {
  const f = Math.max(flux, 1e-9)
  const classes: [string, number][] = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]]
  let label = 'A0.1'
  for (const [c, base] of classes) {
    if (f >= base) {
      label = `${c}${(f / base).toFixed(1)}`
      break
    }
  }
  const level = clamp((Math.log10(f) + 8) / 5)
  return { label, level }
}

export function derive(s: Sample): Derived {
  const coupling = newellCoupling(s)
  const pressure = dynamicPressure(s.density, s.speed)
  const couplingNorm = 1 - Math.exp(-coupling / 12000)
  const kpNorm = clamp(s.kp / 9)
  const intensity = clamp(0.08 + 0.62 * couplingNorm + 0.45 * kpNorm * kpNorm)
  const storm = clamp(-s.bz / 15)
  const fc = flareClass(s.xray)
  return {
    coupling,
    intensity,
    storm,
    pressure,
    standoff: shueStandoff(s.bz, pressure),
    ovalEdge: ovalEdgeLatitude(s.kp),
    gScale: gScale(s.kp),
    flareClass: fc.label,
    flareLevel: fc.level,
  }
}
