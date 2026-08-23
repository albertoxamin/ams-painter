import type { InsertMeta, PenCutout } from '../../../domain'
import type { Model } from '../../../domain/model'
import type { CutAxis } from '../../../lib/extrude'
import type { SplitLockAxis, SplitMode } from '../../../lib/split'
import type { SplitPathNode } from '../../../lib/splitBezier'
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
  splitMode?: SplitMode
  splitLockAxis?: SplitLockAxis
  splitSpline?: SplitPathNode[]
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
    splitMode?: SplitMode
    splitLockAxis?: SplitLockAxis
    splitSpline?: SplitPathNode[]
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
    splitMode: state.splitMode,
    splitLockAxis: state.splitLockAxis,
    splitSpline: state.splitSpline,
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
      splitMode: input.splitMode,
      splitLockAxis: input.splitLockAxis,
      splitSpline: input.splitSpline,
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
        `${c.id}:${c.meta.axis}:${c.meta.floor}:${c.meta.entry ?? '_'}:${c.flat ? 'f' : 'm'}:${c.loop.map((p) => p.map((n) => n.toFixed(2)).join(',')).join(';')}`,
    )
    .join('|')
}

function splineKey(spline: SplitPathNode[] | undefined): string {
  if (!spline?.length) return ''
  return spline
    .map((p) => {
      const inn = p.in ? `${p.in.x.toFixed(3)},${p.in.y.toFixed(3)},${p.in.z.toFixed(3)}` : ''
      const out = p.out
        ? `${p.out.x.toFixed(3)},${p.out.y.toFixed(3)},${p.out.z.toFixed(3)}`
        : ''
      return `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}:${p.mode ?? ''}:${inn}:${out}`
    })
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
    input.splitMode ?? 'height',
    input.splitLockAxis ?? 'y',
    splineKey(input.splitSpline),
    stableSet(input.structural),
    stableSet(input.dropIn),
    metaKey(input.dropInMeta),
    penKey(input.penCutouts),
  ].join('::')
}
