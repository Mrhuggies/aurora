import * as THREE from 'three'
import type { Frame } from '../data/player'
import { accumulateFrag, auroraFrag, compositeFrag, fullscreenVert } from './skyShaders'
import { approach, fullscreenTriangle, rawMaterial, type Pointer, type View } from './view'

/** Kp → how far north (km) the brightest arc sits. Quiet: low on the horizon. Severe: overhead. */
const curtainDistance = (kp: number) => -60 + 1100 * Math.exp(-kp * 0.38)

export class SkyView implements View {
  quality = 0.65
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private auroraMat: THREE.RawShaderMaterial
  private accumMat: THREE.RawShaderMaterial
  private compositeMat: THREE.RawShaderMaterial
  private rtNew: THREE.WebGLRenderTarget
  private rtA: THREE.WebGLRenderTarget
  private rtB: THREE.WebGLRenderTarget
  private width = 1
  private height = 1
  private pixelRatio = 1
  private s = { intensity: 0.3, storm: 0, bt: 0.3, curtainZ: 400, flow: 0, speed: 0.4 }
  private yaw = 0
  private pitch = 0.3

  constructor(private renderer: THREE.WebGLRenderer) {
    const shared = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uYaw: { value: 0 },
      uPitch: { value: 0.3 },
      uFov: { value: THREE.MathUtils.degToRad(72) },
    }
    this.auroraMat = rawMaterial(fullscreenVert, auroraFrag, {
      ...shared,
      uIntensity: { value: 0.3 },
      uStorm: { value: 0 },
      uBt: { value: 0.3 },
      uCurtainZ: { value: 400 },
    })
    this.accumMat = rawMaterial(fullscreenVert, accumulateFrag, {
      tNew: { value: null },
      tPrev: { value: null },
      uBlend: { value: 0.35 },
    })
    this.compositeMat = rawMaterial(fullscreenVert, compositeFrag, {
      ...shared,
      tAurora: { value: null },
      uAmbient: { value: new THREE.Vector3() },
      uExposure: { value: 1 },
    })
    // The shared uniform objects are the same references across materials, so one write updates all passes.
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.auroraMat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter }
    this.rtNew = new THREE.WebGLRenderTarget(1, 1, rtOpts)
    this.rtA = new THREE.WebGLRenderTarget(1, 1, rtOpts)
    this.rtB = new THREE.WebGLRenderTarget(1, 1, rtOpts)
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.width = width
    this.height = height
    this.pixelRatio = pixelRatio
    this.resizeTargets()
  }

  private resizeTargets() {
    const w = Math.max(64, Math.round(this.width * this.pixelRatio * this.quality))
    const h = Math.max(64, Math.round(this.height * this.pixelRatio * this.quality))
    if (this.rtNew.width === w && this.rtNew.height === h) return
    for (const rt of [this.rtNew, this.rtA, this.rtB]) rt.setSize(w, h)
  }

  render(frame: Frame, dt: number, time: number, pointer: Pointer) {
    const { sample, derived } = frame
    const s = this.s
    s.intensity = approach(s.intensity, derived.intensity, 0.8, dt)
    s.storm = approach(s.storm, derived.storm, 0.8, dt)
    s.bt = approach(s.bt, Math.min(1, sample.bt / 22), 0.8, dt)
    s.curtainZ = approach(s.curtainZ, curtainDistance(sample.kp), 0.35, dt)
    s.speed = approach(s.speed, Math.min(1, sample.speed / 800), 0.8, dt)
    s.flow += dt * (0.25 + s.speed * 2.2 + s.intensity * 1.2)

    const drift = Math.sin(time * 0.031) * 0.12
    this.yaw = approach(this.yaw, drift + pointer.x * 0.22 + pointer.dragYaw, 2.5, dt)
    this.pitch = approach(this.pitch, THREE.MathUtils.clamp(0.3 - pointer.y * 0.12 + pointer.dragPitch, 0.02, 1.25), 2.5, dt)

    this.resizeTargets()
    const shared = this.auroraMat.uniforms
    shared.uRes.value.set(this.rtNew.width, this.rtNew.height)
    shared.uTime.value = time
    shared.uFlow.value = s.flow
    shared.uYaw.value = this.yaw
    shared.uPitch.value = this.pitch
    shared.uIntensity.value = s.intensity
    shared.uStorm.value = s.storm
    shared.uBt.value = s.bt
    shared.uCurtainZ.value = s.curtainZ

    const r = this.renderer
    this.quad.material = this.auroraMat
    r.setRenderTarget(this.rtNew)
    r.render(this.scene, this.camera)

    this.accumMat.uniforms.tNew.value = this.rtNew.texture
    this.accumMat.uniforms.tPrev.value = this.rtA.texture
    this.accumMat.uniforms.uBlend.value = 1 - Math.exp(-dt * 20)
    this.quad.material = this.accumMat
    r.setRenderTarget(this.rtB)
    r.render(this.scene, this.camera)
    ;[this.rtA, this.rtB] = [this.rtB, this.rtA]

    const c = this.compositeMat.uniforms
    c.uRes.value.set(this.width * this.pixelRatio, this.height * this.pixelRatio)
    c.tAurora.value = this.rtA.texture
    const glow = s.intensity * s.intensity
    c.uAmbient.value.set(0.1 + 0.9 * s.storm, 1 - 0.5 * s.storm, 0.36 + 0.4 * s.storm).multiplyScalar(glow)
    this.quad.material = this.compositeMat
    r.setRenderTarget(null)
    r.render(this.scene, this.camera)
  }

  dispose() {
    this.quad.geometry.dispose()
    for (const m of [this.auroraMat, this.accumMat, this.compositeMat]) m.dispose()
    for (const rt of [this.rtNew, this.rtA, this.rtB]) rt.dispose()
  }
}
