import * as THREE from 'three'
import type { Frame, Player } from '../data/player'
import { SkyView } from './SkyView'
import { SpaceView } from './SpaceView'
import type { Pointer, View } from './view'

export type ViewId = 'sky' | 'earth' | 'magnetosphere'

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly sky: SkyView
  private space: SpaceView | null = null
  private view: ViewId = 'sky'
  private raf = 0
  private last = performance.now()
  private time = 0
  private frameMs = 16
  private qualityCheck = 0
  private listeners = new Set<(frame: Frame, dt: number) => void>()
  private pointer: Pointer = { x: 0, y: 0, dragYaw: 0, dragPitch: 0 }
  private target = { x: 0, y: 0 }
  private drag: { x: number; y: number; id: number } | null = null
  private ro: ResizeObserver
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private container: HTMLElement, private player: Player) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false })
    this.renderer.setClearColor(0x010104)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    const canvas = this.renderer.domElement
    canvas.setAttribute('aria-label', 'Aurora visualisation')
    canvas.setAttribute('role', 'img')
    container.appendChild(canvas)
    this.sky = new SkyView(this.renderer)

    container.addEventListener('pointermove', this.onMove)
    container.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.loop)
  }

  subscribe(fn: (frame: Frame, dt: number) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  setView(id: ViewId) {
    if (id === this.view) return
    const wasSpace = this.view !== 'sky'
    this.view = id
    if (id !== 'sky') {
      const space = this.spaceView()
      space.mode = id
    }
    if (wasSpace !== (id !== 'sky')) this.pointer.dragYaw = this.pointer.dragPitch = 0
  }

  spaceView() {
    if (!this.space) {
      this.space = new SpaceView(this.renderer)
      this.resize()
    }
    return this.space
  }

  private get active(): View {
    return this.view === 'sky' ? this.sky : this.spaceView()
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    const pr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.sky.resize(w, h, pr)
    this.space?.resize(w, h, pr)
  }

  private onMove = (e: PointerEvent) => {
    if (this.reducedMotion) return
    this.target.x = (e.clientX / window.innerWidth) * 2 - 1
    this.target.y = (e.clientY / window.innerHeight) * 2 - 1
    if (this.drag && e.pointerId === this.drag.id) {
      const k = this.view === 'sky' ? 0.0035 : 0.006
      this.pointer.dragYaw -= (e.clientX - this.drag.x) * k
      this.pointer.dragPitch += (e.clientY - this.drag.y) * k * (this.view === 'sky' ? 1 : 0.8)
      if (this.view === 'sky') {
        this.pointer.dragYaw = THREE.MathUtils.clamp(this.pointer.dragYaw, -1.4, 1.4)
        this.pointer.dragPitch = THREE.MathUtils.clamp(this.pointer.dragPitch, -0.3, 0.95)
      }
      this.drag.x = e.clientX
      this.drag.y = e.clientY
    }
  }

  private onDown = (e: PointerEvent) => {
    if (e.target !== this.renderer.domElement) return
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }

  private onUp = () => {
    this.drag = null
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    const frame = this.player.tick(dt)
    for (const fn of this.listeners) fn(frame, dt)

    const k = 1 - Math.exp(-dt * 3)
    this.pointer.x += (this.target.x - this.pointer.x) * k
    this.pointer.y += (this.target.y - this.pointer.y) * k
    this.active.render(frame, dt, this.time, this.pointer)
    this.adaptQuality(dt)
  }

  /** Holds ~60 fps by trading off the sky raymarch resolution. */
  private adaptQuality(dt: number) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05
    this.qualityCheck += dt
    if (this.qualityCheck < 1 || this.view !== 'sky') return
    this.qualityCheck = 0
    const q = this.sky.quality
    if (this.frameMs > 21 && q > 0.28) this.sky.quality = Math.max(0.28, q * 0.85)
    else if (this.frameMs < 15 && q < 0.9) this.sky.quality = Math.min(0.9, q * 1.08)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.container.removeEventListener('pointermove', this.onMove)
    this.container.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    this.sky.dispose()
    this.space?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
