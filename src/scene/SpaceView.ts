import * as THREE from 'three'
import type { Frame } from '../data/player'
import type { Ovation } from '../data/noaa'
import { shueFlaring } from '../data/physics'
import { createLandTexture } from './land'
import {
  atmosphereFrag, auroraShellFrag, earthFrag, earthVert, magnetopauseFrag, shellVert, windFrag, windVert,
} from './spaceShaders'
import { approach, type Pointer, type View } from './view'

export type SpaceMode = 'earth' | 'magnetosphere'

const DEG = Math.PI / 180
// IGRF-era geomagnetic north pole.
const POLE_LAT = 80.8 * DEG
const POLE_LON = -72.6 * DEG
const DIPOLE_OBJ = new THREE.Vector3(
  Math.cos(POLE_LAT) * Math.cos(POLE_LON),
  Math.sin(POLE_LAT),
  -Math.cos(POLE_LAT) * Math.sin(POLE_LON),
)

function material(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: shellVert, fragmentShader, uniforms, ...extra })
}

/** Grid over (angle from Sun line, azimuth) with an open tail; vertices are placed by shapeSurface. */
function surfaceOfRevolution(thetaSteps: number, phiSteps: number, thetaMax: number) {
  const angles: number[] = []
  const index: number[] = []
  for (let i = 0; i <= thetaSteps; i++) {
    for (let j = 0; j <= phiSteps; j++) angles.push((i / thetaSteps) * thetaMax, (j / phiSteps) * Math.PI * 2)
  }
  const row = phiSteps + 1
  for (let i = 0; i < thetaSteps; i++) {
    for (let j = 0; j < phiSteps; j++) {
      const a = i * row + j, b = a + row
      index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(angles.length * 1.5), 3))
  g.setIndex(index)
  g.userData.angles = Float32Array.from(angles)
  return g
}

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const

