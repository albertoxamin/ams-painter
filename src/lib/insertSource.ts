import type * as THREE from 'three'
import type { InsertMeta } from './extrude'
import { resolveInsertFloors, selectionSpan } from './extrude'
import { resolveLoopInsertFloors, loopToVectors } from './penCutout'
import type { PenCutout } from './penCutout'
import { resolveSpanInsertFloors, type ResolvedInsertFloors } from './insertDepth'
import { axisLetter } from './extrude'
import { resolveIslandMeta } from '../domain/palette'

/** Unified insert definition for brush islands and pen loops. */
export type InsertSource =
  | {
      kind: 'faces'
      id: string
      faces: Set<number>
      meta: InsertMeta
    }
  | {
      kind: 'loop'
      id: string
      loop: [number, number, number][]
      meta: InsertMeta
    }

export function insertSourcesFromState(input: {
  dropInIslands: Set<number>[]
  dropInMeta: Map<number, InsertMeta>
  penCutouts: PenCutout[]
  fallback: InsertMeta
}): InsertSource[] {
  const out: InsertSource[] = []
  input.dropInIslands.forEach((faces, i) => {
    const meta = resolveIslandMeta(faces, input.dropInMeta, input.fallback)
    out.push({ kind: 'faces', id: `island-${i}`, faces, meta })
  })
  for (const cutout of input.penCutouts) {
    out.push({
      kind: 'loop',
      id: cutout.id,
      loop: cutout.loop,
      meta: cutout.meta,
    })
  }
  return out
}

export function resolveInsertSourceFloors(
  geom: THREE.BufferGeometry,
  source: InsertSource,
  pad = 0.75,
): ResolvedInsertFloors {
  if (source.kind === 'faces') {
    return resolveInsertFloors(
      geom,
      source.faces,
      source.meta.axis,
      source.meta.floor,
      pad,
      source.meta.entry,
    )
  }
  return resolveLoopInsertFloors(
    geom,
    loopToVectors(source.loop),
    source.meta.axis,
    source.meta.floor,
    pad,
    source.meta.entry,
  )
}

/** Re-export unified span resolver for viewport depth handles. */
export { resolveSpanInsertFloors }

export function spanForSource(
  geom: THREE.BufferGeometry,
  source: InsertSource,
): { min: number; max: number; mean: number } {
  const letter = axisLetter(source.meta.axis)
  if (source.kind === 'faces') {
    return selectionSpan(geom, source.faces, letter)
  }
  const loop = loopToVectors(source.loop)
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const p of loop) {
    const c = letter === 'x' ? p.x : letter === 'y' ? p.y : p.z
    min = Math.min(min, c)
    max = Math.max(max, c)
    sum += c
  }
  return { min, max, mean: loop.length ? sum / loop.length : 0 }
}
