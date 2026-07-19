import { create } from 'zustand'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import {
  axisBounds,
  type CutAxis,
  type InsertMeta,
  type PaletteColor,
} from './lib/extrude'
import {
  type PenCutout,
  newPenCutoutId,
} from './lib/penCutout'

export type SelectionMode = 'add' | 'remove'
export type PaintTool = 'brush' | 'pen'
/** Where painted faces go: fused into bottom, or separate drop-in inserts. */
export type PaintTarget = 'structural' | 'dropIn'
export type { CutAxis, InsertMeta, PaletteColor, PenCutout }

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

export const DEFAULT_PALETTE: PaletteColor[] = [
  { id: 'red', name: 'Red', hex: '#e74c3c' },
  { id: 'blue', name: 'Blue', hex: '#5ec8ff' },
  { id: 'yellow', name: 'Yellow', hex: '#f1c40f' },
  { id: 'white', name: 'White', hex: '#ecf0f1' },
]

interface SelSnap {
  structural: Set<number>
  dropIn: Set<number>
  dropInMeta: Map<number, InsertMeta>
  penCutouts: PenCutout[]
}

interface State {
  model: Model | null
  splitHeight: number
  /** Faces fused into the bottom chassis (posts, ribs, mounts). */
  structural: Set<number>
  /** Faces that become separate inserts dropped in from above. */
  dropIn: Set<number>
  /** Cut axis + floor + color stamped onto each drop-in face when painted. */
  dropInMeta: Map<number, InsertMeta>
  /** Freeform pen-drawn insert cutouts (not mesh triangles). */
  penCutouts: PenCutout[]
  /** Active painting tool. */
  paintTool: PaintTool
  /** Pen cutout index for gizmo focus (−1 = none). */
  activePenIndex: number
  /** User-defined insert colors. */
  palette: PaletteColor[]
  /** Active palette color stamped by the brush. */
  brushColorId: string
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
  /** X-ray outlines of each insert curtain (through the mesh). */
  esp: boolean
  /** 0 = assembled, 1 = fully exploded */
  explode: number
  /** working flag for CSG ops */
  busy: boolean
  error: string | null

  setModel: (m: Model | null) => void
  setSplitHeight: (h: number) => void
  setMode: (m: SelectionMode) => void
  setPaintTool: (t: PaintTool) => void
  setPaintTarget: (t: PaintTarget) => void
  setBrushRadius: (r: number) => void
  setClearance: (c: number) => void
  setDropInFloorZ: (z: number) => void
  setCutAxis: (a: CutAxis) => void
  setBrushColor: (id: string) => void
  addPaletteColor: () => void
  updatePaletteColor: (
    id: string,
    patch: Partial<Pick<PaletteColor, 'name' | 'hex'>>,
  ) => void
  removePaletteColor: (id: string) => void
  setInsertsOnly: (v: boolean) => void
  setActiveIsland: (i: number) => void
  setActivePenIndex: (i: number) => void
  /** Commit a closed pen loop as a new insert cutout. */
  addPenCutout: (loop: [number, number, number][]) => void
  removePenCutout: (id: string) => void
  applyAxisToPenCutout: (id: string, axis: CutAxis) => void
  applyDepthsToPenCutout: (
    id: string,
    patch: { floor?: number; entry?: number },
  ) => void
  /** Apply current brush cutAxis/floor/color to faces in the given island sets. */
  applyBrushToIslands: (islands: Set<number>[]) => void
  /** Set cut axis on an island (remap floor); also syncs brush axis. */
  applyAxisToIsland: (faces: Set<number>, axis: CutAxis) => void
  /** Set pocket and/or entry depth on an island (from viewport drag handles). */
  applyDepthsToIsland: (
    faces: Set<number>,
    patch: { floor?: number; entry?: number },
  ) => void
  setPreview: (p: boolean) => void
  setEsp: (v: boolean) => void
  setExplode: (e: number) => void
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  /** Restore selections without clearing (e.g. after hot reload). */
  restoreSelections: (
    structural: number[],
    dropIn?: number[],
    meta?: InsertMeta | Record<string, InsertMeta>,
  ) => void
  /**
   * Restore a saved selection snapshot (faces + per-face meta + brush/palette).
   * Does not load the STL — call after setModel.
   */
  restoreSelectionSnapshot: (snap: {
    structural?: number[]
    dropIn?: number[]
    dropInMeta?: Record<string, InsertMeta>
    penCutouts?: PenCutout[]
    palette?: PaletteColor[]
    brushColorId?: string
    cutAxis?: CutAxis
    dropInFloorZ?: number
    insertsOnly?: boolean
    splitHeight?: number
    clearance?: number
  }) => void
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
  for (const [k, v] of m) {
    out.set(k, {
      axis: v.axis,
      floor: v.floor,
      colorId: v.colorId,
      ...(v.entry !== undefined ? { entry: v.entry } : {}),
    })
  }
  return out
}

