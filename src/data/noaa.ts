import { BIN_MS, type Sample, type Timeline } from './types'
import { simulateWeek } from './simulate'

const BASE = 'https://services.swpc.noaa.gov'
export const FEEDS = {
  wind: `${BASE}/products/geospace/propagated-solar-wind.json`,
  kp: `${BASE}/products/noaa-planetary-k-index.json`,
  xray: `${BASE}/json/goes/primary/xrays-7-day.json`,
  dst: `${BASE}/products/kyoto-dst.json`,
  ovation: `${BASE}/json/ovation_aurora_latest.json`,
}

const utc = (tag: string) => Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(tag) ? tag : `${tag}Z`)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v))

async function getJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`${res.status} ${url.split('/').pop()}`)
  return res.json()
}

/** Array-of-arrays with a header row, or array-of-objects: both appear across SWPC products. */
function rows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data) || data.length === 0) return []
  if (Array.isArray(data[0])) {
    const header = data[0] as string[]
    return (data.slice(1) as unknown[][]).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
  }
  return data as Record<string, unknown>[]
}

type Step = { t: number; v: number }

function stepSeries(list: Record<string, unknown>[], timeKey: string, valueKey: string): Step[] {
  return list
    .map((r) => ({ t: utc(String(r[timeKey])), v: num(r[valueKey]) }))
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t)
}

function stepAt(series: Step[], t: number, cursor: { i: number }, fallback: number): number {
  while (cursor.i + 1 < series.length && series[cursor.i + 1].t <= t) cursor.i++
  const s = series[cursor.i]
  return s && s.t <= t ? s.v : series[0]?.v ?? fallback
}

export function buildTimeline(windRaw: unknown, kpRaw: unknown, xrayRaw: unknown, dstRaw: unknown): Sample[] {
  const wind = rows(windRaw)
  const bins = new Map<number, { n: number; acc: Record<string, number>; cnt: Record<string, number> }>()
  const fields = ['speed', 'density', 'temperature', 'bx', 'by', 'bz', 'bt'] as const

  for (const r of wind) {
    const t = utc(String(r.propagated_time_tag ?? r.time_tag))
    if (!Number.isFinite(t)) continue
    const key = Math.floor(t / BIN_MS) * BIN_MS
    let b = bins.get(key)
    if (!b) bins.set(key, (b = { n: 0, acc: {}, cnt: {} }))
    b.n++
    for (const f of fields) {
      const v = num(r[f])
      if (!Number.isFinite(v)) continue
      b.acc[f] = (b.acc[f] ?? 0) + v
      b.cnt[f] = (b.cnt[f] ?? 0) + 1
    }
  }

  const xrayByBin = new Map<number, number>()
  for (const r of rows(xrayRaw)) {
    if (r.energy !== '0.1-0.8nm') continue
    const t = utc(String(r.time_tag))
    const f = num(r.flux)
    if (!Number.isFinite(t) || !(f > 0)) continue
    const key = Math.floor(t / BIN_MS) * BIN_MS
    xrayByBin.set(key, Math.max(xrayByBin.get(key) ?? 0, f))
  }

  const kp = stepSeries(rows(kpRaw), 'time_tag', 'Kp')
  if (kp.length === 0) kp.push(...stepSeries(rows(kpRaw), 'time_tag', 'kp_index'))
  const dst = stepSeries(rows(dstRaw), 'time_tag', 'dst')

  const keys = [...bins.keys()].sort((a, b) => a - b)
  if (keys.length === 0) return []
  const out: Sample[] = []
  const last: Record<string, number> = { speed: 400, density: 5, temperature: 1e5, bx: 0, by: 0, bz: 0, bt: 5 }
  let lastX = 1e-7
  const kc = { i: 0 }
  const dc = { i: 0 }

  for (let t = keys[0]; t <= keys[keys.length - 1]; t += BIN_MS) {
    const b = bins.get(t)
    if (b) for (const f of fields) if (b.cnt[f]) last[f] = b.acc[f] / b.cnt[f]
    const x = xrayByBin.get(t)
    if (x) lastX = x
    out.push({
      t,
      speed: last.speed,
      density: last.density,
      temp: last.temperature,
      bx: last.bx,
      by: last.by,
      bz: last.bz,
      bt: Math.max(last.bt, Math.hypot(last.bx, last.by, last.bz) * 0.98),
      kp: stepAt(kp, t, kc, 2),
      xray: lastX,
      dst: stepAt(dst, t, dc, 0),
    })
  }
  return out
}

export async function loadTimeline(): Promise<Timeline> {
  try {
    const [wind, kp, xray, dst] = await Promise.allSettled([
      getJSON(FEEDS.wind),
      getJSON(FEEDS.kp),
      getJSON(FEEDS.xray),
      getJSON(FEEDS.dst),
    ])
    if (wind.status === 'rejected') throw wind.reason
    const val = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? r.value : [])
    const samples = buildTimeline(wind.value, val(kp), val(xray), val(dst))
    if (samples.length < 288) throw new Error('Not enough solar wind data returned')
    return { samples, source: 'live', fetchedAt: Date.now() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('NOAA unavailable, using simulated week:', message)
    return { samples: simulateWeek(), source: 'simulated', fetchedAt: Date.now(), error: message }
  }
}

export interface Ovation {
  observed: number
  /** 360 × 181 aurora probability (0–100), lon-major from lat −90. */
  grid: Uint8Array
}

export async function loadOvation(): Promise<Ovation | null> {
  try {
    const d = (await getJSON(FEEDS.ovation)) as { 'Observation Time': string; coordinates: [number, number, number][] }
    const grid = new Uint8Array(360 * 181)
    for (const [lon, lat, p] of d.coordinates) {
      const x = ((Math.round(lon) % 360) + 360) % 360
      const y = Math.round(lat) + 90
      if (y >= 0 && y <= 180) grid[y * 360 + x] = Math.min(100, p)
    }
    return { observed: utc(d['Observation Time']), grid }
  } catch {
    return null
  }
}
