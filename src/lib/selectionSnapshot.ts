import type { CutAxis, InsertMeta, PaletteColor } from './extrude'
import type { PenCutout } from './penCutout'
import type { Model } from '../domain/model'

export const SELECTION_SNAPSHOT_VERSION = 2
export const MESH_TRI_WARN = 500_000

export interface SelectionSnapshot {
  version: number
  /** STL filename the markings belong to. */
  name: string
  /** Triangle count — must match the loaded model. */
  tris: number
  /** Hash of source STL bytes (optional in v1 snapshots). */
  meshHash?: string
  insertsOnly: boolean
  splitHeight: number
  cutAxis: CutAxis
  dropInFloorZ: number
  brushColorId: string
  clearance: number
  palette: PaletteColor[]
  structural: number[]
  dropIn: number[]
  dropInMeta: Record<string, InsertMeta>
  penCutouts: Array<{
    id: string
    loop: [number, number, number][]
    meta: InsertMeta
  }>
}

export function buildSelectionSnapshot(input: {
  model: Model
  insertsOnly: boolean
  splitHeight: number
  cutAxis: CutAxis
  dropInFloorZ: number
  brushColorId: string
  clearance: number
  palette: PaletteColor[]
  structural: Set<number>
  dropIn: Set<number>
  dropInMeta: Map<number, InsertMeta>
  penCutouts: PenCutout[]
}): SelectionSnapshot {
  const dropInMeta: Record<string, InsertMeta> = {}
  for (const [face, meta] of input.dropInMeta) {
    dropInMeta[String(face)] = {
      axis: meta.axis,
      floor: meta.floor,
      colorId: meta.colorId,
      ...(meta.entry !== undefined ? { entry: meta.entry } : {}),
    }
  }

  return {
    version: SELECTION_SNAPSHOT_VERSION,
    name: input.model.name,
    tris: input.model.count,
    meshHash: input.model.meshHash,
    insertsOnly: input.insertsOnly,
    splitHeight: input.splitHeight,
    cutAxis: input.cutAxis,
    dropInFloorZ: input.dropInFloorZ,
    brushColorId: input.brushColorId,
    clearance: input.clearance,
    palette: input.palette.map((c) => ({ ...c })),
    structural: [...input.structural],
    dropIn: [...input.dropIn],
    dropInMeta,
    penCutouts: input.penCutouts.map((c) => ({
      id: c.id,
      loop: c.loop.map((p) => [...p] as [number, number, number]),
      meta: {
        axis: c.meta.axis,
        floor: c.meta.floor,
        colorId: c.meta.colorId,
        ...(c.meta.entry !== undefined ? { entry: c.meta.entry } : {}),
      },
    })),
  }
}

export function parseSelectionSnapshot(raw: unknown): SelectionSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON: expected an object')
  }
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name) {
    throw new Error('Missing model name')
  }
  if (typeof o.tris !== 'number' || !Number.isFinite(o.tris)) {
    throw new Error('Missing triangle count')
  }
  if (!Array.isArray(o.structural) || !Array.isArray(o.dropIn)) {
    throw new Error('Missing structural or dropIn face lists')
  }

  const palette = Array.isArray(o.palette)
    ? (o.palette as PaletteColor[])
    : undefined

  const dropInMeta =
    o.dropInMeta && typeof o.dropInMeta === 'object'
      ? (o.dropInMeta as Record<string, InsertMeta>)
      : undefined

  const penCutouts = Array.isArray(o.penCutouts)
    ? (o.penCutouts as SelectionSnapshot['penCutouts'])
    : []

  return {
    version:
      typeof o.version === 'number' ? o.version : SELECTION_SNAPSHOT_VERSION,
    name: o.name,
    tris: o.tris,
    meshHash: typeof o.meshHash === 'string' ? o.meshHash : undefined,
    insertsOnly: o.insertsOnly === true,
    splitHeight: typeof o.splitHeight === 'number' ? o.splitHeight : 0,
    cutAxis: (o.cutAxis as CutAxis) ?? '-z',
    dropInFloorZ: typeof o.dropInFloorZ === 'number' ? o.dropInFloorZ : 0,
    brushColorId:
      typeof o.brushColorId === 'string' ? o.brushColorId : 'red',
    clearance: typeof o.clearance === 'number' ? o.clearance : 0.15,
    palette: palette ?? [],
    structural: o.structural as number[],
    dropIn: o.dropIn as number[],
    dropInMeta: dropInMeta ?? {},
    penCutouts,
  }
}

/** Returns an error message when the snapshot does not match the loaded model. */
export function validateSnapshotForModel(
  snap: SelectionSnapshot,
  model: Model,
): string | null {
  if (snap.tris !== model.count) {
    return `Triangle count mismatch: file has ${model.count.toLocaleString()}, markings have ${snap.tris.toLocaleString()}`
  }
  const snapName = snap.name.toLowerCase()
  const modelName = model.name.toLowerCase()
  if (snapName !== modelName) {
    return `Model name mismatch: loaded "${model.name}", markings are for "${snap.name}"`
  }
  if (snap.meshHash && snap.meshHash !== model.meshHash) {
    return `STL content mismatch: markings were saved for a different file`
  }
  return null
}

export function downloadSelectionSnapshot(
  snap: SelectionSnapshot,
  baseName: string,
): void {
  const json = JSON.stringify(snap, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName.replace(/\.stl$/i, '')}-markings.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Project file = markings snapshot with mesh hash (v2). */
export function downloadProjectFile(
  snap: SelectionSnapshot,
  baseName: string,
): void {
  const project = { ...snap, version: SELECTION_SNAPSHOT_VERSION }
  const json = JSON.stringify(project, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName.replace(/\.stl$/i, '')}.amspaint.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function parseProjectFile(raw: unknown): SelectionSnapshot {
  return parseSelectionSnapshot(raw)
}
