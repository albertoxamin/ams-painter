import type { PaintTool } from '../../../state'

export interface PaintPointerContext {
  paintTool: PaintTool
  brushRadius: number
  mode: 'add' | 'remove'
}

export interface PaintToolDefinition {
  id: PaintTool
  label: string
  shortcut: string
  hint: string
  usesBrushRadius: boolean
  usesPaintTarget: boolean
}

export const PAINT_TOOL_REGISTRY: Record<PaintTool, PaintToolDefinition> = {
  brush: {
    id: 'brush',
    label: 'Brush',
    shortcut: 'B',
    hint: 'Drag to paint triangle selections on the mesh.',
    usesBrushRadius: true,
    usesPaintTarget: true,
  },
  pen: {
    id: 'pen',
    label: 'Pen',
    shortcut: 'P',
    hint: 'Click points on the model · Enter to finish · Backspace undo point · Esc cancel',
    usesBrushRadius: false,
    usesPaintTarget: false,
  },
}

export const PAINT_TOOL_LIST = Object.values(PAINT_TOOL_REGISTRY)

export function paintToolHint(
  tool: PaintTool,
  ctx: {
    mode: 'add' | 'remove'
    paintTarget: 'structural' | 'dropIn'
    insertsOnly: boolean
    colorName: string
  },
): string {
  const def = PAINT_TOOL_REGISTRY[tool]
  if (tool === 'pen') return def.hint
  if (ctx.mode === 'remove') {
    return 'Drag to erase painted areas · Hold Shift while dragging'
  }
  if (ctx.insertsOnly || ctx.paintTarget === 'dropIn') {
    return `Painting ${ctx.colorName} inserts · Drag to mark · Shift = erase`
  }
  return 'Painting fused bottom features (orange) · Drag to mark'
}
