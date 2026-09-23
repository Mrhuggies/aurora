import * as THREE from 'three'
import type { Frame } from '../data/player'

export interface Pointer {
  /** −1..1 across the viewport, smoothed. */
  x: number
  y: number
  /** Accumulated drag offset in radians. */
  dragYaw: number
  dragPitch: number
}

export interface View {
  render(frame: Frame, dt: number, time: number, pointer: Pointer): void
  resize(width: number, height: number, pixelRatio: number): void
  dispose(): void
  /** Multiplier on internal render resolution, adjusted by the stage to hold frame rate. */
  quality: number
}

export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  return g
}

export function rawMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;\nin vec3 position;\n${vertexShader}`,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
}

/** Critically-damped-ish exponential approach, frame-rate independent. */
export const approach = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt))
