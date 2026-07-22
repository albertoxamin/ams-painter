import { useEffect, useRef } from 'react'
import { useStore } from '../state'
import { buildSelectionSnapshot } from '../lib/selectionSnapshot'
import { saveAutosave } from '../lib/projectStorage'

const AUTOSAVE_DELAY_MS = 1500

/** Debounced autosave of markings to IndexedDB when the model or selection changes. */
export function useAutosave() {
  const model = useStore((s) => s.model)
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
  const penCutouts = useStore((s) => s.penCutouts)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const splitHeight = useStore((s) => s.splitHeight)
  const cutAxis = useStore((s) => s.cutAxis)
  const dropInFloorZ = useStore((s) => s.dropInFloorZ)
  const brushColorId = useStore((s) => s.brushColorId)
  const clearance = useStore((s) => s.clearance)
  const palette = useStore((s) => s.palette)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!model) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const snap = buildSelectionSnapshot({
        model,
        insertsOnly,
        splitHeight,
        cutAxis,
        dropInFloorZ,
        brushColorId,
        clearance,
        palette,
        structural,
        dropIn,
        dropInMeta,
        penCutouts,
      })
      void saveAutosave({
        meshHash: model.meshHash,
        meshName: model.name,
        snapshot: snap,
        savedAt: Date.now(),
      })
    }, AUTOSAVE_DELAY_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [
    model,
    structural,
    dropIn,
    dropInMeta,
    penCutouts,
    insertsOnly,
    splitHeight,
    cutAxis,
    dropInFloorZ,
    brushColorId,
    clearance,
    palette,
  ])
}
