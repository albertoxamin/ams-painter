import { createContext, useCallback, useContext, useMemo, useRef, useState, type RefObject } from 'react'
import type * as THREE from 'three'

export type InteractionMode = 'paint' | 'orbit' | 'drag-depth' | 'drag-axis'

export interface ViewportPickRefs {
  camera: THREE.Camera | null
  canvas: HTMLCanvasElement | null
}

interface InteractionContextValue {
  mode: InteractionMode
  setMode: (mode: InteractionMode) => void
  gizmoHover: boolean
  setGizmoHover: (v: boolean) => void
  isPainting: boolean
  setIsPainting: (v: boolean) => void
  boxRect: { x0: number; y0: number; x1: number; y1: number } | null
  setBoxRect: (r: { x0: number; y0: number; x1: number; y1: number } | null) => void
  viewportPickRef: RefObject<ViewportPickRefs>
  setViewportPick: (refs: ViewportPickRefs) => void
}

const InteractionContext = createContext<InteractionContextValue | null>(null)

export function InteractionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<InteractionMode>('orbit')
  const [gizmoHover, setGizmoHover] = useState(false)
  const [isPainting, setIsPainting] = useState(false)
  const [boxRect, setBoxRect] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const viewportPickRef = useRef<ViewportPickRefs>({
    camera: null,
    canvas: null,
  })
  const setViewportPick = useCallback((refs: ViewportPickRefs) => {
    viewportPickRef.current = refs
  }, [])

  const value = useMemo(
    () => ({
      mode,
      setMode,
      gizmoHover,
      setGizmoHover,
      isPainting,
      setIsPainting,
      boxRect,
      setBoxRect,
      viewportPickRef,
      setViewportPick,
    }),
    [mode, gizmoHover, isPainting, boxRect, setViewportPick],
  )

  return (
    <InteractionContext.Provider value={value}>
      {children}
    </InteractionContext.Provider>
  )
}

export function useInteraction() {
  const ctx = useContext(InteractionContext)
  if (!ctx) {
    throw new Error('useInteraction must be used within InteractionProvider')
  }
  return ctx
}

export function useInteractionOptional() {
  return useContext(InteractionContext)
}

export function useInteractionFlags() {
  const ctx = useInteractionOptional()
  return useMemo(
    () => ({
      blocksPaint:
        ctx?.mode === 'drag-depth' ||
        ctx?.mode === 'drag-axis' ||
        ctx?.gizmoHover === true,
      isDepthDragging: ctx?.mode === 'drag-depth',
    }),
    [ctx?.gizmoHover, ctx?.mode],
  )
}

export function useSetInteractionMode() {
  const ctx = useInteractionOptional()
  return useCallback(
    (mode: InteractionMode) => {
      ctx?.setMode(mode)
    },
    [ctx],
  )
}
