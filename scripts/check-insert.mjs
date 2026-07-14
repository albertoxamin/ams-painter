import { readFileSync } from 'fs'
import * as THREE from 'three'
import { loadSTL } from '../src/lib/loadSTL.ts'
import { prepareParts } from '../src/lib/prepareParts.ts'
import { buildInsert } from '../src/lib/extrude.ts'

const fileBuf = readFileSync('public/test-box.stl')
const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength)
const model = loadSTL(buf, 'test-box.stl')
const H = (model.zMin + model.zMax) / 2
const pos = model.geometry.getAttribute('position')
let startTri = 0
for (let t = 0; t < model.count; t++) {
  const a = t * 3
  const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
  const v1 = new THREE.Vector3(pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1))
  const v2 = new THREE.Vector3(pos.getX(a + 2), pos.getY(a + 2), pos.getZ(a + 2))
  const n = new THREE.Vector3()
    .subVectors(v1, v0)
    .cross(new THREE.Vector3().subVectors(v2, v0))
    .normalize()
  if (n.z > 0.99) {
    startTri = t
    break
  }
}
const sel = new Set([startTri])
console.log('sel', startTri, 'H', H)
const insert = buildInsert(model.geometry, sel, model.zMin)
console.log('insert tris', insert.index.count / 3)
const parts = await prepareParts(model.geometry, H, sel, new Set(), model.zMin, 0.15, {
  dropInFloorZ: H,
})

function stats(g) {
  const p = g.getAttribute('position')
  const idx = g.index
  const key = (x, y, z) => `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
  const counts = new Map()
  let deg = 0
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t),
      i1 = idx.getX(t + 1),
      i2 = idx.getX(t + 2)
    const ax = p.getX(i0),
      ay = p.getY(i0),
      az = p.getZ(i0)
    const bx = p.getX(i1),
      by = p.getY(i1),
      bz = p.getZ(i1)
    const cx = p.getX(i2),
      cy = p.getY(i2),
      cz = p.getZ(i2)
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (nx * nx + ny * ny + nz * nz < 1e-20) deg++
    for (const [x0, y0, z0, x1, y1, z1] of [
      [ax, ay, az, bx, by, bz],
      [bx, by, bz, cx, cy, cz],
      [cx, cy, cz, ax, ay, az],
    ]) {
      const ka = key(x0, y0, z0),
        kb = key(x1, y1, z1)
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      counts.set(e, (counts.get(e) || 0) + 1)
    }
  }
  let open = 0,
    multi = 0
  for (const c of counts.values()) {
    if (c === 1) open++
    else if (c !== 2) multi++
  }
  return { tris: idx.count / 3, open, multi, deg, ok: open === 0 && multi === 0 && deg === 0 }
}

console.log('bottom', stats(parts.bottom))
console.log('upper', stats(parts.upper))
