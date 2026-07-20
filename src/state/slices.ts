import type { StateCreator } from 'zustand'
import type { InsertMeta, PenCutout } from '../domain'
import type { Model } from '../domain/model'

/** Selection + undo slice shape (composed into painter store). */
export interface SelectionSlice {
  model: Model | null
  structural: Set<number>
  dropIn: Set<number>
  dropInMeta: Map<number, InsertMeta>
  penCutouts: PenCutout[]
  undoStack: Array<{
    structural: Set<number>
    dropIn: Set<number>
    dropInMeta: Map<number, InsertMeta>
    penCutouts: PenCutout[]
  }>
  activeIsland: number
  activePenIndex: number
}

/** Brush / pen tool slice shape. */
export interface ToolSlice {
  paintTool: 'brush' | 'pen'
  mode: 'add' | 'remove'
  paintTarget: 'structural' | 'dropIn'
  brushRadius: number
  brushColorId: string
}

/** Preview + export settings slice shape. */
export interface PreviewSlice {
  preview: boolean
  esp: boolean
  explode: number
  busy: boolean
  error: string | null
}

export type SliceCreator<T> = StateCreator<T, [], [], Partial<T>>
