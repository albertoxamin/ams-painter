import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../state'
import { facesInScreenRect } from '../lib/brush'
import { useInteraction } from '../features/painter/interaction/InteractionContext'

/**
 * Intercepts LMB drags for box select before OrbitControls sees them.
 * Middle / right mouse still reach the canvas for orbit and pan.
 */
export default function BoxSelectLayer() {
  const paintTool = useStore((s) => s.paintTool)
  const model = useStore((s) => s.model)
  const mode = useStore((s) => s.mode)
  const busy = useStore((s) => s.busy)
  const beginStroke = useStore((s) => s.beginStroke)
  const paintFaces = useStore((s) => s.paintFaces)
  const { setBoxRect, setIsPainting, viewportPickRef } = useInteraction()

  const dragging = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const finishDrag = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      if (!dragging.current || !start.current || !model) return
      const rect = {
        x0: start.current.x,
        y0: start.current.y,
        x1: clientX,
        y1: clientY,
      }
      const dx = rect.x1 - rect.x0
      const dy = rect.y1 - rect.y0
      if (dx * dx + dy * dy > 16) {
        const { camera, canvas } = viewportPickRef.current
        if (camera && canvas) {
          const faces = facesInScreenRect(
            model.geometry,
            camera,
            canvas,
            rect,
          )
          if (faces.length > 0) {
            beginStroke()
            paintFaces(faces, shiftKey ? 'remove' : mode)
          }
        }
      }
      dragging.current = false
      start.current = null
      setBoxRect(null)
      setIsPainting(false)
    },
    [
      model,
      viewportPickRef,
      beginStroke,
      paintFaces,
      mode,
      setBoxRect,
      setIsPainting,
    ],
  )

  useEffect(() => {
    if (paintTool !== 'box' || !model || busy) {
      dragging.current = false
      start.current = null
      setBoxRect(null)
      setIsPainting(false)
      return
    }

    const viewport = document.querySelector('.viewport')
    if (!viewport) return

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!viewport.contains(e.target as Node)) return
      e.preventDefault()
      e.stopPropagation()
      dragging.current = true
      start.current = { x: e.clientX, y: e.clientY }
      setIsPainting(true)
      setBoxRect({
        x0: e.clientX,
        y0: e.clientY,
        x1: e.clientX,
        y1: e.clientY,
      })
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current || !start.current) return
      setBoxRect({
        x0: start.current.x,
        y0: start.current.y,
        x1: e.clientX,
        y1: e.clientY,
      })
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging.current) return
      finishDrag(e.clientX, e.clientY, e.shiftKey)
    }

    const onCancel = () => {
      if (!dragging.current) return
      dragging.current = false
      start.current = null
      setBoxRect(null)
      setIsPainting(false)
    }

    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [
    paintTool,
    model,
    busy,
    finishDrag,
    setBoxRect,
    setIsPainting,
  ])

  return null
}
