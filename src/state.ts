import { create } from 'zustand'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { axisBounds, type CutAxis, type InsertMeta } from './lib/extrude'

export type SelectionMode = 'add' | 'remove'
/** Where painted faces go: fused into bottom, or separate drop-in inserts. */
export type PaintTarget = 'structural' | 'dropIn'
export type { CutAxis, InsertMeta }

export interface Model {
  geometry: THREE.BufferGeometry
  bvh: MeshBVH
  /** triangle count */
  count: number
  /** edge-adjacent triangle neighbors (by position), cached at load */
  adjacency: number[][]
  /** z bounds in model-local space (model is dropped to bed z=0) */
  zMin: number
  zMax: number
  name: string
}

const MAX_UNDO = 50

interface SelSnap {
  structural: Set<number>
  dropIn: Set<number>
  dropInMeta: Map<number, InsertMeta>
}

interface State {
  model: Model | null
  splitHeight: number
  /** Faces fused into the bottom chassis (posts, ribs, mounts). */
  structural: Set<number>
  /** Faces that become separate inserts dropped in from above. */
  dropIn: Set<number>
  /** Cut axis + floor stamped onto each drop-in face when painted. */
  dropInMeta: Map<number, InsertMeta>
  /** Which set the brush paints into. */
  paintTarget: PaintTarget
  /** snapshots before each stroke / clear */
  undoStack: SelSnap[]
  mode: SelectionMode
  /** brush radius in model units (mm) */
  brushRadius: number
  /** print clearance in mm (split kerf + insert/hole fit) */
  clearance: number
  /**
   * Brush floor: stamped onto newly painted drop-in faces.
   * For −Z this is the old drop-in floor Z.
   */
  dropInFloorZ: number
  /** Brush cut axis: stamped onto newly painted drop-in faces. */
  cutAxis: CutAxis
  /**
   * When true: skip the horizontal split. Work only with inserts cut from the
   * full model (body with holes + separate insert STLs).
   */
  insertsOnly: boolean
  /** Island index in drop-in list currently focused for Apply (−1 = none). */
  activeIsland: number
  /** show the insert preview + recess preview */
  preview: boolean
  /** 0 = assembled, 1 = fully exploded */
  explode: number
  /** working flag for CSG ops */
  busy: boolean
  error: string | null

  setModel: (m: Model | null) => void
  setSplitHeight: (h: number) => void
  setMode: (m: SelectionMode) => void
  setPaintTarget: (t: PaintTarget) => void
  setBrushRadius: (r: number) => void
  setClearance: (c: number) => void
  setDropInFloorZ: (z: number) => void
  setCutAxis: (a: CutAxis) => void
  setInsertsOnly: (v: boolean) => void
  setActiveIsland: (i: number) => void
  /** Apply current brush cutAxis/floor to faces in the given island sets. */
  applyBrushToIslands: (islands: Set<number>[]) => void
  setPreview: (p: boolean) => void
  setExplode: (e: number) => void
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  /** Restore selections without clearing (e.g. after hot reload). */
  restoreSelections: (
    structural: number[],
    dropIn?: number[],
    meta?: InsertMeta,
  ) => void
  /** Push current selections onto the undo stack (call once per stroke). */
  beginStroke: () => void
  /** Paint faces during an active stroke (no extra undo entries). */
  paintFaces: (idxs: number[], mode: SelectionMode) => void
  undo: () => void
  clearSelection: () => void
}

function cloneSel(s: Set<number>): Set<number> {
  return new Set(s)
}

function cloneMeta(m: Map<number, InsertMeta>): Map<number, InsertMeta> {
  const out = new Map<number, InsertMeta>()
  for (const [k, v] of m) out.set(k, { axis: v.axis, floor: v.floor })
  return out
}

function snap(s: State): SelSnap {
  return {
    structural: cloneSel(s.structural),
    dropIn: cloneSel(s.dropIn),
    dropInMeta: cloneMeta(s.dropInMeta),
  }
}

/** Resolve cut settings for an island from per-face meta (majority vote). */
export function resolveIslandMeta(
  faces: Set<number>,
  meta: Map<number, InsertMeta>,
  fallback: InsertMeta,
): InsertMeta {
  const votes = new Map<string, { meta: InsertMeta; n: number }>()
  for (const f of faces) {
    const m = meta.get(f) ?? fallback
    const key = `${m.axis}|${m.floor.toFixed(3)}`
    const cur = votes.get(key)
    if (cur) cur.n++
    else votes.set(key, { meta: m, n: 1 })
  }
  let best: InsertMeta = fallback
  let bestN = -1
  for (const v of votes.values()) {
    if (v.n > bestN) {
      bestN = v.n
      best = v.meta
    }
  }
  return best
}

