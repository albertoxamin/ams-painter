// Diagnose manifold issues on prepared parts (Manifold CSG path).
import { readFileSync } from 'fs'
import * as THREE from 'three'
import { loadSTL } from '../src/lib/loadSTL.ts'
import { prepareParts } from '../src/lib/prepareParts.ts'
import { buildInsert } from '../src/lib/extrude.ts'
import { splitAtHeight } from '../src/lib/split.ts'
import { ensureManifoldSolid } from '../src/lib/manifoldOps.ts'

function edgeStats(geom) {
  const pos = geom.getAttribute('position')
  const idx = geom.index
  const start = geom.drawRange?.start ?? 0
  const rangeCount = geom.drawRange?.count
  const totalTris = idx ? idx.count / 3 : pos.count / 3
  const triCount =
    rangeCount !== undefined && rangeCount !== Infinity && rangeCount != null
      ? Math.min(totalTris, Math.floor(rangeCount / 3))
      : totalTris
  const drStart = start
  const key = (x, y, z) => `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
  const counts = new Map()
  let degenerates = 0
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2
    if (idx) {
      const o = drStart + t * 3
      i0 = idx.getX(o)
      i1 = idx.getX(o + 1)
      i2 = idx.getX(o + 2)
    } else {
      const o = drStart + t * 3
      i0 = o
      i1 = o + 1
      i2 = o + 2
    }
    const ax = pos.getX(i0),
      ay = pos.getY(i0),
      az = pos.getZ(i0)
    const bx = pos.getX(i1),
      by = pos.getY(i1),
      bz = pos.getZ(i1)
    const cx = pos.getX(i2),
      cy = pos.getY(i2),
      cz = pos.getZ(i2)
    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az
    const acx = cx - ax,
      acy = cy - ay,
      acz = cz - az
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    if (nx * nx + ny * ny + nz * nz < 1e-20) degenerates++
    const add = (x0, y0, z0, x1, y1, z1) => {
      const ka = key(x0, y0, z0)
      const kb = key(x1, y1, z1)
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      counts.set(e, (counts.get(e) || 0) + 1)
    }
    add(ax, ay, az, bx, by, bz)
    add(bx, by, bz, cx, cy, cz)
    add(cx, cy, cz, ax, ay, az)
  }
  let open = 0,
    multi = 0
  for (const c of counts.values()) {
    if (c === 1) open++
    else if (c !== 2) multi++
  }
  return {
    drawRange: { ...geom.drawRange },
    indexed: !!idx,
    triCount,
    open,
    multi,
    degenerates,
    ok: open === 0 && multi === 0 && degenerates === 0,
  }
}

function report(label, geom) {
  console.log(label, JSON.stringify(edgeStats(geom)))
}

const file = process.argv[2] || 'public/test-box.stl'
const fileBuf = readFileSync(file)
const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength)
const model = loadSTL(buf, file)
console.log('model', model.name, model.count, 'tris')

const H = (model.zMin + model.zMax) / 2
const { lower, upper } = await splitAtHeight(model.geometry, H, 0.15)
report('split lower', lower)
report('split upper', upper)

const pos = model.geometry.getAttribute('position')
const sel = new Set()
for (let t = 0; t < model.count && sel.size < 3; t++) {
  const a = t * 3
  const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
  const v1 = new THREE.Vector3(pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1))
  const v2 = new THREE.Vector3(pos.getX(a + 2), pos.getY(a + 2), pos.getZ(a + 2))
  const n = new THREE.Vector3()
    .subVectors(v1, v0)
    .cross(new THREE.Vector3().subVectors(v2, v0))
    .normalize()
  // pick a small horizontal patch near the top, not covering the whole roof
  if (n.z > 0.9 && v0.z > H && Math.abs(v0.x) < model.zMax) sel.add(t)
}
console.log('selection size', sel.size)

if (sel.size > 0) {
  const insert = buildInsert(model.geometry, sel, model.zMin)
  if (insert) {
    report('insert raw', insert)
    const solid = await ensureManifoldSolid(insert)
    report('insert manifold', solid)
  }
}

const parts = await prepareParts(model.geometry, H, sel, new Set(), model.zMin, 0.15, {
  dropInFloorZ: H,
})
report('bottom', parts.bottom)
report('upper', parts.upper)
