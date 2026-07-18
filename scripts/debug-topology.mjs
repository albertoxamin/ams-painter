import { readFileSync } from 'fs'
import { loadGLBGeometry } from '../src/lib/loadGLB.ts'
import { ensureFloatGeometry } from '../src/lib/normalizeGeometry.ts'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const buf = readFileSync('/Users/alberto/Downloads/meshy_1784390222161.glb')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const geom = await loadGLBGeometry(ab)
let g = ensureFloatGeometry(geom)
for (const n of Object.keys(g.attributes)) if (n !== 'position') g.deleteAttribute(n)
if (!g.index) {
  const n = g.getAttribute('position').count
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  g.setIndex(idx)
}
g = mergeVertices(g, 1e-4)
const pos = g.getAttribute('position')
const idx = g.index

const TOL = 1e-4
const vkey = (x, y, z) => `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
const edgeKey = (ax, ay, az, bx, by, bz) => {
  const ka = vkey(ax, ay, az), kb = vkey(bx, by, bz)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

const edgeFaces = new Map()
const triCount = idx.count / 3
for (let t = 0; t < triCount; t++) {
  const i0 = idx.getX(t * 3), i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2)
  const corners = [i0, i1, i2]
  for (let e = 0; e < 3; e++) {
    const a = corners[e], b = corners[(e + 1) % 3]
    const ek = edgeKey(pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b))
    if (!edgeFaces.has(ek)) edgeFaces.set(ek, [])
    edgeFaces.get(ek).push({ tri: t, from: a, to: b })
  }
}

let naked = 0, multi = 0
const directed = new Map() // vert -> vert for boundary walk
for (const [, faces] of edgeFaces) {
  if (faces.length === 1) {
    naked++
    const f = faces[0]
    directed.set(f.from, f.to)
  } else if (faces.length > 2) multi++
}

console.log('naked', naked, 'multi', multi, 'directed map size', directed.size)

// Walk loops using directed map
const used = new Set()
const loops = []
for (const [start, next0] of directed) {
  if (used.has(start)) continue
  const loop = [start]
  let cur = next0
  used.add(start)
  while (cur !== start && loop.length < directed.size + 1) {
    if (used.has(cur)) break
    loop.push(cur)
    used.add(cur)
    const n = directed.get(cur)
    if (n === undefined) break
    cur = n
  }
  if (loop.length >= 3) loops.push(loop)
}

console.log('loops found', loops.length, 'sizes', loops.map(l => l.length).sort((a,b)=>b-a).slice(0,10))

// Components via any shared edge (including boundary)
const parent = new Int32Array(triCount)
for (let i = 0; i < triCount; i++) parent[i] = i
const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
const unite = (a,b) => { const ra=find(a), rb=find(b); if(ra!==rb) parent[ra]=rb }
for (const [, faces] of edgeFaces) {
  for (let i = 1; i < faces.length; i++) unite(faces[0].tri, faces[i].tri)
}
const roots = new Set()
for (let t = 0; t < triCount; t++) roots.add(find(t))
console.log('components (any edge)', roots.size)

// Count triangles per component
const sizes = new Map()
for (let t = 0; t < triCount; t++) {
  const r = find(t)
  sizes.set(r, (sizes.get(r) || 0) + 1)
}
const sorted = [...sizes.values()].sort((a,b)=>b-a)
console.log('top component sizes', sorted.slice(0,10))