export const useStore = create<State>((set, get) => ({
  model: null,
  splitHeight: 0,
  structural: new Set<number>(),
  dropIn: new Set<number>(),
  dropInMeta: new Map(),
  paintTarget: 'structural',
  undoStack: [],
  mode: 'add',
  brushRadius: 1.5,
  clearance: 0.15,
  dropInFloorZ: 0,
  cutAxis: '-z',
  insertsOnly: false,
  activeIsland: -1,
  preview: false,
  explode: 0.45,
  busy: false,
  error: null,

  setModel: (m) => {
    const split = m ? Math.round((m.zMin + m.zMax) / 2) : 0
    set({
      model: m,
      structural: new Set<number>(),
      dropIn: new Set<number>(),
      dropInMeta: new Map(),
      undoStack: [],
      preview: false,
      paintTarget: 'dropIn',
      insertsOnly: false,
      cutAxis: '-z',
      activeIsland: -1,
      splitHeight: split,
      // Default: stop drop-ins at the split seam (not all the way to the bed)
      dropInFloorZ: split,
      // ~1.5% of the longest XY span, clamped — decent default for car STLs
      brushRadius: m
        ? Math.min(
            5,
            Math.max(0.5, (() => {
              m.geometry.computeBoundingBox()
              const b = m.geometry.boundingBox!
              return Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 0.015
            })()),
          )
        : 1.5,
      error: null,
    })
  },
  setSplitHeight: (h) =>
    set((s) => {
      if (!s.model || s.cutAxis !== '-z') return { splitHeight: h }
      const { min, max } = axisBounds(s.model, '-z')
      const followed = Math.abs(s.dropInFloorZ - s.splitHeight) < 1e-6
      const floor = followed ? h : Math.min(max, Math.max(min, s.dropInFloorZ))
      return { splitHeight: h, dropInFloorZ: floor }
    }),
  setMode: (m) => set({ mode: m }),
  setPaintTarget: (t) => set({ paintTarget: t }),
  setBrushRadius: (r) => set({ brushRadius: Math.max(0.1, r) }),
  setClearance: (c) => set({ clearance: Math.max(0, c) }),
  setDropInFloorZ: (z) =>
    set((s) => {
      if (!s.model) return { dropInFloorZ: z }
      const { min, max } = axisBounds(s.model, s.cutAxis)
      return { dropInFloorZ: Math.min(max, Math.max(min, z)) }
    }),
  setCutAxis: (a) =>
    set((s) => {
      if (!s.model) return { cutAxis: a }
      const { min, max } = axisBounds(s.model, a)
      // Keep floor if still in range; else park at mid of the new axis
      const floor =
        s.dropInFloorZ >= min && s.dropInFloorZ <= max
          ? s.dropInFloorZ
          : (min + max) / 2
      return { cutAxis: a, dropInFloorZ: floor }
    }),
  setInsertsOnly: (v) =>
    set((s) => {
      if (!v) return { insertsOnly: false }
      // Entering inserts-only: fold any structural faces into drop-in
      const dropIn = cloneSel(s.dropIn)
      const dropInMeta = cloneMeta(s.dropInMeta)
      const brush: InsertMeta = { axis: s.cutAxis, floor: s.dropInFloorZ }
      for (const i of s.structural) {
        dropIn.add(i)
        if (!dropInMeta.has(i)) dropInMeta.set(i, { ...brush })
      }
      return {
        insertsOnly: true,
        paintTarget: 'dropIn' as PaintTarget,
        structural: new Set<number>(),
        dropIn,
        dropInMeta,
      }
    }),
  setActiveIsland: (i) => set({ activeIsland: i }),
  applyBrushToIslands: (islands) =>
    set((s) => {
      if (islands.length === 0) return s
      const dropInMeta = cloneMeta(s.dropInMeta)
      const brush: InsertMeta = { axis: s.cutAxis, floor: s.dropInFloorZ }
      for (const island of islands) {
        for (const f of island) {
          if (s.dropIn.has(f)) dropInMeta.set(f, { ...brush })
        }
      }
      return {
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
        dropInMeta,
      }
    }),
  setPreview: (p) => set({ preview: p }),
  setExplode: (e) => set({ explode: Math.min(1, Math.max(0, e)) }),
  setBusy: (b) => set({ busy: b }),
  setError: (e) => set({ error: e }),

  restoreSelections: (structural, dropIn = [], meta) => {
    const s = get()
    const brush: InsertMeta = meta ?? {
      axis: s.cutAxis,
      floor: s.dropInFloorZ,
    }
    const dropInMeta = new Map<number, InsertMeta>()
    for (const f of dropIn) dropInMeta.set(f, { ...brush })
    set({
      structural: new Set(structural),
      dropIn: new Set(dropIn),
      dropInMeta,
      undoStack: [],
      activeIsland: -1,
    })
  },

  beginStroke: () =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
    })),

  paintFaces: (idxs, mode) =>
    set((s) => {
      if (idxs.length === 0) return s
      const structural = cloneSel(s.structural)
      const dropIn = cloneSel(s.dropIn)
      const dropInMeta = cloneMeta(s.dropInMeta)
      const targetKind = s.insertsOnly ? 'dropIn' : s.paintTarget
      const target = targetKind === 'structural' ? structural : dropIn
      const other = targetKind === 'structural' ? dropIn : structural
      const brush: InsertMeta = { axis: s.cutAxis, floor: s.dropInFloorZ }
      if (mode === 'remove') {
        for (const i of idxs) {
          target.delete(i)
          dropInMeta.delete(i)
        }
      } else {
        for (const i of idxs) {
          target.add(i)
          other.delete(i) // a face belongs to at most one kind
          if (targetKind === 'dropIn') {
            dropInMeta.set(i, { ...brush })
          } else {
            dropInMeta.delete(i)
          }
        }
      }
      // Drop meta for faces no longer in dropIn
      for (const k of [...dropInMeta.keys()]) {
        if (!dropIn.has(k)) dropInMeta.delete(k)
      }
      return { structural, dropIn, dropInMeta }
    }),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return s
      const stack = s.undoStack.slice()
      const prev = stack.pop()!
      return {
        structural: prev.structural,
        dropIn: prev.dropIn,
        dropInMeta: prev.dropInMeta,
        undoStack: stack,
        activeIsland: -1,
      }
    }),

  clearSelection: () => {
    const s = get()
    if (s.structural.size === 0 && s.dropIn.size === 0) return
    set({
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
      structural: new Set<number>(),
      dropIn: new Set<number>(),
      dropInMeta: new Map(),
      activeIsland: -1,
    })
  },
}))

if (import.meta.env.DEV) {
  // Expose for dev/debug/automation. Safe to remove.
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}
