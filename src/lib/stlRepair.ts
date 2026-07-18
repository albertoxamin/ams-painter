import * as THREE from 'three'
import { ensureManifoldSolid, repairWithManifoldMerge } from './manifoldOps'
import {
  analyzeTopology,
  buildEdges,
  toIndexedMesh,
  type IndexedMesh,
  type MeshTopology,
} from './meshTopology'

export interface RepairStats {
  holesFilled: number
  trianglesAdded: number
  verticesAdded: number
  degeneratesRemoved: number
  duplicatesRemoved: number
  nonManifoldFixed: number
  normalsFlipped: number
}

function flipTriangle(mesh: IndexedMesh, tri: number): void {
  const { idx } = mesh
  const o = tri * 3
  const i1 = idx.getX(o + 1)
  idx.setX(o + 1, idx.getX(o + 2))
  idx.setX(o + 2, i1)
}

function removeTriangles(mesh: IndexedMesh, toRemove: Set<number>): IndexedMesh {
  const keep: number[] = []
  for (let t = 0; t < mesh.triCount; t++) {
    if (!toRemove.has(t)) {
      keep.push(
        mesh.idx.getX(t * 3),
        mesh.idx.getX(t * 3 + 1),
        mesh.idx.getX(t * 3 + 2),
      )
    }
  }
  const g = mesh.geometry.clone()
  g.setIndex(keep)
  return toIndexedMesh(g)
}

function removeSmallComponents(mesh: IndexedMesh): IndexedMesh {
  const edges = buildEdges(mesh)
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
    for (let i = 1; i < info.faces.length; i++) {
      unite(info.faces[0]!.tri, info.faces[i]!.tri)
    }
  }

  const sizes = new Map<number, number>()
  for (let t = 0; t < triCount; t++) {
    const r = find(t)
    sizes.set(r, (sizes.get(r) ?? 0) + 1)
  }
  let maxSize = 0
  for (const s of sizes.values()) if (s > maxSize) maxSize = s
  const minKeep = Math.max(10, Math.floor(maxSize * 0.005))

  const toRemove = new Set<number>()
  for (let t = 0; t < triCount; t++) {
    if ((sizes.get(find(t)) ?? 0) < minKeep) toRemove.add(t)
  }
  if (toRemove.size === 0 || toRemove.size === triCount) return mesh
  return removeTriangles(mesh, toRemove)
}

function removeDegenerates(mesh: IndexedMesh): { mesh: IndexedMesh; removed: number } {
  const { pos, idx, triCount } = mesh
  const toRemove = new Set<number>()
  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3)
    const i1 = idx.getX(t * 3 + 1)
    const i2 = idx.getX(t * 3 + 2)
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      toRemove.add(t)
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
    if (nx * nx + ny * ny + nz * nz < 1e-20) toRemove.add(t)
  }
  return { mesh: removeTriangles(mesh, toRemove), removed: toRemove.size }
}