function clonePenCutouts(list: PenCutout[]): PenCutout[] {
  return list.map((c) => ({
    id: c.id,
    loop: c.loop.map((p) => [...p] as [number, number, number]),
    meta: { ...c.meta, ...(c.meta.entry !== undefined ? { entry: c.meta.entry } : {}) },
  }))
}

function snap(s: State): SelSnap {
  return {
    structural: cloneSel(s.structural),
    dropIn: cloneSel(s.dropIn),
    dropInMeta: cloneMeta(s.dropInMeta),
    penCutouts: clonePenCutouts(s.penCutouts),
  }
}

function brushMetaFrom(s: {
  cutAxis: CutAxis
  dropInFloorZ: number
  brushColorId: string
}): InsertMeta {
  return {
    axis: s.cutAxis,
    floor: s.dropInFloorZ,
    colorId: s.brushColorId,
  }
}

function newColorId(): string {
  return `c_${Math.random().toString(36).slice(2, 9)}`
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
    const entryKey =
      m.entry !== undefined ? m.entry.toFixed(3) : '_'
    const key = `${m.axis}|${m.floor.toFixed(3)}|${entryKey}|${m.colorId}`
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

export function paletteColor(
  palette: PaletteColor[],
  id: string | undefined,
): PaletteColor {
  return (
    palette.find((c) => c.id === id) ??
    palette[0] ?? { id: 'blue', name: 'Blue', hex: '#5ec8ff' }
  )
}

/** Filename-safe slug from a color name. */
export function colorSlug(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return s || 'color'
}

export const useStore = create<State>((set, get) => ({
  model: null,
  splitHeight: 0,
  structural: new Set<number>(),
  dropIn: new Set<number>(),
  dropInMeta: new Map(),
  penCutouts: [],
  paintTool: 'brush',
  activePenIndex: -1,
  palette: DEFAULT_PALETTE.map((c) => ({ ...c })),
  brushColorId: DEFAULT_PALETTE[0]!.id,
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
  esp: true,
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
      penCutouts: [],
      undoStack: [],
      preview: false,
      paintTarget: 'dropIn',
      paintTool: 'brush',
      insertsOnly: false,
      cutAxis: '-z',
      activeIsland: -1,
      activePenIndex: -1,
      splitHeight: split,
      dropInFloorZ: split,
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
  setPaintTool: (t) =>
    set(() => ({
      paintTool: t,
      activeIsland: -1,
      activePenIndex: -1,
      ...(t === 'pen' ? { paintTarget: 'dropIn' as PaintTarget } : {}),
    })),
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
      const floor =
        s.dropInFloorZ >= min && s.dropInFloorZ <= max
          ? s.dropInFloorZ
          : (min + max) / 2
      return { cutAxis: a, dropInFloorZ: floor }
    }),
  setBrushColor: (id) =>
    set((s) => {
      if (!s.palette.some((c) => c.id === id)) return s
      return { brushColorId: id }
    }),
  addPaletteColor: () =>
    set((s) => {
      const id = newColorId()
      const n = s.palette.length + 1
      const color: PaletteColor = {
        id,
        name: `Color ${n}`,
        hex: '#a78bfa',
      }
      return {
        palette: [...s.palette, color],
        brushColorId: id,
      }
    }),
  updatePaletteColor: (id, patch) =>
    set((s) => ({
      palette: s.palette.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.hex !== undefined ? { hex: patch.hex } : {}),
            }
          : c,
      ),
    })),
  removePaletteColor: (id) =>
    set((s) => {
      if (s.palette.length <= 1) return s
      const next = s.palette.filter((c) => c.id !== id)
      const fallback = next[0]!.id
      const dropInMeta = cloneMeta(s.dropInMeta)
      for (const [face, m] of dropInMeta) {
        if (m.colorId === id) {
          dropInMeta.set(face, { ...m, colorId: fallback })
        }
      }
      return {
        palette: next,
        brushColorId: s.brushColorId === id ? fallback : s.brushColorId,
        dropInMeta,
      }
    }),
  setInsertsOnly: (v) =>
    set((s) => {
      if (!v) return { insertsOnly: false }
      const dropIn = cloneSel(s.dropIn)
      const dropInMeta = cloneMeta(s.dropInMeta)
      const brush = brushMetaFrom(s)
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
  setActiveIsland: (i) => set({ activeIsland: i, activePenIndex: -1 }),
  setActivePenIndex: (i) => set({ activePenIndex: i, activeIsland: -1 }),

  addPenCutout: (loop) =>
    set((s) => {
      if (loop.length < 3) return s
      const brush = brushMetaFrom(s)
      const cutout: PenCutout = {
        id: newPenCutoutId(),
        loop,
        meta: { ...brush },
      }
      return {
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
        penCutouts: [...s.penCutouts, cutout],
        activePenIndex: s.penCutouts.length,
        paintTarget: 'dropIn' as PaintTarget,
      }
    }),

  removePenCutout: (id) =>
    set((s) => {
      const idx = s.penCutouts.findIndex((c) => c.id === id)
      if (idx < 0) return s
      const penCutouts = s.penCutouts.filter((c) => c.id !== id)
      return {
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
        penCutouts,
        activePenIndex:
          s.activePenIndex === idx
            ? -1
            : s.activePenIndex > idx
              ? s.activePenIndex - 1
              : s.activePenIndex,
      }
    }),

  applyAxisToPenCutout: (id, axis) =>
    set((s) => {
      if (!s.model) return s
      const { min, max } = axisBounds(s.model, axis)
      const penCutouts = clonePenCutouts(s.penCutouts)
      let any = false
      for (const c of penCutouts) {
        if (c.id !== id) continue
        const floor =
          c.meta.floor >= min && c.meta.floor <= max
            ? c.meta.floor
            : (min + max) / 2
        c.meta = {
          axis,
          floor,
          colorId: c.meta.colorId,
          entry: undefined,
        }
        any = true
      }
      if (!any) return s
      const brushFloor =
        s.dropInFloorZ >= min && s.dropInFloorZ <= max
          ? s.dropInFloorZ
          : (min + max) / 2
      return {
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
        penCutouts,
        cutAxis: axis,
        dropInFloorZ: brushFloor,
      }
    }),

  applyDepthsToPenCutout: (id, patch) =>
    set((s) => {
      if (patch.floor === undefined && patch.entry === undefined) return s
      const penCutouts = clonePenCutouts(s.penCutouts)
      let any = false
      for (const c of penCutouts) {
        if (c.id !== id) continue
        if (patch.floor !== undefined) c.meta.floor = patch.floor
        if (patch.entry !== undefined) c.meta.entry = patch.entry
        any = true
      }
      if (!any) return s
      const out: { penCutouts: PenCutout[]; dropInFloorZ?: number } = {
        penCutouts,
      }
      if (patch.floor !== undefined) out.dropInFloorZ = patch.floor
      return out
    }),

  applyBrushToIslands: (islands) =>
    set((s) => {
      if (islands.length === 0) return s
      const dropInMeta = cloneMeta(s.dropInMeta)
      const brush = brushMetaFrom(s)
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
  applyAxisToIsland: (faces, axis) =>
    set((s) => {
      if (faces.size === 0 || !s.model) return s
      const { min, max } = axisBounds(s.model, axis)
      const dropInMeta = cloneMeta(s.dropInMeta)
      let any = false
      for (const f of faces) {
        if (!s.dropIn.has(f)) continue
        const prev = dropInMeta.get(f) ?? brushMetaFrom(s)
        const floor =
          prev.floor >= min && prev.floor <= max ? prev.floor : (min + max) / 2
        // Entry is axis-relative; clear so it re-defaults on the new axis
        dropInMeta.set(f, {
          axis,
          floor,
          colorId: prev.colorId,
          entry: undefined,
        })
        any = true
      }
      if (!any) return s
      const brushFloor =
        s.dropInFloorZ >= min && s.dropInFloorZ <= max
          ? s.dropInFloorZ
          : (min + max) / 2
      return {
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
        dropInMeta,
        cutAxis: axis,
        dropInFloorZ: brushFloor,
      }
    }),

  applyDepthsToIsland: (faces, patch) =>
    set((s) => {
      if (faces.size === 0) return s
      if (patch.floor === undefined && patch.entry === undefined) return s
      const dropInMeta = cloneMeta(s.dropInMeta)
      let any = false
      for (const f of faces) {
        if (!s.dropIn.has(f)) continue
        const prev = dropInMeta.get(f) ?? brushMetaFrom(s)
        const next: InsertMeta = { ...prev }
        if (patch.floor !== undefined) next.floor = patch.floor
        if (patch.entry !== undefined) next.entry = patch.entry
        dropInMeta.set(f, next)
        any = true
      }
      if (!any) return s
      // Caller should beginStroke() once at drag start so undo is per-gesture.
      const out: {
        dropInMeta: Map<number, InsertMeta>
        dropInFloorZ?: number
      } = { dropInMeta }
      if (patch.floor !== undefined) out.dropInFloorZ = patch.floor
      return out
    }),

  setPreview: (p) => set({ preview: p }),
  setEsp: (v) => set({ esp: v }),
  setExplode: (e) => set({ explode: Math.min(1, Math.max(0, e)) }),
  setBusy: (b) => set({ busy: b }),
  setError: (e) => set({ error: e }),

  restoreSelections: (structural, dropIn = [], meta) => {
    const s = get()
    const brush: InsertMeta = brushMetaFrom(s)
    const dropInMeta = new Map<number, InsertMeta>()
    const perFace =
      meta && typeof meta === 'object' && !('axis' in meta)
        ? (meta as Record<string, InsertMeta>)
        : null
    const uniform =
      meta && typeof meta === 'object' && 'axis' in meta
        ? (meta as InsertMeta)
        : brush
    for (const f of dropIn) {
      const m = perFace?.[String(f)] ?? uniform
      dropInMeta.set(f, {
        axis: m.axis,
        floor: m.floor,
        colorId: m.colorId || s.brushColorId,
        ...(m.entry !== undefined ? { entry: m.entry } : {}),
      })
    }
    set({
      structural: new Set(structural),
      dropIn: new Set(dropIn),
      dropInMeta,
      undoStack: [],
      activeIsland: -1,
    })
  },

  restoreSelectionSnapshot: (snap) => {
    const patch: Partial<State> = {
      undoStack: [],
      activeIsland: -1,
      activePenIndex: -1,
    }
    if (snap.palette?.length) {
      patch.palette = snap.palette.map((c) => ({ ...c }))
    }
    if (snap.brushColorId) patch.brushColorId = snap.brushColorId
    if (snap.cutAxis) patch.cutAxis = snap.cutAxis
    if (typeof snap.dropInFloorZ === 'number') {
      patch.dropInFloorZ = snap.dropInFloorZ
    }
    if (typeof snap.insertsOnly === 'boolean') {
      patch.insertsOnly = snap.insertsOnly
    }
    if (typeof snap.splitHeight === 'number') {
      patch.splitHeight = snap.splitHeight
    }
    if (typeof snap.clearance === 'number') {
      patch.clearance = snap.clearance
    }
    if (snap.penCutouts) {
      patch.penCutouts = snap.penCutouts.map((c) => ({
        id: c.id,
        loop: c.loop.map((p) => [...p] as [number, number, number]),
        meta: {
          axis: c.meta.axis,
          floor: c.meta.floor,
          colorId: c.meta.colorId,
          ...(c.meta.entry !== undefined ? { entry: c.meta.entry } : {}),
        },
      }))
    }
    if (
      snap.palette ||
      snap.brushColorId ||
      snap.cutAxis ||
      snap.dropInFloorZ != null ||
      snap.insertsOnly != null ||
      snap.splitHeight != null ||
      snap.clearance != null ||
      snap.penCutouts
    ) {
      set(patch)
    }
    get().restoreSelections(
      snap.structural ?? [],
      snap.dropIn ?? [],
      snap.dropInMeta,
    )
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
      const brush = brushMetaFrom(s)
      if (mode === 'remove') {
        for (const i of idxs) {
          target.delete(i)
          dropInMeta.delete(i)
        }
      } else {
        for (const i of idxs) {
          target.add(i)
          other.delete(i)
          if (targetKind === 'dropIn') {
            dropInMeta.set(i, { ...brush })
          } else {
            dropInMeta.delete(i)
          }
        }
      }
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
        penCutouts: prev.penCutouts,
        undoStack: stack,
        activeIsland: -1,
        activePenIndex: -1,
      }
    }),

  clearSelection: () => {
    const s = get()
    if (s.structural.size === 0 && s.dropIn.size === 0 && s.penCutouts.length === 0)
      return
    set({
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
      structural: new Set<number>(),
      dropIn: new Set<number>(),
      dropInMeta: new Map(),
      penCutouts: [],
      activeIsland: -1,
      activePenIndex: -1,
    })
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}
