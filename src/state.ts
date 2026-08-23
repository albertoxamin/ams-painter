import { create } from 'zustand'
import * as THREE from 'three'
import { axisBounds,
  type CutAxis,
  type InsertMeta,
  type PaletteColor,
} from './lib/extrude'
import { type PenCutout, newPenCutoutId, flattenPenLoopToMeshExtreme } from './lib/penCutout'
import { floodSelect, meshIslandFrom } from './lib/select'
import type { Model } from './domain/model'
import type { SplitLockAxis, SplitMode } from './lib/split'
import { cloneNode, type SplitPathNode } from './lib/splitBezier'
import {
  DEFAULT_PALETTE,
  resolveIslandMeta,
  paletteColor,
  colorSlug,
} from './domain/palette'

export type SelectionMode = 'add' | 'remove'
export type PaintTool = 'brush' | 'pen' | 'flood' | 'box' | 'splitLine'
export type CameraProjection = 'perspective' | 'isometric'
export type ViewFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'
export type SplitSplinePoint = SplitPathNode
/** Where painted faces go: fused into bottom, or separate drop-in inserts. */
export type PaintTarget = 'structural' | 'dropIn'
export type { CutAxis, InsertMeta, PaletteColor, PenCutout, Model }
export type { SplitLockAxis, SplitMode } from './lib/split'
export { DEFAULT_PALETTE, resolveIslandMeta, paletteColor, colorSlug }

interface SelSnap {
  structural: Set<number>
  dropIn: Set<number>
  dropInMeta: Map<number, InsertMeta>
  penCutouts: PenCutout[]
}

const MAX_UNDO = 50

interface State {
  model: Model | null
  splitHeight: number
  splitMode: SplitMode
  splitLockAxis: SplitLockAxis
  /** Drawing-plane face for the split-line tool (independent of the view cube). */
  splitDrawFace: ViewFace
  splitSpline: SplitSplinePoint[]
  cameraProjection: CameraProjection
  viewFace: ViewFace | null
  viewTick: number
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
  redoStack: SelSnap[]
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
  /** Flood-fill angle limit in degrees (vs seed face normal). */
  floodAngleDeg: number
  /** working flag for CSG ops */
  busy: boolean
  /** 0–1 while busy, otherwise null */
  busyProgress: number | null
  error: string | null

  setModel: (m: Model | null) => void
  setSplitHeight: (h: number) => void
  setSplitMode: (m: SplitMode) => void
  setSplitLockAxis: (a: SplitLockAxis) => void
  setSplitDrawFace: (face: ViewFace) => void
  setSplitSpline: (pts: SplitSplinePoint[]) => void
  setCameraProjection: (p: CameraProjection) => void
  snapViewFace: (face: ViewFace) => void
  setMode: (m: SelectionMode) => void
  setPaintTool: (t: PaintTool) => void
  setPaintTarget: (t: PaintTarget) => void
  setBrushRadius: (r: number) => void
  setFloodAngleDeg: (deg: number) => void
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
  selectPenCutout: (i: number) => void
  /** Commit a closed pen loop as a new insert cutout. */
  addPenCutout: (loop: [number, number, number][]) => void
  removePenCutout: (id: string) => void
  flattenPenCutout: (id: string) => void
  setPenCutoutLoop: (id: string, loop: [number, number, number][]) => void
  applyColorToPenCutout: (id: string, colorId: string) => void
  removeDropInFaces: (faces: Set<number>) => void
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
  setBusyProgress: (p: number) => void
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
    splitMode?: 'height' | 'spline'
    splitLockAxis?: 'x' | 'y' | 'z'
    splitSpline?: SplitSplinePoint[]
    clearance?: number
  }) => void
  /** Push current selections onto the undo stack (call once per stroke). */
  beginStroke: () => void
  /** Paint faces during an active stroke (no extra undo entries). */
  paintFaces: (idxs: number[], mode: SelectionMode) => void
  /** Flood-fill from a seed triangle and paint the result. */
  floodPaintAt: (faceIdx: number, mode: SelectionMode) => void
  /** Select all faces in the edge-connected island containing faceIdx. */
  selectLinkedAt: (faceIdx: number) => void
  /** Invert selection in the active paint target. */
  invertSelection: () => void
  undo: () => void
  redo: () => void
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
    ...(c.flat ? { flat: true as const } : {}),
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

function pushUndo(s: State): Partial<State> {
  return {
    undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
    redoStack: [],
  }
}

