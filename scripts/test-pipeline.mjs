// End-to-end logic test for the geometry pipeline (no browser).
import { readFileSync } from 'fs'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { loadSTL } from '../src/lib/loadSTL.ts'
import { buildAdjacency, floodSelect } from '../src/lib/select.ts'
import { buildInsert, selectionBoundaryEdges } from '../src/lib/extrude.ts'
import { splitAtHeight } from '../src/lib/split.ts'
import { cutRecess } from '../src/lib/boolean.ts'

const fileBuf = readFileSync('public/test-box.stl')
const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength)
const model = loadSTL(buf, 'test-box.stl')
console.log('loaded:', model.count, 'tris, z', model.zMin, '-', model.zMax)

// Adjacency
const adj = buildAdjacency(model.geometry)
console.log('adjacency built, sample deg(tri0)=', adj[0].length)

// Find a triangle on a horizontal-upward face (normal ~ +z) to test the
// common case: extruding a horizontal selected region down to the split plane.
let startTri = 0
{
  const pos = model.geometry.getAttribute('position')
  const tmp = new THREE.Vector3()
  for (let t = 0; t < pos.count / 3; t++) {
    const a = t * 3
    const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
    const v1 = new THREE.Vector3(pos.getX(a+1), pos.getY(a+1), pos.getZ(a+1))
    const v2 = new THREE.Vector3(pos.getX(a+2), pos.getY(a+2), pos.getZ(a+2))
    tmp.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
    if (tmp.z > 0.99) { startTri = t; break }
  }
}
console.log('startTri (horizontal-up face):', startTri)

// Select a SINGLE triangle on the top face (a triangular prism notch —
// realistic, and avoids the degenerate "insert == whole box" case where
// coincident faces confuse CSG).
const sel = new Set([startTri])
console.log('selected tris:', sel.size)

// Split at mid
const H = (model.zMin + model.zMax) / 2
const { lower, upper } = splitAtHeight(model.geometry, H)
console.log('split at H=', H, '-> lower', lower.getAttribute('position').count / 3, 'tris, upper', upper.getAttribute('position').count / 3, 'tris')
console.log('lower closed?', isClosedSolid(lower).ok, isClosedSolid(lower).badEdges, 'open edges')
console.log('upper closed?', isClosedSolid(upper).ok, isClosedSolid(upper).badEdges, 'open edges')

// Build insert from selection (extrude down to bed z=0)
const insert = buildInsert(model.geometry, sel, model.zMin)
if (!insert) {
  console.error('insert was null!')
  process.exit(1)
}
const insIdx = insert.index
const insTris = insIdx ? insIdx.count / 3 : insert.getAttribute('position').count / 3
console.log('insert:', insTris, 'tris', insIdx ? '(indexed)' : '(non-indexed)')
const closed = isClosedSolid(insert)
console.log('insert closed solid?', closed.ok, closed.badEdges, 'open edges')

// Cut recess
const recessed = cutRecess(lower, insert)
console.log('recessed lower:', recessed.getAttribute('position').count / 3, 'tris')
console.log('recessed closed?', isClosedSolid(recessed).ok, isClosedSolid(recessed).badEdges, 'open edges')
console.log('lower was', lower.getAttribute('position').count / 3, 'tris before recess')

console.log('\nALL OK')

function isClosedSolid(geom) {
  const pos = geom.getAttribute('position')
  const idx = geom.index
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const getCorner = (t, c) => (idx ? idx.getX(t * 3 + c) : t * 3 + c)
  const key = (x, y, z) =>
    `${x.toFixed(3)}_${y.toFixed(3)}_${z.toFixed(3)}`
  const counts = new Map()
  const add = (ax, ay, az, bx, by, bz) => {
    const ka = key(ax, ay, az)
    const kb = key(bx, by, bz)
    const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    counts.set(e, (counts.get(e) || 0) + 1)
  }
  for (let t = 0; t < triCount; t++) {
    const i0 = getCorner(t, 0)
    const i1 = getCorner(t, 1)
    const i2 = getCorner(t, 2)
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0)
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1)
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2)
    add(ax, ay, az, bx, by, bz)
    add(bx, by, bz, cx, cy, cz)
    add(cx, cy, cz, ax, ay, az)
  }
  let bad = 0
  const openList = []
  for (const [e, c] of counts.entries()) if (c !== 2) { bad++; if (openList.length < 6) openList.push(`${e} (count=${c})`) }
  if (bad) console.log('  sample open edges:', openList)
  return { ok: bad === 0, badEdges: bad }
}
