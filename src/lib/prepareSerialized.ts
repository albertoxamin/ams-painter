import * as THREE from 'three'
import type { InsertMeta, PenCutout } from '../domain'
import type { CutAxis } from './extrude'
import { prepareParts } from './prepareParts'
import { unpackGeometry, packGeometry, type PackedGeometry } from './geometryTransfer'

export interface SerializedPrepareInput {
  geometry: PackedGeometry
  triCount: number
  zMin: number
  splitHeight: number
  structural: number[]
  dropIn: number[]
  dropInMeta: Record<string, InsertMeta>
  penCutouts: PenCutout[]
  clearance: number
  dropInFloorZ: number
  insertsOnly: boolean
  cutAxis: CutAxis
  adjacency: number[][]
}

export interface SerializedPrepareOutput {
  bottom: PackedGeometry
  upper: PackedGeometry | null
  dropIns: PackedGeometry[]
  dropInAxes: CutAxis[]
  insertsOnly: boolean
}

export async function runPrepareSerialized(
  input: SerializedPrepareInput,
): Promise<SerializedPrepareOutput> {
  const geometry = unpackGeometry(input.geometry)
  const structural = new Set(input.structural)
  const dropIn = new Set(input.dropIn)
  const dropInMeta = new Map<number, InsertMeta>()
  for (const [k, v] of Object.entries(input.dropInMeta)) {
    dropInMeta.set(Number(k), v)
  }

  const prepared = await prepareParts(
    geometry,
    input.splitHeight,
    structural,
    dropIn,
    input.zMin,
    input.clearance,
    {
      dropInFloorZ: input.dropInFloorZ,
      insertsOnly: input.insertsOnly,
      cutAxis: input.cutAxis,
      dropInMeta,
      adjacency: input.adjacency,
      penCutouts: input.penCutouts,
    },
  )

  const pack = (g: THREE.BufferGeometry): PackedGeometry => packGeometry(g)

  return {
    bottom: pack(prepared.bottom),
    upper: prepared.upper ? pack(prepared.upper) : null,
    dropIns: prepared.dropIns.map(pack),
    dropInAxes: prepared.dropInAxes,
    insertsOnly: prepared.insertsOnly,
  }
}