function removeDuplicates(mesh: IndexedMesh): { mesh: IndexedMesh; removed: number } {
  const { pos, idx, triCount } = mesh
  const seen = new Map<string, number>()
  const toRemove = new Set<number>()
  const vkey = (x: number, y: number, z: number) =>
    `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
  const triKey = (i0: number, i1: number, i2: number) =>
    [
      vkey(pos.getX(i0), pos.getY(i0), pos.getZ(i0)),
      vkey(pos.getX(i1), pos.getY(i1), pos.getZ(i1)),
      vkey(pos.getX(i2), pos.getY(i2), pos.getZ(i2)),
    ]
      .sort()
      .join('|')

  for (let t = 0; t < triCount; t++) {
    const i0 = idx.getX(t * 3)
    const i1 = idx.getX(t * 3 + 1)
    const i2 = idx.getX(t * 3 + 2)
    const hk = triKey(i0, i1, i2)
    if (seen.has(hk)) toRemove.add(t)
    else seen.set(hk, t)
  }
  return { mesh: removeTriangles(mesh, toRemove), removed: toRemove.size }
}

/** Remove excess faces on non-manifold edges (keep best pair). */
function fixNonManifold(mesh: IndexedMesh): { mesh: IndexedMesh; fixed: number } {
  const topo = analyzeTopology(mesh)
  const toRemove = new Set<number>()
  let fixed = 0

  const faceNormal = (t: number, out: THREE.Vector3) => {
    const i0 = mesh.idx.getX(t * 3)
    const i1 = mesh.idx.getX(t * 3 + 1)
    const i2 = mesh.idx.getX(t * 3 + 2)
    const v0 = new THREE.Vector3(mesh.pos.getX(i0), mesh.pos.getY(i0), mesh.pos.getZ(i0))
    const v1 = new THREE.Vector3(mesh.pos.getX(i1), mesh.pos.getY(i1), mesh.pos.getZ(i1))
    const v2 = new THREE.Vector3(mesh.pos.getX(i2), mesh.pos.getY(i2), mesh.pos.getZ(i2))
    return out.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
  }

  const nA = new THREE.Vector3()
  const nB = new THREE.Vector3()

  for (const info of topo.edges.values()) {
    if (info.faces.length <= 2) continue
    fixed++
    // Keep first face; find best matching pair, remove the rest
    const keep = new Set<number>([info.faces[0]!.tri])
    let best = -1
    let bestDot = -2
    faceNormal(info.faces[0]!.tri, nA)
    for (let i = 1; i < info.faces.length; i++) {
      faceNormal(info.faces[i]!.tri, nB)
      const dot = nA.dot(nB)
      if (dot > bestDot) {
        bestDot = dot
        best = info.faces[i]!.tri
      }
    }
    if (best >= 0) keep.add(best)
    for (const f of info.faces) {
      if (!keep.has(f.tri)) toRemove.add(f.tri)
    }
  }

  return { mesh: removeTriangles(mesh, toRemove), fixed }
}

/** Propagate consistent outward-facing orientation per connected component. */
function fixNormals(mesh: IndexedMesh): { mesh: IndexedMesh; flipped: number } {
  const edges = buildEdges(mesh)
  const { triCount, idx, pos } = mesh
  if (triCount === 0) return { mesh, flipped: 0 }

  // Group triangles into edge-connected components
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

  const compTris = new Map<number, number[]>()
  for (let t = 0; t < triCount; t++) {
    const r = find(t)
    let arr = compTris.get(r)
    if (!arr) {
      arr = []
      compTris.set(r, arr)
    }
    arr.push(t)
  }

  const faceNormal = (t: number, out: THREE.Vector3) => {
    const i0 = idx.getX(t * 3)
    const i1 = idx.getX(t * 3 + 1)
    const i2 = idx.getX(t * 3 + 2)
    const v0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0))
    const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1))
    const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2))
    return out.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0))
  }

  const flipped = new Uint8Array(triCount)
  const visited = new Uint8Array(triCount)
  const nA = new THREE.Vector3()
  const nB = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const fc = new THREE.Vector3()
  let flipCount = 0

  for (const tris of compTris.values()) {
    const triSet = new Set(tris)
    centroid.set(0, 0, 0)
    for (const t of tris) {
      const i0 = idx.getX(t * 3)
      const i1 = idx.getX(t * 3 + 1)
      const i2 = idx.getX(t * 3 + 2)
      centroid.x += pos.getX(i0) + pos.getX(i1) + pos.getX(i2)
      centroid.y += pos.getY(i0) + pos.getY(i1) + pos.getY(i2)
      centroid.z += pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)
    }
    centroid.divideScalar(tris.length * 3)

    const seed = tris[0]!
    faceNormal(seed, nA)
    if (nA.lengthSq() < 1e-20) continue
    nA.normalize()
    const i0 = idx.getX(seed * 3)
    const i1 = idx.getX(seed * 3 + 1)
    const i2 = idx.getX(seed * 3 + 2)
    fc.set(
      (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3,
      (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3,
      (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3,
    )
    if (nA.dot(fc.sub(centroid)) < 0) flipped[seed] = 1

    visited[seed] = 1
    const queue = [seed]
    while (queue.length > 0) {
      const t = queue.pop()!
      faceNormal(t, nA)
      if (nA.lengthSq() < 1e-20) continue
      nA.normalize()
      if (flipped[t]) nA.negate()

      for (const info of edges.values()) {
        if (info.faces.length !== 2) continue
        const f0 = info.faces[0]!
        const f1 = info.faces[1]!
        let nb = -1
        if (f0.tri === t) nb = f1.tri
        else if (f1.tri === t) nb = f0.tri
        if (nb < 0 || !triSet.has(nb) || visited[nb]) continue

        faceNormal(nb, nB)
        if (nB.lengthSq() < 1e-20) continue
        nB.normalize()
        if (flipped[nb]) nB.negate()
        if (nA.dot(nB) < 0) flipped[nb] = flipped[t] ? 0 : 1
        else flipped[nb] = flipped[t]
        visited[nb] = 1
        queue.push(nb)
      }
    }
  }

  for (let t = 0; t < triCount; t++) {
    if (flipped[t]) {
      flipTriangle(mesh, t)
      flipCount++
    }
  }

  return { mesh, flipped: flipCount }
}

/**
 * Fill a boundary loop by fanning from its centroid.
 * Winding follows the directed boundary edge of the adjacent face.
 */
function fillLoop(mesh: IndexedMesh, loop: number[]): { mesh: IndexedMesh; trisAdded: number } {
  const { pos, geometry } = mesh
  const center = new THREE.Vector3()
  for (const vi of loop) {
    center.x += pos.getX(vi)
    center.y += pos.getY(vi)
    center.z += pos.getZ(vi)
  }
  center.divideScalar(loop.length)

  const positions = new Float32Array(pos.count * 3 + 3)
  positions.set(pos.array as Float32Array)
  const centerIdx = pos.count
  positions[centerIdx * 3] = center.x
  positions[centerIdx * 3 + 1] = center.y
  positions[centerIdx * 3 + 2] = center.z

  const oldIdx = geometry.index!.array as ArrayLike<number>
  const newIdx: number[] = Array.from(oldIdx as ArrayLike<number>)

  const edges = buildEdges(mesh)
  const edgeDir = new Map<string, { from: number; to: number }>()
  for (const info of edges.values()) {
    if (info.faces.length === 1) {
      const f = info.faces[0]!
      edgeDir.set(`${f.from}_${f.to}`, { from: f.from, to: f.to })
    }
  }

  // Reference normal from the first boundary face (points outward from the surface)
  const refNormal = new THREE.Vector3()
  for (const info of edges.values()) {
    if (info.faces.length !== 1) continue
    const f = info.faces[0]!
    if (f.from !== loop[0] && f.to !== loop[0]) continue
    const i0 = mesh.idx.getX(f.tri * 3)
    const i1 = mesh.idx.getX(f.tri * 3 + 1)
    const i2 = mesh.idx.getX(f.tri * 3 + 2)
    const v0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0))
    const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1))
    const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2))
    refNormal.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
    break
  }

  const triN = new THREE.Vector3()
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()

  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % loop.length]!
    va.set(pos.getX(a), pos.getY(a), pos.getZ(a))
    vb.set(pos.getX(b), pos.getY(b), pos.getZ(b))
    vc.copy(center)

    // Default winding from directed boundary edge
    let i0 = centerIdx
    let i1 = edgeDir.has(`${a}_${b}`) ? b : a
    let i2 = edgeDir.has(`${a}_${b}`) ? a : b

    va.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1))
    vb.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2))
    triN.subVectors(vb, vc).cross(new THREE.Vector3().subVectors(va, vc))
    if (refNormal.lengthSq() > 0 && triN.dot(refNormal) < 0) {
      const tmp = i1
      i1 = i2
      i2 = tmp
    }
    newIdx.push(i0, i1, i2)
  }

  const g = geometry.clone()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(newIdx)
  const result = toIndexedMesh(g)
  return { mesh: result, trisAdded: loop.length }
}

function fillAllHoles(mesh: IndexedMesh): {
  mesh: IndexedMesh
  holesFilled: number
  trisAdded: number
  vertsAdded: number
} {
  const topo = analyzeTopology(mesh)
  let holesFilled = 0
  let trisAdded = 0
  let vertsAdded = 0
  let current = mesh

  for (const loop of topo.boundaryLoops) {
    const before = current.pos.count
    const result = fillLoop(current, loop)
    current = result.mesh
    holesFilled++
    trisAdded += result.trisAdded
    vertsAdded += current.pos.count - before
  }

  return { mesh: current, holesFilled, trisAdded, vertsAdded }
}

/**
 * Multi-step STL repair (admesh / Netfabb style).
 * Returns repaired geometry; optionally round-trips through Manifold when possible.
 */
export async function repairMesh(
  geom: THREE.BufferGeometry,
  onProgress?: (pct: number) => void,
): Promise<{ geometry: THREE.BufferGeometry; stats: RepairStats; manifold: boolean }> {
  const stats: RepairStats = {
    holesFilled: 0,
    trianglesAdded: 0,
    verticesAdded: 0,
    degeneratesRemoved: 0,
    duplicatesRemoved: 0,
    nonManifoldFixed: 0,
    normalsFlipped: 0,
  }

  let mesh = toIndexedMesh(geom)
  onProgress?.(10)

  mesh = removeSmallComponents(mesh)
  onProgress?.(15)

  const d = removeDegenerates(mesh)
  mesh = d.mesh
  stats.degeneratesRemoved += d.removed
  onProgress?.(20)

  const dup = removeDuplicates(mesh)
  mesh = dup.mesh
  stats.duplicatesRemoved += dup.removed
  onProgress?.(30)

  const nm = fixNonManifold(mesh)
  mesh = nm.mesh
  stats.nonManifoldFixed += nm.fixed
  onProgress?.(45)

  const norm = fixNormals(mesh)
  mesh = norm.mesh
  stats.normalsFlipped += norm.flipped
  onProgress?.(60)

  // Iteratively fill holes until no boundary loops remain (max 5 passes)
  for (let pass = 0; pass < 5; pass++) {
    const topo = analyzeTopology(mesh)
    if (topo.boundaryLoops.length === 0) break
    const holes = fillAllHoles(mesh)
    mesh = holes.mesh
    stats.holesFilled += holes.holesFilled
    stats.trianglesAdded += holes.trisAdded
    stats.verticesAdded += holes.vertsAdded
    mesh = fixNonManifold(mesh).mesh
    mesh = fixNormals(mesh).mesh
    onProgress?.(60 + pass * 6)
  }

  onProgress?.(90)

  // Final outward orientation pass
  mesh = fixNormals(mesh).mesh

  let out = mesh.geometry
  out.computeVertexNormals()
  let manifold = false

  const merged = await repairWithManifoldMerge(out)
  if (merged) {
    out = merged
    manifold = true
  } else {
    try {
      out = await ensureManifoldSolid(out)
      manifold = true
    } catch {
      // Hole-fill result is still useful even if Manifold can't validate it
    }
  }

  onProgress?.(100)
  out.computeVertexNormals()
  return { geometry: out, stats, manifold }
}

export function prepareForDisplay(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const mesh = toIndexedMesh(geom.clone())
  fixNormals(mesh)
  const g = mesh.geometry
  g.computeVertexNormals()
  return g
}

export function topologyChecks(topo: MeshTopology) {
  return {
    nakedEdges: topo.nakedEdges,
    planarHoles: topo.planarHoles,
    nonPlanarHoles: topo.nonPlanarHoles,
    nonManifoldEdges: topo.nonManifoldEdges,
    invertedNormals: topo.invertedNormals,
    duplicateFaces: topo.duplicateFaces,
    degenerateFaces: topo.degenerateFaces,
    disjointShells: topo.disjointShells,
  }
}
