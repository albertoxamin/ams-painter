import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ensureFloatGeometry } from './normalizeGeometry'

export const WELD_TOL = 1e-4
const PLANE_TOL = 1e-3

export function weldTolerance(geom: THREE.BufferGeometry): number {
  geom.computeBoundingBox()
  const b = geom.boundingBox!
  const dx = b.max.x - b.min.x
  const dy = b.max.y - b.min.y
  const dz = b.max.z - b.min.z
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return Math.max(WELD_TOL, diag * 1e-5)
}

export interface IndexedMesh {
  geometry: THREE.BufferGeometry
  pos: THREE.BufferAttribute
  idx: THREE.BufferAttribute
  triCount: number
}

export interface EdgeInfo {
  key: string
  faces: { tri: number; from: number; to: number }[]
}

export interface MeshTopology {
  mesh: IndexedMesh
  edges: Map<string, EdgeInfo>
  nakedEdges: number
  nonManifoldEdges: number
  boundaryLoops: number[][]
  degenerateFaces: number
  duplicateFaces: number
  invertedNormals: number
  disjointShells: number
  planarHoles: number
  nonPlanarHoles: number
}

function vkey(x: number, y: number, z: number): string {
  return `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
}

export function edgeKey(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): string {
  const ka = vkey(ax, ay, az)
  const kb = vkey(bx, by, bz)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function triKey(
  pos: THREE.BufferAttribute,
  i0: number,
  i1: number,
  i2: number,
): string {
  return [
    vkey(pos.getX(i0), pos.getY(i0), pos.getZ(i0)),
    vkey(pos.getX(i1), pos.getY(i1), pos.getZ(i1)),
    vkey(pos.getX(i2), pos.getY(i2), pos.getZ(i2)),
  ]
    .sort()
    .join('|')
}

export function toIndexedMesh(geom: THREE.BufferGeometry): IndexedMesh {
  let g = ensureFloatGeometry(geom.clone())
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name)
  }
  if (!g.getIndex()) {
    const n = (g.getAttribute('position') as THREE.BufferAttribute).count
    const index = new Uint32Array(n)
    for (let i = 0; i < n; i++) index[i] = i
    g.setIndex(new THREE.BufferAttribute(index, 1))
  }
  g = mergeVertices(g, weldTolerance(g))
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const idx = g.getIndex() as THREE.BufferAttribute
  return { geometry: g, pos, idx, triCount: idx.count / 3 }
}

function isLoopPlanar(pos: THREE.BufferAttribute, loop: number[]): boolean {
  if (loop.length < 3) return true
  const p0 = new THREE.Vector3(pos.getX(loop[0]!), pos.getY(loop[0]!), pos.getZ(loop[0]!))
  const p1 = new THREE.Vector3(pos.getX(loop[1]!), pos.getY(loop[1]!), pos.getZ(loop[1]!))
  const p2 = new THREE.Vector3(pos.getX(loop[2]!), pos.getY(loop[2]!), pos.getZ(loop[2]!))
  const normal = new THREE.Vector3()
    .subVectors(p1, p0)
    .cross(new THREE.Vector3().subVectors(p2, p0))
  if (normal.lengthSq() < 1e-20) return true
  normal.normalize()
  const d = -normal.dot(p0)
  for (const vi of loop) {
    const dist = Math.abs(
      normal.x * pos.getX(vi) +
        normal.y * pos.getY(vi) +
        normal.z * pos.getZ(vi) +
        d,
    )
    if (dist > PLANE_TOL) return false
  }
  return true
}

/** Trace boundary loops using directed edges (Netfabb / admesh style). */
function traceBoundaryLoops(
  edges: Map<string, EdgeInfo>,
): number[][] {
  const directed = new Map<number, number>()
  for (const info of edges.values()) {
    if (info.faces.length === 1) {
      const f = info.faces[0]!
      directed.set(f.from, f.to)
    }
  }

  const used = new Set<number>()
  const loops: number[][] = []
  for (const [start, next0] of directed) {
    if (used.has(start)) continue
    const loop: number[] = [start]
    let cur = next0
    used.add(start)
    while (cur !== start && loop.length <= directed.size + 1) {
      if (used.has(cur)) break
      loop.push(cur)
      used.add(cur)
      const n = directed.get(cur)
      if (n === undefined) break
      cur = n
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** Count faces needing flip for consistent orientation (largest component only). */
function countInvertedNormals(
  mesh: IndexedMesh,
  edges: Map<string, EdgeInfo>,
): number {
  const { idx, triCount } = mesh
  if (triCount === 0) return 0

  // Find triangles in the largest edge-connected component
  const parent = new Int32Array(triCount)
  for (let i = 0; i < triCount; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (const info of edges.values()) {
    for (let i = 1; i < info.faces.length; i++) {
      unite(info.faces[0]!.tri, info.faces[i]!.tri)
    }
  }
  const sizes = new Map<number, number>()
  for (let t = 0; t < triCount; t++) {
    const r = find(t)
    sizes.set(r, (sizes.get(r) ?? 0) + 1)
  }
  let mainRoot = 0
  let mainSize = 0
  for (const [r, s] of sizes) {
    if (s > mainSize) {
      mainSize = s
      mainRoot = r
    }
  }

  const inMain = (t: number) => find(t) === mainRoot
  const flipped = new Uint8Array(triCount)
  const visited = new Uint8Array(triCount)

  const normal = (t: number, out: THREE.Vector3) => {
    const i0 = idx.getX(t * 3)
    const i1 = idx.getX(t * 3 + 1)
    const i2 = idx.getX(t * 3 + 2)
    const v0 = new THREE.Vector3(mesh.pos.getX(i0), mesh.pos.getY(i0), mesh.pos.getZ(i0))
    const v1 = new THREE.Vector3(mesh.pos.getX(i1), mesh.pos.getY(i1), mesh.pos.getZ(i1))
    const v2 = new THREE.Vector3(mesh.pos.getX(i2), mesh.pos.getY(i2), mesh.pos.getZ(i2))
    return out.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
  }

  const nA = new THREE.Vector3()
  const nB = new THREE.Vector3()
  let inverted = 0

  for (let seed = 0; seed < triCount; seed++) {
    if (!inMain(seed) || visited[seed]) continue
    visited[seed] = 1
    const queue = [seed]
    while (queue.length > 0) {
      const t = queue.pop()!
      if (flipped[t]) inverted++
      normal(t, nA)
      if (flipped[t]) nA.negate()

      for (const info of edges.values()) {
        if (info.faces.length !== 2) continue
        const f0 = info.faces[0]!
        const f1 = info.faces[1]!
        let nb = -1
        if (f0.tri === t) nb = f1.tri
        else if (f1.tri === t) nb = f0.tri
        if (nb < 0 || !inMain(nb) || visited[nb]) continue

        normal(nb, nB)
        if (flipped[nb]) nB.negate()
        if (nA.dot(nB) < 0) flipped[nb] = flipped[t] ? 0 : 1
        else flipped[nb] = flipped[t]
        visited[nb] = 1
        queue.push(nb)
      }
    }
  }

  return inverted
}

/** Disjoint shells: only meaningful on watertight meshes (Netfabb / ImageToStl style). */
function countDisjointShells(
  mesh: IndexedMesh,
  edges: Map<string, EdgeInfo>,
): number {
  for (const info of edges.values()) {
    if (info.faces.length === 1) return 0
  }

  const { triCount } = mesh
  const parent = new Int32Array(triCount)
  for (let i = 0; i < triCount; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (const info of edges.values()) {
    if (info.faces.length === 2) unite(info.faces[0]!.tri, info.faces[1]!.tri)
  }

  const roots = new Set<number>()
  for (let t = 0; t < triCount; t++) roots.add(find(t))
  return Math.max(0, roots.size - 1)
}

export function buildEdges(mesh: IndexedMesh): Map<string, EdgeInfo> {
  const { pos, idx, triCount } = mesh
  const edges = new Map<string, EdgeInfo>()

  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3)
    const i1 = idx.getX(t * 3 + 1)
    const i2 = idx.getX(t * 3 + 2)
    const corners = [i0, i1, i2]
    for (let e = 0; e < 3; e++) {
      const from = corners[e]!
      const to = corners[(e + 1) % 3]!
      const ek = edgeKey(
        pos.getX(from),
        pos.getY(from),
        pos.getZ(from),
        pos.getX(to),
        pos.getY(to),
        pos.getZ(to),
      )
      let info = edges.get(ek)
      if (!info) {
        info = { key: ek, faces: [] }
        edges.set(ek, info)
      }
      info.faces.push({ tri: t, from, to })
    }
  }
  return edges
}

export function analyzeTopology(mesh: IndexedMesh): MeshTopology {
  const { pos, idx, triCount } = mesh
  const edges = buildEdges(mesh)

  let nakedEdges = 0
  let nonManifoldEdges = 0
  for (const info of edges.values()) {
    if (info.faces.length === 1) nakedEdges++
    else if (info.faces.length > 2) nonManifoldEdges++
  }

  const boundaryLoops = traceBoundaryLoops(edges)
  let planarHoles = 0
  let nonPlanarHoles = 0
  for (const loop of boundaryLoops) {
    if (isLoopPlanar(pos, loop)) planarHoles++
    else nonPlanarHoles++
  }

  const triHashes = new Map<string, number>()
  let degenerateFaces = 0
  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3)
    const i1 = idx.getX(t * 3 + 1)
    const i2 = idx.getX(t * 3 + 2)
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      degenerateFaces++
      continue
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
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (nx * nx + ny * ny + nz * nz < 1e-20) {
      degenerateFaces++
      continue
    }
    const hk = triKey(pos, i0, i1, i2)
    triHashes.set(hk, (triHashes.get(hk) ?? 0) + 1)
  }

  let duplicateFaces = 0
  for (const count of triHashes.values()) {
    if (count > 1) duplicateFaces += count - 1
  }

  return {
    mesh,
    edges,
    nakedEdges,
    nonManifoldEdges,
    boundaryLoops,
    degenerateFaces,
    duplicateFaces,
    invertedNormals: countInvertedNormals(mesh, edges),
    disjointShells: countDisjointShells(mesh, edges),
    planarHoles,
    nonPlanarHoles,
  }
}
