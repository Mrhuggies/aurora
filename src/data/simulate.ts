import { BIN_MS, type Sample } from './types'

/** A plausible week: quiet background, one or two CME-driven storms, a couple of flares. */
export function simulateWeek(seed = Date.now()): Sample[] {
  let s = seed % 2147483647 || 1
  const rand = () => ((s = (s * 48271) % 2147483647) / 2147483647)
  const walk = (x: number, target: number, k: number, noise: number) => x + (target - x) * k + (rand() - 0.5) * noise

  const n = (7 * 24 * 60 * 60 * 1000) / BIN_MS
  const end = Math.floor(Date.now() / BIN_MS) * BIN_MS
  const storms = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
    at: 0.2 + rand() * 0.65,
    len: 0.04 + rand() * 0.06,
    power: 0.55 + rand() * 0.45,
  }))
  const flares = Array.from({ length: 3 }, () => ({ at: rand(), size: rand() }))

  let speed = 380, density = 5, bz = 1, by = 0, bx = 0, kp = 1.3, xray = 3e-7, temp = 8e4
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    const f = i / n
    let storm = 0
    for (const st of storms) {
      const d = (f - st.at) / st.len
      if (d > -0.15 && d < 1) storm = Math.max(storm, st.power * (d < 0 ? 1 + d / 0.15 : Math.exp(-d * 2.2)))
    }
    const shock = storms.some((st) => Math.abs(f - st.at) < 0.002)
    speed = walk(speed, 360 + storm * 420, 0.02, 6) + (shock ? 90 : 0)
    density = Math.max(0.5, walk(density, 4 + storm * 14 * (1 - storm), 0.05, 0.6) + (shock ? 8 : 0))
    bz = walk(bz, 1.5 - storm * 18 + Math.sin(i / 40) * 3 * (1 - storm), 0.08, 1.4)
    by = walk(by, Math.cos(i / 55) * 4, 0.05, 1)
    bx = walk(bx, Math.sin(i / 70) * 3, 0.05, 0.8)
    kp = Math.max(0, Math.min(9, walk(kp, 1.2 + storm * 6.8, 0.03, 0.08)))
    temp = walk(temp, 6e4 + speed * 200, 0.05, 4000)
    let flare = 0
    for (const fl of flares) {
      const d = (f - fl.at) * n
      if (d > 0 && d < 30) flare = Math.max(flare, Math.exp(-d / 6) * Math.pow(10, -6 + fl.size * 2.2))
    }
    xray = Math.max(walk(xray, 4e-7, 0.05, 5e-8), flare, 1e-8)
    const kpStep = Math.round(kp * 3) / 3
    out.push({
      t: end - (n - 1 - i) * BIN_MS,
      speed, density, temp, bx, by, bz,
      bt: Math.hypot(bx, by, bz) + 1.5 + storm * 6,
      kp: kpStep, xray, dst: -storm * 160 + (rand() - 0.5) * 6,
    })
  }
  return out
}