export class SpaceView implements View {
  quality = 1
  mode: SpaceMode = 'earth'
  ovation: Ovation | null = null
  /** Epoch ms of the newest sample; OVATION is only shown near it. */
  liveUntil = 0

  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.05, 4000)
  private earth: THREE.Mesh
  private earthQ = new THREE.Quaternion()
  private shells: THREE.Mesh[] = []
  private magnetopause: THREE.Mesh
  private bowShock: THREE.Mesh
  private wind: THREE.Points
  private fieldLines: THREE.LineSegments
  private sun: THREE.Sprite
  private ovationTex: THREE.DataTexture
  private land: THREE.CanvasTexture
  private dipoleWorld = new THREE.Vector3()
  private s = { intensity: 0.3, storm: 0, edge: 62, standoff: 10, flow: 0, density: 0.3, speed: 0.5, live: 0, wide: 0 }
  private yaw = 0
  private pitch = 0
  private uniforms = {
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  }

  constructor(private renderer: THREE.WebGLRenderer) {
    const u = this.uniforms
    this.land = createLandTexture()
    this.ovationTex = new THREE.DataTexture(new Uint8Array(360 * 181), 360, 181, THREE.RedFormat, THREE.UnsignedByteType)
    this.ovationTex.wrapS = THREE.RepeatWrapping
    this.ovationTex.magFilter = THREE.LinearFilter
    this.ovationTex.minFilter = THREE.LinearFilter
    this.ovationTex.needsUpdate = true

    this.scene.add(this.makeStars())

    const earthGeo = new THREE.SphereGeometry(1, 128, 96)
    this.earth = new THREE.Mesh(
      earthGeo,
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: earthVert,
        fragmentShader: earthFrag,
        uniforms: { ...u, tLand: { value: this.land }, uAuroraTint: { value: new THREE.Vector3() } },
      }),
    )
    this.scene.add(this.earth)

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.025, 96, 64),
      material(atmosphereFrag, u, { ...additive, side: THREE.BackSide }),
    )
    this.earth.add(atmosphere)

    // Two emission layers: green ~110 km and a fainter red cap ~250 km.
    ;[1.017, 1.04].forEach((r, layer) => {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(r, 160, 120),
        material(auroraShellFrag, {
          ...u,
          uDipole: { value: this.dipoleWorld },
          uIntensity: { value: 0 },
          uStorm: { value: 0 },
          uEdge: { value: 62 },
          uLayer: { value: layer },
          uLive: { value: 0 },
          tOvation: { value: this.ovationTex },
        }, additive),
      )
      this.shells.push(shell)
      this.earth.add(shell)
    })

    const mpGeo = surfaceOfRevolution(64, 72, 128 * DEG)
    this.magnetopause = new THREE.Mesh(mpGeo, material(magnetopauseFrag, {
      ...u, uColor: { value: new THREE.Color(0.3, 0.75, 1.0) }, uOpacity: { value: 0 },
    }, { ...additive, side: THREE.DoubleSide }))
    this.bowShock = new THREE.Mesh(mpGeo.clone(), material(magnetopauseFrag, {
      ...u, uColor: { value: new THREE.Color(1.0, 0.55, 0.35) }, uOpacity: { value: 0 },
    }, { ...additive, side: THREE.DoubleSide }))
    this.scene.add(this.magnetopause, this.bowShock)

    this.wind = this.makeWind()
    this.scene.add(this.wind)

    this.fieldLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x5fd4ff, ...additive, opacity: 0 }),
    )
    this.scene.add(this.fieldLines)
    // Geometry is rewritten every frame, so cached bounding spheres would be stale.
    this.magnetopause.frustumCulled = this.bowShock.frustumCulled = this.fieldLines.frustumCulled = false

    this.sun = this.makeSun()
    this.scene.add(this.sun)
  }

  setOvation(ov: Ovation | null) {
    this.ovation = ov
    if (ov) {
      this.ovationTex.image.data!.set(ov.grid)
      this.ovationTex.needsUpdate = true
    }
  }

  private makeStars() {
    const n = 6000
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1500)
      pos.set([v.x, v.y, v.z], i * 3)
      const b = Math.pow(Math.random(), 3) * 0.9 + 0.1
      const warm = Math.random()
      col.set([b * (0.8 + 0.2 * warm), b * 0.85, b * (1 - 0.25 * warm)], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, ...additive }))
  }

  private makeWind() {
    const n = 7000
    const seed = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) seed.set([Math.sqrt(Math.random()) * 34, Math.random() * Math.PI * 2, Math.random()], i * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3))
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: windVert,
      fragmentShader: windFrag,
      uniforms: {
        uFlow: { value: 0 }, uShock: { value: 13 }, uPixel: { value: 1 }, uDensity: { value: 0.3 }, uVisible: { value: 0 },
        uColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
      },
      ...additive,
    })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    return p
  }

  private makeSun() {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    grad.addColorStop(0, 'rgba(255,250,235,1)')
    grad.addColorStop(0.08, 'rgba(255,230,180,0.9)')
    grad.addColorStop(0.25, 'rgba(255,170,90,0.25)')
    grad.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, ...additive }))
    s.position.set(900, 0, 0)
    s.scale.setScalar(260)
    return s
  }

  private shapeSurface(mesh: THREE.Mesh, r0: number, alpha: number) {
    const geo = mesh.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const angles = geo.userData.angles as Float32Array
    for (let i = 0; i < pos.count; i++) {
      const theta = angles[i * 2], phi = angles[i * 2 + 1]
      const r = r0 * Math.pow(2 / (1 + Math.cos(theta)), alpha)
      pos.setXYZ(i, r * Math.cos(theta), r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi))
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  }

  private updateFieldLines(standoff: number) {
    const compress = THREE.MathUtils.clamp(standoff / 10.5, 0.45, 1.2)
    const shells = [2.2, 3.4, 5, 7]
    const meridians = 6
    const steps = 40
    const verts: number[] = []
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dipoleWorld)
    const p = new THREE.Vector3()
    const prev = new THREE.Vector3()
    for (const L of shells) {
      const lamMax = Math.acos(Math.sqrt(1 / L))
      for (let m = 0; m < meridians; m++) {
        const phi = (m / meridians) * Math.PI * 2
        for (let i = 0; i <= steps; i++) {
          const lam = -lamMax + (2 * lamMax * i) / steps
          const r = L * Math.cos(lam) ** 2
          p.set(r * Math.cos(lam) * Math.cos(phi), r * Math.sin(lam), r * Math.cos(lam) * Math.sin(phi)).applyQuaternion(q)
          p.x *= p.x > 0 ? compress : 1 + (1 - compress) * 0.8 + L * 0.06
          if (i > 0) verts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z)
          prev.copy(p)
        }
      }
    }
    const g = this.fieldLines.geometry
    const attr = g.getAttribute('position') as THREE.BufferAttribute | undefined
    if (attr && attr.count * 3 === verts.length) {
      ;(attr.array as Float32Array).set(verts)
      attr.needsUpdate = true
    } else {
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    }
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    ;(this.wind.material as THREE.ShaderMaterial).uniforms.uPixel.value = pixelRatio
  }

  render(frame: Frame, dt: number, time: number, pointer: Pointer) {
    const { sample, derived } = frame
    const s = this.s
    s.intensity = approach(s.intensity, derived.intensity, 1, dt)
    s.storm = approach(s.storm, derived.storm, 1, dt)
    s.edge = approach(s.edge, derived.ovalEdge, 0.8, dt)
    s.standoff = approach(s.standoff, derived.standoff, 1.2, dt)
    s.density = approach(s.density, Math.min(1, sample.density / 20), 1, dt)
    s.speed = approach(s.speed, sample.speed / 450, 1, dt)
    s.flow += dt * s.speed * 9
    s.wide = approach(s.wide, this.mode === 'magnetosphere' ? 1 : 0, 1.8, dt)
    const nearNow = this.ovation && this.liveUntil - sample.t < 2 * 3600000 ? 1 : 0
    s.live = approach(s.live, nearNow, 1.5, dt)

    // Orient Earth for the sample's UTC time: sub-solar longitude and solar declination.
    const date = new Date(sample.t)
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60
    const start = Date.UTC(date.getUTCFullYear(), 0, 0)
    const doy = (sample.t - start) / 86400000
    const decl = -23.44 * DEG * Math.cos(((2 * Math.PI) / 365.25) * (doy + 10))
    const subSolarLon = (12 - hours) * 15 * DEG
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -subSolarLon)
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -decl)
    this.earthQ.multiplyQuaternions(tilt, spin)
    this.earth.quaternion.copy(this.earthQ)
    this.dipoleWorld.copy(DIPOLE_OBJ).applyQuaternion(this.earthQ)

    this.yaw = approach(this.yaw, pointer.dragYaw + pointer.x * 0.25 + time * 0.02, 2, dt)
    this.pitch = approach(this.pitch, THREE.MathUtils.clamp(pointer.dragPitch - pointer.y * 0.15, -0.9, 1.1), 2, dt)
    const w = s.wide
    const dist = THREE.MathUtils.lerp(4.6, 62, w)
    const baseAz = THREE.MathUtils.lerp(-2.1, -1.62, w) + this.yaw
    const baseEl = THREE.MathUtils.lerp(0.95, 0.2, w) + this.pitch
    const target = new THREE.Vector3(THREE.MathUtils.lerp(0, -3, w), THREE.MathUtils.lerp(0.35, 0, w), 0)
    this.camera.position.set(
      Math.cos(baseEl) * Math.cos(baseAz) * dist,
      Math.sin(baseEl) * dist,
      -Math.cos(baseEl) * Math.sin(baseAz) * dist,
    ).add(target)
    this.camera.lookAt(target)

    const u = this.uniforms
    u.uCamPos.value.copy(this.camera.position)
    u.uTime.value = time
    for (const shell of this.shells) {
      const su = (shell.material as THREE.ShaderMaterial).uniforms
      su.uIntensity.value = s.intensity
      su.uStorm.value = s.storm
      su.uEdge.value = s.edge
      su.uLive.value = s.live
    }
    ;(this.earth.material as THREE.ShaderMaterial).uniforms.uAuroraTint.value
      .set(0.1 + s.storm, 1 - 0.5 * s.storm, 0.4).multiplyScalar(s.intensity)

    const alpha = shueFlaring(sample.bz, derived.pressure)
    this.shapeSurface(this.magnetopause, s.standoff, alpha)
    this.shapeSurface(this.bowShock, s.standoff * 1.3, alpha + 0.04)
    ;(this.magnetopause.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.55 * w
    ;(this.bowShock.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.4 * w
    this.magnetopause.visible = this.bowShock.visible = w > 0.01

    const wu = (this.wind.material as THREE.ShaderMaterial).uniforms
    wu.uFlow.value = s.flow
    wu.uShock.value = s.standoff * 1.3
    wu.uDensity.value = s.density
    wu.uVisible.value = w
    wu.uColor.value.setRGB(1.0, 0.55 + 0.35 * Math.min(1, s.speed - 0.6), 0.3 + 0.4 * Math.min(1, s.speed - 0.6))
    this.wind.visible = w > 0.01

    if (w > 0.01) this.updateFieldLines(s.standoff)
    ;(this.fieldLines.material as THREE.LineBasicMaterial).opacity = 0.13 * w
    this.fieldLines.visible = w > 0.01

    this.renderer.setRenderTarget(null)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | undefined
      mat?.dispose()
    })
    this.land.dispose()
    this.ovationTex.dispose()
  }
}
