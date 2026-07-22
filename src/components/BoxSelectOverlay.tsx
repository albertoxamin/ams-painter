import { useInteraction } from '../features/painter/interaction/InteractionContext'

export function BoxSelectOverlay() {
  const { boxRect } = useInteraction()
  if (!boxRect) return null

  const left = Math.min(boxRect.x0, boxRect.x1)
  const top = Math.min(boxRect.y0, boxRect.y1)
  const width = Math.abs(boxRect.x1 - boxRect.x0)
  const height = Math.abs(boxRect.y1 - boxRect.y0)

  return (
    <div
      className="box-select-rect"
      style={{ left, top, width, height }}
      aria-hidden
    />
  )
}
