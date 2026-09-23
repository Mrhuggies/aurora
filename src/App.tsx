import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio/engine'
import { loadOvation, loadTimeline } from './data/noaa'
import { Player, SPEEDS, type Frame } from './data/player'
import { simulateWeek } from './data/simulate'
import type { Timeline as TimelineData } from './data/types'
import { Stage, type ViewId } from './scene/Stage'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { Legend } from './ui/Legend'
import { Timeline } from './ui/Timeline'

const REFRESH_MS = 15 * 60 * 1000

export function App() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [player] = useState(
    () => new Player({ samples: simulateWeek(1), source: 'simulated', fetchedAt: Date.now() }),
  )
  const stageRef = useRef<Stage | null>(null)
  const audioRef = useRef<AudioEngine | null>(null)
  const [data, setData] = useState<TimelineData | null>(null)
  const [frame, setFrame] = useState<Frame>(player.frame)
  const [mode, setMode] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const [view, setViewState] = useState<ViewId>('sky')
  const [fading, setFading] = useState(false)
  const [audioOn, setAudioOn] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(player.speedIndex)
  const [showKey, setShowKey] = useState(false)
  const [glError, setGlError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current!
    let stage: Stage
    try {
      stage = new Stage(host, player)
    } catch (e) {
      setGlError(e instanceof Error ? e.message : 'WebGL is unavailable')
      return
    }
    stageRef.current = stage
    let uiClock = 0
    let audioClock = 0
    const unsubscribe = stage.subscribe((f, dt) => {
      uiClock += dt
      audioClock += dt
      if (uiClock > 0.12) {
        uiClock = 0
        setFrame(f)
      }
      if (audioClock > 0.1 && audioRef.current?.running) {
        audioRef.current.update(f, audioClock)
        setMode(audioRef.current.mode)
        audioClock = 0
      }
    })
    return () => {
      unsubscribe()
      stage.dispose()
      stageRef.current = null
    }
  }, [player])

  useEffect(() => {
    let cancelled = false
    let first = true
    const refresh = async () => {
      const [tl, ov] = await Promise.all([loadTimeline(), loadOvation()])
      if (cancelled) return
      if (first) player.load(tl)
      else player.setTimeline(tl)
      first = false
      setData(tl)
      const space = stageRef.current?.spaceView()
      if (space) {
        space.setOvation(ov)
        space.liveUntil = tl.source === 'live' ? tl.samples[tl.samples.length - 1].t : 0
      }
    }
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [player])

  const setView = useCallback((id: ViewId) => {
    if (id === view) return
    setFading(true)
    setTimeout(() => {
      stageRef.current?.setView(id)
      setViewState(id)
      setFading(false)
    }, 280)
  }, [view])

  const toggleAudio = useCallback(async () => {
    if (audioRef.current?.running) {
      const engine = audioRef.current
      audioRef.current = null
      setAudioOn(false)
      setMode(null)
      await engine.stop()
    } else {
      const engine = new AudioEngine()
      audioRef.current = engine
      await engine.start()
      engine.update(player.frame, 0.1)
      setAudioOn(true)
    }
  }, [player])

  const enter = useCallback(async (withSound: boolean) => {
    setEntered(true)
    if (withSound && !audioRef.current?.running) await toggleAudio()
  }, [toggleAudio])

  const togglePlay = useCallback(() => {
    player.playing = !player.playing
    setPlaying(player.playing)
  }, [player])

  const cycleSpeed = useCallback(() => {
    player.speedIndex = (player.speedIndex + 1) % SPEEDS.length
    setSpeed(player.speedIndex)
  }, [player])

  useEffect(() => {
    if (!entered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select')) return
      const hours = e.shiftKey ? 6 : 1
      switch (e.key) {
        case ' ':
          if (el.closest('button')) return
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft': player.step(-hours); break
        case 'ArrowRight': player.step(hours); break
        case 'Home': player.seek(0); break
        case 'End': player.jumpToNow(); break
        case '1': setView('sky'); break
        case '2': setView('earth'); break
        case '3': setView('magnetosphere'); break
        case 'm': case 'M': toggleAudio(); break
        case 'k': case 'K': case '?': setShowKey((v) => !v); break
        case 'p': case 'P': player.jumpToPeak(); break
        case 'Escape': setShowKey(false); break
        default: return
      }
      setFrame(player.frame)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entered, player, setView, toggleAudio, togglePlay])

  useEffect(() => () => void audioRef.current?.stop(), [])

  return (
    <div className="app">
      <div ref={hostRef} className="stage" />
      <div className={`veil ${fading ? 'on' : ''}`} aria-hidden />
      {glError && (
        <div className="gl-error" role="alert">
          <p>This experience needs WebGL, which isn’t available in this browser.</p>
          <p className="dim">{glError}</p>
        </div>
      )}
      {!entered && <Intro data={data} onEnter={enter} />}
      {entered && (
        <>
          <Hud
            frame={frame}
            data={data}
            mode={mode}
            view={view}
            onView={setView}
            audioOn={audioOn}
            onToggleAudio={toggleAudio}
            showKey={showKey}
            onToggleKey={() => setShowKey((v) => !v)}
          />
          <Timeline
            player={player}
            data={data}
            frame={frame}
            playing={playing}
            speed={speed}
            onTogglePlay={togglePlay}
            onCycleSpeed={cycleSpeed}
            onSeek={() => setFrame(player.frame)}
          />
          {showKey && <Legend view={view} onClose={() => setShowKey(false)} />}
        </>
      )}
    </div>
  )
}
