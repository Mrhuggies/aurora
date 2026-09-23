export interface Sample {
  /** Epoch ms, UTC, at Earth (propagated from L1). */
  t: number
  speed: number
  density: number
  temp: number
  bx: number
  by: number
  bz: number
  bt: number
  kp: number
  /** GOES 0.1–0.8 nm X-ray flux, W/m². */
  xray: number
  dst: number
}

export interface Derived {
  /** Newell et al. (2007) coupling, (km/s)^4/3 nT^2/3. */
  coupling: number
  /** 0..1 perceptual aurora drive combining coupling and Kp. */
  intensity: number
  /** 0..1, how southward the IMF is. */
  storm: number
  /** Solar wind dynamic pressure, nPa. */
  pressure: number
  /** Magnetopause subsolar standoff, Earth radii (Shue et al. 1998). */
  standoff: number
  /** Equatorward edge of the auroral oval, magnetic latitude degrees. */
  ovalEdge: number
  /** NOAA G-scale, 0..5. */
  gScale: number
  /** e.g. "C2.4" */
  flareClass: string
  /** 0..1 on a log scale from A1 to X10. */
  flareLevel: number
}

export interface Timeline {
  samples: Sample[]
  source: 'live' | 'simulated'
  fetchedAt: number
  error?: string
}

export const BIN_MS = 5 * 60 * 1000