function restoreSnap(prev: SelSnap): Partial<State> {
  return {
    structural: prev.structural,
    dropIn: prev.dropIn,
    dropInMeta: prev.dropInMeta,
    penCutouts: prev.penCutouts,
    activeIsland: -1,
    activePenIndex: -1,
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

export const useStore = create<State>((set, get) => ({
  model: null,
  splitHeight: 0,
  splitMode: 'height',
  splitLockAxis: 'y',
  splitDrawFace: 'front',
  splitSpline: [],
  cameraProjection: 'perspective',
  viewFace: null,
  viewTick: 0,
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
  redoStack: [],
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
  floodAngleDeg: 18,
  busy: false,
  busyProgress: null,
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
      redoStack: [],
      preview: false,
      paintTarget: 'dropIn',
      paintTool: 'brush',
      insertsOnly: false,
      cutAxis: '-z',
      activeIsland: -1,
      activePenIndex: -1,
      splitHeight: split,
      splitMode: 'height',
      splitLockAxis: 'y',
      splitDrawFace: 'front',
      splitSpline: [],
      cameraProjection: 'perspective',
      viewFace: null,
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
  setSplitMode: (m) =>
    set((s) => ({
      splitMode: m,
      paintTool:
        m === 'height' && s.paintTool === 'splitLine' ? 'brush' : s.paintTool,
    })),
  setSplitLockAxis: (a) =>
    set({
      splitLockAxis: a,
      splitDrawFace: a === 'x' ? 'right' : a === 'y' ? 'front' : 'top',
    }),
  setSplitDrawFace: (face) =>
    set({
      splitDrawFace: face,
      splitLockAxis:
        face === 'top' || face === 'bottom'
          ? 'z'
          : face === 'front' || face === 'back'
            ? 'y'
            : 'x',
    }),
  setSplitSpline: (pts) => set({ splitSpline: pts.map(cloneNode) }),
  setCameraProjection: (p) => set({ cameraProjection: p }),
  snapViewFace: (face) =>
    set({
      viewFace: face,
      viewTick: get().viewTick + 1,
    }),
  setMode: (m) => set({ mode: m }),
  setPaintTool: (t) =>
    set((s) => ({
      paintTool: t,
      ...(t === 'pen' ? { paintTarget: 'dropIn' as PaintTarget } : {}),
      // Tool-shelf / shortcut: enter draw mode. Row click uses selectPenCutout.
      ...(t === 'pen' || s.paintTool === 'pen' ? { activePenIndex: -1 } : {}),
    })),
  setPaintTarget: (t) => set({ paintTarget: t }),
  setBrushRadius: (r) => set({ brushRadius: Math.max(0.1, r) }),
  setFloodAngleDeg: (deg) =>
    set({ floodAngleDeg: Math.min(90, Math.max(1, deg)) }),
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
        paintTool: s.paintTool === 'splitLine' ? 'brush' : s.paintTool,
      }
    }),
  setActiveIsland: (i) => set({ activeIsland: i, activePenIndex: -1 }),
  setActivePenIndex: (i) => set({ activePenIndex: i, activeIsland: -1 }),
  selectPenCutout: (i) =>
    set((s) => {
      if (i < 0) return { activePenIndex: -1 }
      const c = s.penCutouts[i]
      if (!c) return s
      const { min, max } = s.model
        ? axisBounds(s.model, c.meta.axis)
        : { min: c.meta.floor, max: c.meta.floor }
      const floor = Math.min(max, Math.max(min, c.meta.floor))
      return {
        activePenIndex: i,
        activeIsland: -1,
        paintTool: 'pen' as const,
        paintTarget: 'dropIn' as PaintTarget,
        cutAxis: c.meta.axis,
        dropInFloorZ: floor,
        brushColorId: c.meta.colorId,
      }
    }),

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
        ...pushUndo(s),
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
        ...pushUndo(s),
        penCutouts,
        activePenIndex:
          s.activePenIndex === idx
            ? -1
            : s.activePenIndex > idx
              ? s.activePenIndex - 1
              : s.activePenIndex,
      }
    }),

  flattenPenCutout: (id) =>
    set((s) => {
      const penCutouts = clonePenCutouts(s.penCutouts)
      const c = penCutouts.find((x) => x.id === id)
      if (!c || c.loop.length < 3) return s
      const loop = c.loop.map(([x, y, z]) => new THREE.Vector3(x, y, z))
      const pts = flattenPenLoopToMeshExtreme(
        s.model?.geometry ?? null,
        loop,
        c.meta.axis,
      )
      c.loop = pts.map((p) => [p.x, p.y, p.z] as [number, number, number])
      c.flat = true
      return { ...pushUndo(s), penCutouts }
    }),

  setPenCutoutLoop: (id, loop) =>
    set((s) => {
      if (loop.length < 3) return s
      const penCutouts = clonePenCutouts(s.penCutouts)
      const c = penCutouts.find((x) => x.id === id)
      if (!c) return s
      c.loop = loop.map((p) => [...p] as [number, number, number])
      return { penCutouts }
    }),

  applyColorToPenCutout: (id, colorId) =>
    set((s) => {
      const penCutouts = clonePenCutouts(s.penCutouts)
      const c = penCutouts.find((x) => x.id === id)
      if (!c) return s
      c.meta = { ...c.meta, colorId }
      return { ...pushUndo(s), penCutouts, brushColorId: colorId }
    }),

  removeDropInFaces: (faces) =>
    set((s) => {
      if (faces.size === 0) return s
      const dropIn = cloneSel(s.dropIn)
      const dropInMeta = cloneMeta(s.dropInMeta)
      let any = false
      for (const f of faces) {
        if (!dropIn.has(f)) continue
        dropIn.delete(f)
        dropInMeta.delete(f)
        any = true
      }
      if (!any) return s
      return {
        ...pushUndo(s),
        dropIn,
        dropInMeta,
        activeIsland: -1,
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
        ...pushUndo(s),
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
        ...pushUndo(s),
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
        ...pushUndo(s),
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
  setBusy: (b) => set(b ? { busy: true } : { busy: false, busyProgress: null }),
  setBusyProgress: (p) =>
    set({ busyProgress: Math.max(0, Math.min(1, p)) }),
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
      redoStack: [],
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
    if (snap.splitMode === 'height' || snap.splitMode === 'spline') {
      patch.splitMode = snap.splitMode
    }
    if (
      snap.splitLockAxis === 'x' ||
      snap.splitLockAxis === 'y' ||
      snap.splitLockAxis === 'z'
    ) {
      patch.splitLockAxis = snap.splitLockAxis
    }
    if (snap.splitSpline) {
      patch.splitSpline = snap.splitSpline.map(cloneNode)
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
        ...(c.flat ? { flat: true as const } : {}),
      }))
    }
    if (
      snap.palette ||
      snap.brushColorId ||
      snap.cutAxis ||
      snap.dropInFloorZ != null ||
      snap.insertsOnly != null ||
      snap.splitHeight != null ||
      snap.splitMode ||
      snap.splitLockAxis ||
      snap.splitSpline ||
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

  beginStroke: () => set((s) => pushUndo(s)),

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

  floodPaintAt: (faceIdx, mode) => {
    const s = get()
    if (!s.model) return
    const targetKind = s.insertsOnly ? 'dropIn' : s.paintTarget
    const target = targetKind === 'structural' ? s.structural : s.dropIn

    let blocked: Set<number>
    if (mode === 'add') {
      // Stop at any existing paint so a ring selection bounds the fill.
      blocked = new Set([...s.structural, ...s.dropIn])
      if (blocked.has(faceIdx)) return
    } else {
      if (!target.has(faceIdx)) return
      blocked = new Set<number>()
      for (let t = 0; t < s.model.count; t++) {
        if (!target.has(t)) blocked.add(t)
      }
    }

    const faces = floodSelect(
      s.model,
      faceIdx,
      s.floodAngleDeg,
      s.model.adjacency,
      { blocked },
    )
    if (faces.length === 0) return
    get().beginStroke()
    get().paintFaces(faces, mode)
  },

  selectLinkedAt: (faceIdx) => {
    const s = get()
    if (!s.model) return
    const faces = meshIslandFrom(faceIdx, s.model.adjacency)
    get().beginStroke()
    get().paintFaces(faces, s.mode)
  },

  invertSelection: () =>
    set((s) => {
      if (!s.model) return s
      const triCount = s.model.count
      const targetKind = s.insertsOnly ? 'dropIn' : s.paintTarget
      const structural = cloneSel(s.structural)
      const dropIn = cloneSel(s.dropIn)
      const dropInMeta = cloneMeta(s.dropInMeta)
      const brush = brushMetaFrom(s)

      if (targetKind === 'dropIn') {
        for (let i = 0; i < triCount; i++) {
          if (s.structural.has(i)) continue
          if (s.dropIn.has(i)) {
            dropIn.delete(i)
            dropInMeta.delete(i)
          } else {
            dropIn.add(i)
            dropInMeta.set(i, { ...brush })
          }
        }
      } else {
        for (let i = 0; i < triCount; i++) {
          if (s.dropIn.has(i)) continue
          if (s.structural.has(i)) {
            structural.delete(i)
          } else {
            structural.add(i)
          }
        }
      }
      for (const k of [...dropInMeta.keys()]) {
        if (!dropIn.has(k)) dropInMeta.delete(k)
      }
      return {
        ...pushUndo(s),
        structural,
        dropIn,
        dropInMeta,
        activeIsland: -1,
        activePenIndex: -1,
      }
    }),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return s
      const stack = s.undoStack.slice()
      const prev = stack.pop()!
      return {
        ...restoreSnap(prev),
        undoStack: stack,
        redoStack: [...s.redoStack.slice(-(MAX_UNDO - 1)), snap(s)],
      }
    }),

  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return s
      const stack = s.redoStack.slice()
      const next = stack.pop()!
      return {
        ...restoreSnap(next),
        redoStack: stack,
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snap(s)],
      }
    }),

  clearSelection: () => {
    const s = get()
    if (s.structural.size === 0 && s.dropIn.size === 0 && s.penCutouts.length === 0)
      return
    set({
      ...pushUndo(s),
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
