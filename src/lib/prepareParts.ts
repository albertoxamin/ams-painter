import * as THREE from 'three'
import {
  buildInsert,
  resolveInsertFloors,
  flipAxis,
  type CutAxis,
  type InsertMeta,
} from './extrude'
import { splitAtHeight } from './split'
import { subtractSolid, unionSolid } from './boolean'
import { scalePerpByClearance } from './clearance'
import {
  ensureManifoldSolid,
  repairWithManifoldMerge,
  hullFromGeometry,
} from './manifoldOps'
import { listSelectionIslands } from './select'
import {
  buildInsertFromLoop,
  loopToVectors,
  resolveLoopInsertFloors,
  nudgeLoopIntoBody,
  deeperFloorAlongAxis,
  type PenCutout,
} from './penCutout'

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
  /** Cut axis used for each drop-in (parallel to dropIns). */
  dropInAxes: CutAxis[]
  /** True when prepared without a horizontal split. */
  insertsOnly: boolean
}

async function solidify(geom: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
  try {
    return await ensureManifoldSolid(geom)
  } catch {
    const repaired = await repairWithManifoldMerge(geom)
    if (repaired) return repaired
    throw new Error('Insert solid is not manifold')
  }
}

async function trySolidify(
  geom: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry | null> {
  try {
    return await solidify(geom)
  } catch {
    // Lateral extrusions often self-intersect when projected; convex hull
    // still yields a printable/cuttable manifold pocket volume.
    return hullFromGeometry(geom)
  }
}

async function buildFitInsert(
  geom: THREE.BufferGeometry,
  faces: Set<number>,
  floor: number,
  clearance: number,
  axis: CutAxis = '-z',
  entry?: number,
): Promise<{
  cutter: THREE.BufferGeometry
  fit: THREE.BufferGeometry
  axis: CutAxis
} | null> {
  if (faces.size === 0) return null

  const resolved = resolveInsertFloors(geom, faces, axis, floor, 0.75, entry)
  const rawFit = buildInsert(geom, faces, {
    axis: resolved.axis,
    floor: resolved.insertFloor,
  })
  if (!rawFit) return null

  // Pocket cutter matches ESP depth (insert floor + tiny seat), plus the
  // opposite-direction entry safety — not a through-model punch.
  const rawPocket =
    Math.abs(resolved.cutterFloor - resolved.insertFloor) > 1e-4
      ? buildInsert(geom, faces, {
          axis: resolved.axis,
          floor: resolved.cutterFloor,
        })
      : rawFit
  if (!rawPocket) return null

  const rawEntry = buildInsert(geom, faces, {
    axis: flipAxis(resolved.axis),
    floor: resolved.entryFloor,
  })

  const solidPocket = await trySolidify(rawPocket)
  const solidEntry = rawEntry ? await trySolidify(rawEntry) : null
  let cutter = solidPocket ?? rawPocket.clone()
  if (solidEntry) {
    try {
      cutter = await unionSolid(cutter, solidEntry)
    } catch (err) {
      console.warn('Entry safety cut union failed; using pocket cutter only', err)
    }
  } else if (rawEntry) {
    console.warn(
      `Insert entry cut (${flipAxis(resolved.axis)} @ ${resolved.entryFloor}) failed`,
    )
  }

  const solidFit = await trySolidify(rawFit)
  let fit = solidFit ?? rawFit.clone()
  if (!solidPocket || !solidFit) {
    console.warn(
      `Insert (${resolved.axis} @ ${resolved.insertFloor}) not manifold; using hull/raw`,
    )
  }
  if (clearance > 0) {
    if (solidFit) {
      const shrunk = await trySolidify(
        scalePerpByClearance(fit, -clearance, resolved.axis),
      )
      if (shrunk) fit = shrunk
    } else {
      try {
        fit = scalePerpByClearance(fit, -clearance, resolved.axis)
      } catch {
        /* keep unshrunk raw */
      }
    }
  }
  return { cutter, fit, axis: resolved.axis }
}

async function solidifyPenCutter(
  geom: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  const s = await trySolidify(geom)
  if (s) return s
  const repaired = await repairWithManifoldMerge(geom)
  if (repaired) return repaired
  const hull = await hullFromGeometry(geom)
  if (hull) return hull
  return geom.clone()
}

async function buildFitInsertFromLoop(
  geom: THREE.BufferGeometry,
  loop: THREE.Vector3[],
  floor: number,
  clearance: number,
  axis: CutAxis = '-z',
  entry?: number,
): Promise<{
  cutter: THREE.BufferGeometry
  fit: THREE.BufferGeometry
  axis: CutAxis
} | null> {
  if (loop.length < 3) return null

  const resolved = resolveLoopInsertFloors(geom, loop, axis, floor, 0.75, entry)
  const rawFit = buildInsertFromLoop(loop, resolved.axis, resolved.insertFloor)
  if (!rawFit) return null

  const pocketLoop = nudgeLoopIntoBody(loop, resolved.axis)
  const pocketFloor = deeperFloorAlongAxis(resolved.cutterFloor, resolved.axis)

  const rawPocket = buildInsertFromLoop(pocketLoop, resolved.axis, pocketFloor)
  if (!rawPocket) return null

  const rawEntry = buildInsertFromLoop(
    loop,
    flipAxis(resolved.axis),
    resolved.entryFloor,
  )

  const solidPocket = await solidifyPenCutter(rawPocket)
  const solidEntry = rawEntry ? await solidifyPenCutter(rawEntry) : null
  let cutter = solidPocket
  if (solidEntry) {
    try {
      cutter = await unionSolid(cutter, solidEntry)
    } catch (err) {
      console.warn('Pen entry cut union failed; using pocket cutter only', err)
    }
  }

  const solidFit = await trySolidify(rawFit)
  let fit = solidFit ?? rawFit.clone()
  if (clearance > 0) {
    if (solidFit) {
      const shrunk = await trySolidify(
        scalePerpByClearance(fit, -clearance, resolved.axis),
      )
      if (shrunk) fit = shrunk
    } else {
      try {
        fit = scalePerpByClearance(fit, -clearance, resolved.axis)
      } catch {
        /* keep unshrunk raw */
      }
    }
  }
  return { cutter, fit, axis: resolved.axis }
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
    const entryKey = m.entry !== undefined ? m.entry.toFixed(3) : '_'
    const key = `${m.axis}|${m.floor.toFixed(3)}|${entryKey}|${m.colorId ?? ''}`
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
  /** Pen-drawn cutout loops (each becomes its own insert). */
  penCutouts?: PenCutout[]
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
    colorId: 'blue',
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
    dropInAxes: CutAxis[]
  }> {
    let lower = bodyLower
    let upper = bodyUpper
    const dropIns: THREE.BufferGeometry[] = []
    const dropInAxes: CutAxis[] = []

    const triCount = (g: THREE.BufferGeometry) =>
      g.index ? g.index.count / 3 : g.getAttribute('position').count / 3

    for (let i = 0; i < islands.length; i++) {
      const island = islands[i]!
      const { axis, floor, entry } = metaForIsland(
        island,
        opts.dropInMeta,
        fallback,
      )
      let built: Awaited<ReturnType<typeof buildFitInsert>> = null
      try {
        built = await buildFitInsert(geom, island, floor, c, axis, entry)
      } catch (err) {
        console.warn(
          `Insert island ${i} (${axis} @ ${floor}) solidify failed`,
          err,
        )
        continue
      }
      if (!built) continue

      // Always keep the insert even if the pocket cut fails — otherwise
      // lateral (−X/+X) inserts can vanish from ZIP export while the UI
      // still shows the selection.
      try {
        const nextLower = await subtractSolid(lower, built.cutter)
        // Guard: a bad cutter can wipe the body — keep insert, skip cut
        if (triCount(nextLower) < 8) {
          console.warn(
            `Insert island ${i} (${axis} @ ${floor}) emptied the body; skipping cut`,
          )
          dropIns.push(built.fit)
          dropInAxes.push(built.axis)
          continue
        }
        let nextUpper = upper
        if (upper) {
          try {
            nextUpper = await subtractSolid(upper, built.cutter)
          } catch (err) {
            console.warn(`Insert island ${i}: upper cut failed`, err)
            nextUpper = upper
          }
        }
        lower = nextLower
        upper = nextUpper
        dropIns.push(built.fit)
        dropInAxes.push(built.axis)
      } catch (err) {
        console.warn(
          `Insert island ${i} (${axis} @ ${floor}) cut failed; keeping insert`,
          err,
        )
        dropIns.push(built.fit)
        dropInAxes.push(built.axis)
      }
    }

    const pens = opts.penCutouts ?? []
    for (let pi = 0; pi < pens.length; pi++) {
      const cutout = pens[pi]!
      const { axis, floor, entry } = cutout.meta
      const loop = loopToVectors(cutout.loop)
      let built: Awaited<ReturnType<typeof buildFitInsertFromLoop>> = null
      try {
        built = await buildFitInsertFromLoop(geom, loop, floor, c, axis, entry)
      } catch (err) {
        console.warn(`Pen cutout ${pi} solidify failed`, err)
        continue
      }
      if (!built) continue
      try {
        let cutter = built.cutter
        let nextLower: THREE.BufferGeometry
        try {
          nextLower = await subtractSolid(lower, cutter)
        } catch {
          // Retry with a slightly expanded cutter — helps thin shells / coplanar caps
          const inflated = scalePerpByClearance(cutter, 0.1, built.axis)
          const retryCutter = await solidifyPenCutter(inflated)
          nextLower = await subtractSolid(lower, retryCutter)
          cutter = retryCutter
        }
        if (triCount(nextLower) < 8) {
          console.warn(`Pen cutout ${pi} emptied the body; skipping cut`)
          dropIns.push(built.fit)
          dropInAxes.push(built.axis)
          continue
        }
        let nextUpper = upper
        if (upper) {
          try {
            nextUpper = await subtractSolid(upper, cutter)
          } catch (err) {
            console.warn(`Pen cutout ${pi}: upper cut failed`, err)
            nextUpper = upper
          }
        }
        lower = nextLower
        upper = nextUpper
        dropIns.push(built.fit)
        dropInAxes.push(built.axis)
      } catch (err) {
        console.warn(`Pen cutout ${pi} cut failed; keeping insert`, err)
        dropIns.push(built.fit)
        dropInAxes.push(built.axis)
      }
    }

    return { lower, upper, dropIns, dropInAxes }
  }

  if (insertsOnly) {
    const body = await ensureManifoldSolid(geom)
    const { lower, dropIns, dropInAxes } = await cutDropIns(body, null)
    return {
      bottom: lower,
      upper: null,
      structuralInsert: null,
      dropIns,
      dropInAxes,
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
    dropInAxes: cut.dropInAxes,
    insertsOnly: false,
  }
}
