import { loadSTL } from './loadSTL'
import { readStoredZip } from './exportSTL'
import {
  parseProjectFile,
  validateSnapshotForModel,
  type SelectionSnapshot,
} from './selectionSnapshot'
import type { Model } from '../domain/model'

export type LoadedEditorFile = {
  model: Model
  snapshot?: SelectionSnapshot
}

function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  return slash >= 0 ? name.slice(slash + 1) : name
}

function isPartStl(name: string): boolean {
  return /_(body|bottom|upper|insert)(_|\.|$)/i.test(baseName(name))
}

/** Pick the source STL that matches the markings, not a cut part. */
export function pickProjectStl(
  files: { name: string; data: Uint8Array }[],
  modelName: string,
): Uint8Array | null {
  const stls = files.filter((f) => baseName(f.name).toLowerCase().endsWith('.stl'))
  const wanted = modelName.toLowerCase()
  const exact = stls.find((f) => baseName(f.name).toLowerCase() === wanted)
  if (exact) return exact.data
  const originals = stls.filter((f) => !isPartStl(f.name))
  if (originals.length === 1) return originals[0]!.data
  return null
}

export async function loadEditorFile(file: File): Promise<LoadedEditorFile> {
  const buf = await file.arrayBuffer()
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) {
    const entries = readStoredZip(new Uint8Array(buf))
    const marking = entries.find((f) =>
      baseName(f.name).toLowerCase().endsWith('.amspaint.json'),
    )
    if (!marking) {
      throw new Error('Zip has no .amspaint.json markings')
    }
    const snapshot = parseProjectFile(
      JSON.parse(new TextDecoder().decode(marking.data)),
    )
    const stl = pickProjectStl(entries, snapshot.name)
    if (!stl) {
      throw new Error(`Zip has no original STL named ${snapshot.name}`)
    }
    const stlBuffer = stl.buffer.slice(
      stl.byteOffset,
      stl.byteOffset + stl.byteLength,
    ) as ArrayBuffer
    const model = loadSTL(stlBuffer, snapshot.name)
    const mismatch = validateSnapshotForModel(snapshot, model)
    if (mismatch) throw new Error(mismatch)
    return { model, snapshot }
  }
  const model = loadSTL(buf, file.name)
  return { model }
}
