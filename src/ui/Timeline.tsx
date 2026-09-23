import { useEffect, useMemo, useRef, useState } from 'react'
import { SPEEDS, type Frame, type Player } from '../data/player'
import type { Timeline as TimelineData } from '../data/types'
import { formatClock, formatDay, kpLabel, minus } from './format'

interface Props {
  player: Player
  data: TimelineData | null
  frame: Frame
  playing: boolean
  speed: number
  onTogglePlay: () => void
  onCycleSpeed: () => void
  onSeek: () => void
}

const STRIP_H = 46

function drawStrip(canvas: HTMLCanvasElement, player: Player, width: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(STRIP_H * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, width, STRIP_H)
  const s = player.timeline.samples
  const inten = player.intensities
  if (s.length < 2) return
  const per = s.length / width

  for (let x = 0; x < width; x++) {
    const a = Math.floor(x * per)
    const b = Math.max(a + 1, Math.floor((x + 1) * per))
    let peak = 0
    let bz = 0
    for (let i = a; i < b && i < s.length; i++) {
      peak = Math.max(peak, inten[i])
      bz += s[i].bz
    }
    bz /= b - a
    const storm = Math.min(1, Math.max(0, -bz / 10))
    const h = Math.max(1, peak * (STRIP_H - 6))
    const r = Math.round(60 + 195 * storm)
    const g = Math.round(255 - 170 * storm)
    const bl = Math.round(150 + 60 * storm)
    const grad = ctx.createLinearGradient(0, STRIP_H - h, 0, STRIP_H)
    grad.addColorStop(0, `rgba(${r},${g},${bl},${0.35 + 0.5 * peak})`)
    grad.addColorStop(1, `rgba(${r},${g},${bl},0.04)`)
    ctx.fillStyle = grad
    ctx.fillRect(x, STRIP_H - h, 1, h)
  }

  const t0 = s[0].t
  const span = s[s.length - 1].t - t0
  const g1 = STRIP_H - (4.67 / 9) * STRIP_H
  ctx.setLineDash([2, 3])
  ctx.strokeStyle = 'rgba(255,179,92,0.35)'
  ctx.beginPath()
  ctx.moveTo(0, g1)
  ctx.lineTo(width, g1)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = 'rgba(176,140,255,0.9)'
  ctx.lineWidth = 1.25
  ctx.beginPath()
  let prevY = -1
  for (let i = 0; i < s.length; i += 3) {
    const x = ((s[i].t - t0) / span) * width
    const y = STRIP_H - 1 - (s[i].kp / 9) * (STRIP_H - 2)
    if (prevY < 0) ctx.moveTo(x, y)
    else if (y !== prevY) {
      ctx.lineTo(x, prevY)
      ctx.lineTo(x, y)
    }
    prevY = y
  }
  ctx.lineTo(width, prevY)
  ctx.stroke()
}

export function Timeline(p: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const el = trackRef.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (canvasRef.current && width > 0) drawStrip(canvasRef.current, p.player, width)
  }, [p.data, width, p.player])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (headRef.current) headRef.current.style.transform = `translateX(${p.player.frame.progress * width}px)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [p.player, width])

  const days = useMemo(() => {
    const s = p.player.timeline.samples
    if (s.length < 2 || width === 0) return []
    const t0 = s[0].t
    const t1 = s[s.length - 1].t
    const out: { x: number; label: string; short: string }[] = []
    const d = new Date(t0)
    d.setUTCHours(24, 0, 0, 0)
    for (let t = d.getTime(); t < t1; t += 86400000) out.push({ x: ((t - t0) / (t1 - t0)) * width, label: formatDay(t), short: String(new Date(t).getUTCDate()) })
    return out
  }, [p.data, width, p.player])

  const fractionAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const seek = (clientX: number) => {
    p.player.seek(fractionAt(clientX))
    p.onSeek()
  }

  const s = p.player.timeline.samples
  const hs = hover ? s[hover.i] : null
  const now = p.frame.sample

  return (
    <footer className="hud timeline">
      <div className="tl-controls">
        <button className="icon-btn" onClick={() => { p.player.step(-1); p.onSeek() }} aria-label="Back one hour" title="Back 1 h (←)">
          <svg viewBox="0 0 16 16" aria-hidden><path d="M9.5 4 5.5 8l4 4" /></svg>
        </button>
        <button className="icon-btn play" onClick={p.onTogglePlay} aria-label={p.playing ? 'Pause' : 'Play'} title="Play / pause (space)">
          {p.playing ? (
            <svg viewBox="0 0 16 16" aria-hidden><path d="M5.5 4v8M10.5 4v8" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden><path d="M5.5 3.8v8.4L12 8z" className="fill" /></svg>
          )}
        </button>
        <button className="icon-btn" onClick={() => { p.player.step(1); p.onSeek() }} aria-label="Forward one hour" title="Forward 1 h (→)">
          <svg viewBox="0 0 16 16" aria-hidden><path d="m6.5 4 4 4-4 4" /></svg>
        </button>
        <button className="pill small" onClick={p.onCycleSpeed} title="Playback speed">
          {SPEEDS[p.speed].label}
        </button>
        <span className="tl-spacer" />
        <button className="pill small" onClick={() => { p.player.jumpToPeak(); p.onSeek() }} title="Jump to the most active moment (P)">
          Peak<span className="long"> activity</span>
        </button>
        <button className="pill small" onClick={() => { p.player.jumpToNow(); p.onSeek() }} title="Jump to the latest data (End)">
          Now
        </button>
      </div>

      <div
        ref={trackRef}
        className="tl-track"
        role="slider"
        tabIndex={0}
        aria-label="Seven-day timeline"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.frame.progress * 100)}
        aria-valuetext={`${formatDay(now.t)} ${formatClock(now.t)} UTC`}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          seek(e.clientX)
        }}
        onPointerMove={(e) => {
          const f = fractionAt(e.clientX)
          setHover({ x: f * width, i: Math.round(f * (s.length - 1)) })
          if (dragging.current) seek(e.clientX)
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: STRIP_H }} />
        {days.map((d) => (
          <div key={d.label} className="tl-day" style={{ left: d.x }}>
            <span className="d-full">{d.label}</span>
            <span className="d-short">{d.short}</span>
          </div>
        ))}
        <div ref={headRef} className="tl-head" />
        {hs && hover && (
          <div className="tl-tip" style={{ left: Math.min(Math.max(hover.x, 90), width - 90) }}>
            <strong>{formatDay(hs.t)} {formatClock(hs.t)}</strong>
            <span>Kp {kpLabel(hs.kp)} · Bz {minus(hs.bz)} · {Math.round(hs.speed)} km/s</span>
          </div>
        )}
      </div>
      <div className="tl-legend" aria-hidden>
        <span><i className="sw aurora" /> aurora drive</span>
        <span><i className="sw kp" /> Kp</span>
        <span><i className="sw g1" /> storm threshold</span>
      </div>
    </footer>
  )
}
