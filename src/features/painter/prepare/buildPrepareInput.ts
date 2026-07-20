import type { InsertMeta, PenCutout } from '../../../domain'
import type { Model } from '../../../domain/model'
import type { CutAxis } from '../../../lib/extrude'
import { prepareParts } from '../../../lib/prepareParts'

export interface PreparePartsInput {
  model: Model
  splitHeight: number
  structural: Set<number>
  dropIn: Set<number>
  dropInMeta: Map<number, InsertMeta>
  penCutouts: PenCutout[]
  zMin: number
  clearance: number
  dropInFloorZ: number
  insertsOnly: boolean
  cutAxis: CutAxis
}

export function buildPreparePartsInput(
  state: {
    model: Model | null
    splitHeight: number
    structural: Set<number>
    dropIn: Set<number>
    dropInMeta: Map<number, InsertMeta>
    penCutouts: PenCutout[]
    clearance: number
    dropInFloorZ: number
    insertsOnly: boolean
    cutAxis: CutAxis
  },
): PreparePartsInput | null {
  if (!state.model) return null
  return {
    model: state.model,
    splitHeight: state.splitHeight,
    structural: state.structural,
    dropIn: state.dropIn,
    dropInMeta: state.dropInMeta,
    penCutouts: state.penCutouts,
    zMin: state.model.zMin,
    clearance: state.clearance,
    dropInFloorZ: state.dropInFloorZ,
    insertsOnly: state.insertsOnly,
    cutAxis: state.cutAxis,
  }
}

export async function runPrepareParts(input: PreparePartsInput) {
  return prepareParts(
    input.model.geometry,
    input.splitHeight,
    input.structural,
    input.dropIn,
    input.zMin,
    input.clearance,
    {
      dropInFloorZ: input.dropInFloorZ,
      insertsOnly: input.insertsOnly,
      cutAxis: input.cutAxis,
      dropInMeta: input.dropInMeta,
      adjacency: input.model.adjacency,
      penCutouts: input.penCutouts,
    },
  )
}

function stableSet(arr: Iterable<number>): string {
  return [...arr].sort((a, b) => a - b).join(',')
}

function metaKey(meta: Map<number, InsertMeta>): string {
  const parts: string[] = []
  for (const [k, v] of [...meta.entries()].sort((a, b) => a[0] - b[0])) {
    parts.push(
      `${k}:${v.axis}:${v.floor.toFixed(3)}:${v.entry?.toFixed(3) ?? '_'}:${v.colorId}`,
    )
  }
  return parts.join('|')
}

function penKey(cutouts: PenCutout[]): string {
  return cutouts
    .map(
      (c) =>
        `${c.id}:${c.meta.axis}:${c.meta.floor}:${c.meta.entry ?? '_'}:${c.loop.length}`,
    )
    .join('|')
}

export function prepareInputCacheKey(input: PreparePartsInput): string {
  return [
    input.model.name,
    input.model.count,
    input.splitHeight,
    input.clearance,
    input.dropInFloorZ,
    input.insertsOnly,
    input.cutAxis,
    stableSet(input.structural),
    stableSet(input.dropIn),
    metaKey(input.dropInMeta),
    penKey(input.penCutouts),
  ].join('::')
}
