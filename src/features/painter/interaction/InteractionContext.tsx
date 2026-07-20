import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type InteractionMode = 'paint' | 'orbit' | 'drag-depth' | 'drag-axis'

interface InteractionContextValue {
  mode: InteractionMode
  setMode: (mode: InteractionMode) => void
  gizmoHover: boolean
  setGizmoHover: (v: boolean) => void
  isPainting: boolean
  setIsPainting: (v: boolean) => void
}

const InteractionContext = createContext<InteractionContextValue | null>(null)

export function InteractionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<InteractionMode>('orbit')
  const [gizmoHover, setGizmoHover] = useState(false)
  const [isPainting, setIsPainting] = useState(false)

  const value = useMemo(
    () => ({
      mode,
      setMode,
      gizmoHover,
      setGizmoHover,
      isPainting,
      setIsPainting,
    }),
    [mode, gizmoHover, isPainting],
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
