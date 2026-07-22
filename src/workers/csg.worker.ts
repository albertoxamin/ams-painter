import type {
  SerializedPrepareInput,
  SerializedPrepareOutput,
} from '../lib/prepareSerialized'
import { runPrepareSerialized } from '../lib/prepareSerialized'

export type CsgWorkerRequest = SerializedPrepareInput & { id: number }
export type CsgWorkerResponse =
  | { id: number; ok: true; result: SerializedPrepareOutput }
  | { id: number; ok: false; error: string }

self.onmessage = async (e: MessageEvent<CsgWorkerRequest>) => {
  const { id, ...input } = e.data
  try {
    const result = await runPrepareSerialized(input)
    // Structured clone copies typed arrays — avoids detached-buffer bugs from transferables.
    ;(self as unknown as Worker).postMessage({
      id,
      ok: true,
      result,
    } satisfies CsgWorkerResponse)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: (err as Error).message || 'CSG failed',
    } satisfies CsgWorkerResponse)
  }
}
