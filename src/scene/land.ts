import * as THREE from 'three'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import landTopo from 'world-atlas/land-110m.json'

/** Equirectangular land mask: R = land fill, G = coastline. */
export function createLandTexture(width = 2048): THREE.CanvasTexture {
  const height = width / 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>
  const land = feature(topo, topo.objects.land)
  const px = (lon: number) => ((lon + 180) / 360) * width
  const py = (lat: number) => ((90 - lat) / 180) * height

  const trace = (ring: number[][]) => {
    ring.forEach(([lon, lat], i) => {
      const prev = ring[i - 1]
      if (i === 0 || Math.abs(lon - prev[0]) > 180) ctx.moveTo(px(lon), py(lat))
      else ctx.lineTo(px(lon), py(lat))
    })
  }

  const polygons: number[][][][] = []
  for (const f of land.features) {
    const g = f.geometry
    if (g.type === 'Polygon') polygons.push(g.coordinates)
    else if (g.type === 'MultiPolygon') polygons.push(...g.coordinates)
  }

  ctx.fillStyle = '#f00'
  for (const poly of polygons) {
    ctx.beginPath()
    poly.forEach(trace)
    ctx.fill('evenodd')
  }
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = '#0f0'
  ctx.lineWidth = width / 1400
  for (const poly of polygons) {
    ctx.beginPath()
    poly.forEach(trace)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}
