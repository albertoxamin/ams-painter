import type { PreparePartsInput } from './buildPrepareInput'
import { prepareInputCacheKey } from './buildPrepareInput'
import type { PreparedPartsView } from './usePreparedParts'
import { packGeometry, unpackGeometry } from '../../../lib/geometryTransfer'
import type { SerializedPrepareInput } from '../../../lib/prepareSerialized'
import type { CsgWorkerResponse } from '../../../workers/csg.worker'
import { runPrepareSerialized } from '../../../lib/prepareSerialized'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  { resolve: (v: PreparedPartsView) => void; reject: (e: Error) => void }
>()

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('../../../workers/csg.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (e: MessageEvent<CsgWorkerResponse>) => {
        const msg = e.data
        const entry = pending.get(msg.id)
        if (!entry) return
        pending.delete(msg.id)
        if (!msg.ok) {
          entry.reject(new Error(msg.error))
          return
        }
        const r = msg.result
        const lower = unpackGeometry(r.bottom)
        lower.computeVertexNormals()
        const upper = r.upper ? unpackGeometry(r.upper) : null
        upper?.computeVertexNormals()
        const dropIns = r.dropIns.map((g) => {
          const geom = unpackGeometry(g)
          geom.computeVertexNormals()
          return geom
        })
        entry.resolve({
          lower,
          upper,
          dropIns,
          dropInAxes: r.dropInAxes,
          insertsOnly: r.insertsOnly,
        })
      }
      worker.onerror = () => {
        for (const [, entry] of pending) {
          entry.reject(new Error('CSG worker crashed'))
        }
        pending.clear()
        worker = null
      }
    } catch {
      worker = null
      return null
    }
  }
  return worker
}

function toSerialized(input: PreparePartsInput): SerializedPrepareInput {
  const dropInMeta: Record<string, import('../../../domain').InsertMeta> = {}
  for (const [k, v] of input.dropInMeta) {
    dropInMeta[String(k)] = {
      axis: v.axis,
      floor: v.floor,
      colorId: v.colorId,
      ...(v.entry !== undefined ? { entry: v.entry } : {}),
    }
  }
  return {
    geometry: packGeometry(input.model.geometry),
    triCount: input.model.count,
    zMin: input.zMin,
    splitHeight: input.splitHeight,
    structural: [...input.structural],
    dropIn: [...input.dropIn],
    dropInMeta,
    penCutouts: input.penCutouts.map((c) => ({
      id: c.id,
      loop: c.loop.map((p) => [...p] as [number, number, number]),
      meta: { ...c.meta },
    })),
    clearance: input.clearance,
    dropInFloorZ: input.dropInFloorZ,
    insertsOnly: input.insertsOnly,
    cutAxis: input.cutAxis,
    adjacency: input.model.adjacency,
  }
}

export async function loadPreparedWithWorker(
  input: PreparePartsInput,
): Promise<PreparedPartsView> {
  const w = getWorker()
  if (!w) {
    const serialized = toSerialized(input)
    const result = await runPrepareSerialized(serialized)
    const lower = unpackGeometry(result.bottom)
    lower.computeVertexNormals()
    const upper = result.upper ? unpackGeometry(result.upper) : null
    upper?.computeVertexNormals()
    const dropIns = result.dropIns.map((g) => {
      const geom = unpackGeometry(g)
      geom.computeVertexNormals()
      return geom
    })
    return {
      lower,
      upper,
      dropIns,
      dropInAxes: result.dropInAxes,
      insertsOnly: result.insertsOnly,
    }
  }

  const id = nextId++
  const payload = { ...toSerialized(input), id }

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage(payload)
  })
}

export { prepareInputCacheKey }
