import * as THREE from 'three'
import { buildInsert, type CutAxis, type InsertMeta } from './extrude'
import { splitAtHeight } from './split'
import { subtractSolid, unionSolid } from './boolean'
import { scalePerpByClearance } from './clearance'
import { ensureManifoldSolid } from './manifoldOps'
import { listSelectionIslands } from './select'

export interface PreparedParts {
  /**
   * Split mode: bottom chassis. Inserts-only mode: full body with insert holes.
   */
  bottom: THREE.BufferGeometry
  /**
   * Split mode: upper shell. Inserts-only mode: null (no split).
   */
  upper: THREE.BufferGeometry | null
  /** shrunk structural insert fused into the bottom (null if none / inserts-only) */
  structuralInsert: THREE.BufferGeometry | null
  /**
   * Separate drop-in inserts (shrunk for fit). Each connected island is its
   * own solid, using that island's cut axis + floor.
   */
  dropIns: THREE.BufferGeometry[]
  /** True when prepared without a horizontal split. */
  insertsOnly: boolean
}

async function buildFitInsert(
  geom: THREE.BufferGeometry,
  faces: Set<number>,
  floor: number,
  clearance: number,
  axis: CutAxis = '-z',
): Promise<{
  cutter: THREE.BufferGeometry
  fit: THREE.BufferGeometry
} | null> {
  if (faces.size === 0) return null
  const raw = buildInsert(geom, faces, { axis, floor })
  if (!raw) return null
  const cutter = await ensureManifoldSolid(raw)
  const fit =
    clearance > 0
      ? await ensureManifoldSolid(scalePerpByClearance(cutter, -clearance, axis))
      : cutter
  return { cutter, fit }
}

function metaForIsland(
  faces: Set<number>,
  meta: Map<number, InsertMeta> | undefined,
  fallback: InsertMeta,
): InsertMeta {
  if (!meta || meta.size === 0) return fallback
  const votes = new Map<string, { m: InsertMeta; n: number }>()
  for (const f of faces) {
    const m = meta.get(f) ?? fallback
    const key = `${m.axis}|${m.floor.toFixed(3)}`
    const cur = votes.get(key)
    if (cur) cur.n++
    else votes.set(key, { m, n: 1 })
  }
  let best = fallback
  let bestN = -1
  for (const v of votes.values()) {
    if (v.n > bestN) {
      bestN = v.n
      best = v.m
    }
  }
  return best
}

export interface PreparePartsOptions {
  /** Fallback floor when a face has no meta (defaults to bed / bottomZ). */
  dropInFloorZ?: number
  /** Fallback cut axis when a face has no meta. Default −Z. */
  cutAxis?: CutAxis
  /** Per-face axis/floor for drop-in islands. */
  dropInMeta?: Map<number, InsertMeta>
  /** Triangle adjacency for splitting drop-in into islands. */
  adjacency?: number[][]
  /**
   * Skip the horizontal split; cut inserts from the full model only.
   * Structural faces are ignored (caller should fold them into dropIn).
   */
  insertsOnly?: boolean
}

/**
 * Build printable parts with print clearance.
 *
 * Split mode (default):
 * - Split seam: lower ends at H - c/2, upper starts at H + c/2
 * - Structural faces → column fused into bottom (−Z to bed); hole in upper
 * - Drop-in islands → separate inserts, each with its own cut axis + floor
 *
 * Inserts-only mode:
 * - No split. Full body with holes for inserts + separate insert STLs.
 */
export async function prepareParts(
  geom: THREE.BufferGeometry,
  H: number,
  structural: Set<number>,
  dropIn: Set<number>,
  bottomZ: number,
  clearance: number,
  options: PreparePartsOptions | number = {},
): Promise<PreparedParts> {
  const opts: PreparePartsOptions =
    typeof options === 'number' ? { dropInFloorZ: options } : options

  const c = Math.max(0, clearance)
  const insertsOnly = !!opts.insertsOnly
  const fallback: InsertMeta = {
    axis: opts.cutAxis ?? '-z',
    floor: opts.dropInFloorZ ?? bottomZ,
  }

  const dropFaces =
    dropIn.size > 0
      ? dropIn
      : insertsOnly && structural.size > 0
        ? structural
        : new Set<number>()

  const islands =
    opts.adjacency && dropFaces.size > 0
      ? listSelectionIslands(dropFaces, opts.adjacency)
      : dropFaces.size > 0
        ? [dropFaces]
        : []

  async function cutDropIns(
    bodyLower: THREE.BufferGeometry,
    bodyUpper: THREE.BufferGeometry | null,
  ): Promise<{
    lower: THREE.BufferGeometry
    upper: THREE.BufferGeometry | null
    dropIns: THREE.BufferGeometry[]
  }> {
    let lower = bodyLower
    let upper = bodyUpper
    const dropIns: THREE.BufferGeometry[] = []
    for (const island of islands) {
      const { axis, floor } = metaForIsland(island, opts.dropInMeta, fallback)
      const built = await buildFitInsert(geom, island, floor, c, axis)
      if (!built) continue
      lower = await subtractSolid(lower, built.cutter)
      if (upper) upper = await subtractSolid(upper, built.cutter)
      dropIns.push(built.fit)
    }
    return { lower, upper, dropIns }
  }

  if (insertsOnly) {
    const body = await ensureManifoldSolid(geom)
    const { lower, dropIns } = await cutDropIns(body, null)
    return {
      bottom: lower,
      upper: null,
      structuralInsert: null,
      dropIns,
      insertsOnly: true,
    }
  }

  let { lower, upper } = await splitAtHeight(geom, H, c)

  let structuralInsert: THREE.BufferGeometry | null = null

  if (structural.size > 0) {
    // Structural features always fuse down to the bed (−Z)
    const built = await buildFitInsert(geom, structural, bottomZ, c, '-z')
    if (built) {
      structuralInsert = built.fit
      lower = await unionSolid(lower, built.fit)
      upper = await subtractSolid(upper, built.cutter)
    }
  }

  const cut = await cutDropIns(lower, upper)

  return {
    bottom: cut.lower,
    upper: cut.upper,
    structuralInsert,
    dropIns: cut.dropIns,
    insertsOnly: false,
  }
}
