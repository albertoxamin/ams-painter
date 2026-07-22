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
  flood: {
    id: 'flood',
    label: 'Flood',
    shortcut: 'G',
    hint: 'Click to fill a region · Stops when surface tilts away from the click · Shift = erase',
    usesBrushRadius: false,
    usesPaintTarget: true,
  },
  box: {
    id: 'box',
    label: 'Box',
    shortcut: 'C',
    hint: 'Drag a rectangle to select faces · Middle mouse to orbit · Shift = erase',
    usesBrushRadius: false,
    usesPaintTarget: true,
  },
}

export const PAINT_TOOL_LIST = Object.values(PAINT_TOOL_REGISTRY)

export const SHORTCUT_HELP = [
  { keys: 'B / P / G / C', desc: 'Brush, Pen, Flood, Box tools' },
  { keys: '1–4', desc: 'Palette colors' },
  { keys: 'X Y Z', desc: 'Toggle cut axis / sign' },
  { keys: '[ ]', desc: 'Brush radius' },
  { keys: 'L', desc: 'Select linked (edge-connected island)' },
  { keys: '⌘Z / ⌘⇧Z', desc: 'Undo / Redo' },
  { keys: '⌘I', desc: 'Invert selection' },
  { keys: 'Shift', desc: 'Erase while painting' },
  { keys: '?', desc: 'This help overlay' },
]

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
  if (tool === 'pen' || tool === 'flood' || tool === 'box') return def.hint
  if (ctx.mode === 'remove') {
    return 'Drag to erase painted areas · Hold Shift while dragging'
  }
  if (ctx.insertsOnly || ctx.paintTarget === 'dropIn') {
    return `Painting ${ctx.colorName} inserts · Drag to mark · Shift = erase`
  }
  return 'Painting fused bottom features (orange) · Drag to mark'
}
