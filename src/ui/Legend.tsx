import type { ViewId } from '../scene/Stage'

interface Item {
  tone: string
  label: string
  desc: string
}

const SEE: Record<ViewId, Item[]> = {
  sky: [
    { tone: '--c-kp', label: 'Height in the sky', desc: 'Kp sets how far south the oval reaches. Quiet: low arcs on the northern horizon. Storm: curtains overhead.' },
    { tone: '--c-aurora', label: 'Brightness, number of arcs', desc: 'Newell coupling: solar wind speed × field strength × how southward the field points.' },
    { tone: '--c-aurora', label: 'Green', desc: 'Atomic oxygen at 557.7 nm, 100–250 km up. The everyday aurora.' },
    { tone: '--c-storm', label: 'Red crown', desc: 'Oxygen at 630 nm above ~250 km. Grows as Bz turns south.' },
    { tone: '--c-violet', label: 'Violet lower hem', desc: 'Ionised nitrogen at 427.8 nm. Only in energetic storms.' },
    { tone: '--c-bt', label: 'Folds and rays', desc: 'Stronger total field Bt folds the curtains and sharpens the rays.' },
  ],
  earth: [
    { tone: '--c-aurora', label: 'Auroral oval', desc: 'Centred on the geomagnetic pole. It bulges toward midnight and widens with Kp.' },
    { tone: '--c-calm', label: 'Day and night', desc: 'Earth is turned to the real sub-solar point for each moment. The oval stays fixed to the Sun.' },
    { tone: '--c-amber', label: 'OVATION', desc: 'Near “now”, the oval blends into NOAA’s OVATION Prime forecast.' },
  ],
  magnetosphere: [
    { tone: '--c-calm', label: 'Magnetopause (blue)', desc: 'Shue et al. (1998): standoff set by solar wind pressure and Bz. It shrinks in storms.' },
    { tone: '--c-amber', label: 'Bow shock (amber)', desc: '≈1.3 × the standoff. Solar wind particles pile up and divert here.' },
    { tone: '--c-wind', label: 'Particles', desc: 'Flow speed is solar wind speed. Brightness is density.' },
    { tone: '--c-calm', label: 'Field lines', desc: 'Dipole loops, squeezed on the day side and stretched into the tail.' },
  ],
}

const HEAR: Item[] = [
  { tone: '--c-violet', label: 'Harmony', desc: 'Bz picks the mode: Lydian when strongly north, down through Dorian to Phrygian when strongly south.' },
  { tone: '--c-wind', label: 'Drone', desc: 'Solar wind speed opens the filter and speeds up the chord changes.' },
  { tone: '--c-density', label: 'Plucked notes', desc: 'Rate follows plasma density.' },
  { tone: '--c-bt', label: 'Wind hiss', desc: 'Brightness and loudness follow total field Bt.' },
  { tone: '--c-kp', label: 'Sub-bass pulse', desc: 'Starts at Kp 4 and quickens with geomagnetic activity.' },
  { tone: '--c-flare', label: 'Bells', desc: 'A rising X-ray flare (C-class and up). More bells for M and X.' },
  { tone: '--c-storm', label: 'Gong', desc: 'A shock front: a sudden jump in wind speed.' },
]

function List({ items }: { items: Item[] }) {
  return (
    <ul className="key-list">
      {items.map((i) => (
        <li key={i.label}>
          <span className="key-dot" style={{ background: `var(${i.tone})`, boxShadow: `0 0 10px var(${i.tone})` }} />
          <div>
            <strong style={{ color: `var(${i.tone})` }}>{i.label}</strong>
            <p>{i.desc}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Legend({ view, onClose }: { view: ViewId; onClose: () => void }) {
  return (
    <aside className="hud key" aria-label="Key">
      <div className="key-head">
        <span>Key</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close key">
          <svg viewBox="0 0 16 16" aria-hidden><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>
        </button>
      </div>
      <h3>What you see</h3>
      <List items={SEE[view]} />
      <h3>What you hear</h3>
      <List items={HEAR} />
      <h3>Keyboard</h3>
      <p className="key-keys">
        <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> ±1 h (<kbd>⇧</kbd> 6 h) · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> views · <kbd>M</kbd> sound ·{' '}
        <kbd>P</kbd> peak · <kbd>End</kbd> now
      </p>
      <p className="key-credit">
        Data: NOAA SWPC. Solar wind measured at L1 by SOLAR-1, ACE and DSCOVR and propagated to Earth. Also GOES
        X-ray flux, planetary Kp, Kyoto Dst and OVATION Prime. Refreshed every 15 minutes.
      </p>
    </aside>
  )
}
