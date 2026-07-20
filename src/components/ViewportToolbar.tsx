import { useStore, paletteColor } from '../state'
import {
  PAINT_TOOL_REGISTRY,
  paintToolHint,
} from '../features/painter/tools/registry'

export default function ViewportToolbar() {
  const model = useStore((s) => s.model)
  const paintTool = useStore((s) => s.paintTool)
  const setPaintTool = useStore((s) => s.setPaintTool)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const paintTarget = useStore((s) => s.paintTarget)
  const setPaintTarget = useStore((s) => s.setPaintTarget)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const brushRadius = useStore((s) => s.brushRadius)
  const setBrushRadius = useStore((s) => s.setBrushRadius)
  const palette = useStore((s) => s.palette)
  const brushColorId = useStore((s) => s.brushColorId)
  const setBrushColor = useStore((s) => s.setBrushColor)
  const undoStack = useStore((s) => s.undoStack)
  const undo = useStore((s) => s.undo)
  const preview = useStore((s) => s.preview)
  const setPreview = useStore((s) => s.setPreview)
  const busy = useStore((s) => s.busy)

  if (!model) return null

  return (
    <div className="viewport-toolbar">
      <div className="tool-card">
        <div className="tool-row">
          <button
            type="button"
            className={paintTool === 'brush' ? 'active' : ''}
            title={`${PAINT_TOOL_REGISTRY.brush.label} (${PAINT_TOOL_REGISTRY.brush.shortcut})`}
            onClick={() => setPaintTool('brush')}
          >
            Brush
          </button>
          <button
            type="button"
            className={paintTool === 'pen' ? 'active' : ''}
            title={`${PAINT_TOOL_REGISTRY.pen.label} (${PAINT_TOOL_REGISTRY.pen.shortcut})`}
            onClick={() => setPaintTool('pen')}
          >
            Pen
          </button>
          <button
            type="button"
            className="tool-ghost"
            title="Undo (⌘Z)"
            disabled={undoStack.length === 0}
            onClick={undo}
          >
            Undo
          </button>
        </div>

        {paintTool === 'brush' && (
          <>
            <div className="tool-row">
              <button
                type="button"
                className={mode === 'add' ? 'active' : ''}
                onClick={() => setMode('add')}
              >
                Paint
              </button>
              <button
                type="button"
                className={mode === 'remove' ? 'active' : ''}
                onClick={() => setMode('remove')}
              >
                Erase
              </button>
            </div>
            {!insertsOnly && (
              <div className="tool-row">
                <button
                  type="button"
                  className={paintTarget === 'dropIn' ? 'active' : ''}
                  onClick={() => setPaintTarget('dropIn')}
                >
                  Insert
                </button>
                <button
                  type="button"
                  className={paintTarget === 'structural' ? 'active' : ''}
                  onClick={() => setPaintTarget('structural')}
                >
                  Fuse to bottom
                </button>
              </div>
            )}
            <label className="tool-slider">
              <span>Size</span>
              <input
                type="range"
                min={0.2}
                max={10}
                step={0.1}
                value={brushRadius}
                onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
              />
              <span className="tool-val">{brushRadius.toFixed(1)}</span>
            </label>
          </>
        )}

        <div className="tool-swatches">
          {palette.slice(0, 6).map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`swatch${brushColorId === c.id ? ' active' : ''}`}
              title={i < 4 ? `${c.name} (${i + 1})` : c.name}
              style={{ background: c.hex }}
              onClick={() => setBrushColor(c.id)}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`viewport-btn${preview ? ' active' : ''}`}
        disabled={busy}
        onClick={() => setPreview(!preview)}
      >
        {preview ? 'Hide preview' : 'Preview cuts'}
      </button>
    </div>
  )
}

export function ViewportHint() {
  const model = useStore((s) => s.model)
  const paintTool = useStore((s) => s.paintTool)
  const mode = useStore((s) => s.mode)
  const paintTarget = useStore((s) => s.paintTarget)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const activeColor = paletteColor(
    useStore((s) => s.palette),
    useStore((s) => s.brushColorId),
  )

  if (!model) return null

  const hint = paintToolHint(paintTool, {
    mode,
    paintTarget,
    insertsOnly,
    colorName: activeColor.name,
  })

  return <div className="viewport-hint">{hint}</div>
}
