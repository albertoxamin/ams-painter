import * as THREE from 'three'
import type { Model } from '../state'

/** Position-based vertex key (non-indexed geometries duplicate verts, so we
 * must key by rounded coordinates, not by vertex index). */
function vkey(x: number, y: number, z: number): string {
  return `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
}

/** Returns an array of length triangleCount where entry i is the list of
 *  neighbor triangle indices (sharing an edge, by position). */
export function buildAdjacency(geom: THREE.BufferGeometry): number[][] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const triCount = pos.count / 3

  // position key -> list of triangle indices that touch that position
  const trisByVertex = new Map<string, number[]>()
  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    for (let i = 0; i < 3; i++) {
      const k = vkey(pos.getX(a + i), pos.getY(a + i), pos.getZ(a + i))
      let arr = trisByVertex.get(k)
      if (!arr) {
        arr = []
        trisByVertex.set(k, arr)
      }
      arr.push(t)
    }
  }

  const adj: Set<number>[] = Array.from({ length: triCount }, () => new Set())
  // For each triangle, for each edge, find neighbors sharing both endpoints.
  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    const corners = [a, a + 1, a + 2]
    for (let e = 0; e < 3; e++) {
      const u = corners[e]
      const v = corners[(e + 1) % 3]
      const ku = vkey(pos.getX(u), pos.getY(u), pos.getZ(u))
      const kv = vkey(pos.getX(v), pos.getY(v), pos.getZ(v))
      const au = trisByVertex.get(ku)!
      const av = trisByVertex.get(kv)!
      // intersection: triangles in both au and av (excluding t itself)
      const small = au.length <= av.length ? au : av
      const big = au.length <= av.length ? av : au
      const bigSet = new Set(big)
      for (const nb of small) {
        if (nb !== t && bigSet.has(nb)) adj[t].add(nb)
      }
    }
  }
  return adj.map((s) => Array.from(s))
}

const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _nA = new THREE.Vector3()
const _nB = new THREE.Vector3()

function triangleNormal(geom: THREE.BufferGeometry, t: number, out: THREE.Vector3): THREE.Vector3 {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const a = t * 3
  _v0.set(pos.getX(a), pos.getY(a), pos.getZ(a))
  _v1.set(pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1))
  _v2.set(pos.getX(a + 2), pos.getY(a + 2), pos.getZ(a + 2))
  _nA.subVectors(_v1, _v0)
  _nB.subVectors(_v2, _v0)
  out.crossVectors(_nA, _nB).normalize()
  return out
}

/**
 * Flood-fill from `startIdx` over triangle adjacency, stopping at edges where
 * the dihedral angle between adjacent triangles exceeds `maxAngleDeg`.
 * Returns the set of triangle indices (including startIdx).
 */
export function floodSelect(
  model: Model,
  startIdx: number,
  maxAngleDeg: number,
  adjacency: number[][],
): number[] {
  const { geometry } = model
  // cos(maxAngle) with a small epsilon so a perfect 90° crease at maxAngle=90
  // passes (Math.cos(PI/2) is ~6e-17, not 0).
  const cosLimit = Math.cos((maxAngleDeg * Math.PI) / 180) - 1e-9
  const result: number[] = []
  const seen = new Set<number>([startIdx])
  const queue: number[] = [startIdx]
  const nA = new THREE.Vector3()
  const nB = new THREE.Vector3()

  while (queue.length) {
    const t = queue.shift()!
    result.push(t)
    triangleNormal(geometry, t, nA)
    for (const nb of adjacency[t]) {
      if (seen.has(nb)) continue
      triangleNormal(geometry, nb, nB)
      // dihedral: dot of normals. Same plane -> 1, sharp crease -> lower.
      const dot = nA.dot(nB)
      if (dot >= cosLimit) {
        seen.add(nb)
        queue.push(nb)
      }
    }
  }
  return result
}

/** Raycast into the model BVH and return the hit triangle index, or null. */
export function pickTriangle(model: Model, ray: THREE.Ray): number | null {
  const hits = model.bvh.raycast(ray, THREE.DoubleSide)
  if (!hits.length) return null
  return hits[0].faceIndex ?? null
}

/**
 * Connected components in `selected` using edge-adjacency.
 * Each island becomes one insert / structural feature.
 */
export function listSelectionIslands(
  selected: Set<number>,
  adjacency: number[][],
): Set<number>[] {
  if (selected.size === 0) return []
  const remaining = new Set(selected)
  const islands: Set<number>[] = []
  while (remaining.size > 0) {
    const start = remaining.values().next().value!
    remaining.delete(start)
    const island = new Set<number>([start])
    const queue = [start]
    while (queue.length) {
      const t = queue.pop()!
      for (const nb of adjacency[t] ?? []) {
        if (!remaining.has(nb)) continue
        remaining.delete(nb)
        island.add(nb)
        queue.push(nb)
      }
    }
    islands.push(island)
  }
  return islands
}

/** Count connected components in `selected`. */
export function countSelectionIslands(
  selected: Set<number>,
  adjacency: number[][],
): number {
  return listSelectionIslands(selected, adjacency).length
}
