import { useStore } from '../state'
import { PAINT_TOOL_REGISTRY } from '../features/painter/tools/registry'

function BrushIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M4 14.5 12.2 6.3c.6-.6 1.5-.6 2.1 0l1.4 1.4c.6.6.6 1.5 0 2.1L7.5 18H4v-3.5Z"
      />
      <path
        fill="currentColor"
        opacity="0.5"
        d="M13.8 5.2 15 4c.8-.8 2-.8 2.8 0l.2.2c.8.8.8 2 0 2.8l-1.2 1.2-3-3Z"
      />
    </svg>
  )
}

function PenIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17h3.5L16.7 6.8c.4-.4.4-1 0-1.4l-1.1-1.1c-.4-.4-1-.4-1.4 0L4 14.5V17Z"
      />
      <path fill="currentColor" opacity="0.45" d="M14 4.5 15.5 6 17 4.5 15.5 3 14 4.5Z" />
    </svg>
  )
}

function FloodIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M10 3 3 14h14L10 3Zm0 4.2 3.8 6.8H6.2L10 7.2Z"
      />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        d="M4 5h12v10H4z"
      />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M7 4 3 8l4 4V9.5c2.5 0 4.8 1.3 6.1 3.5 1.3-2.2 3.6-3.5 6.1-3.5V6c-3.3 0-6.2 1.6-8 4.1C9.2 7.6 6.3 6 3 6V4Z"
      />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M13 4h3v3l-4-4 4-4v3c3.3 0 6.2 1.6 8 4.1C21.8 7.6 18.9 6 15.5 6V4ZM10 9.5c2.5 0 4.8 1.3 6.1 3.5H10V9.5Z"
      />
    </svg>
  )
}

export default function ToolShelf() {
  const model = useStore((s) => s.model)
  const paintTool = useStore((s) => s.paintTool)
  const setPaintTool = useStore((s) => s.setPaintTool)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const paintTarget = useStore((s) => s.paintTarget)
  const setPaintTarget = useStore((s) => s.setPaintTarget)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const brushRadiusVal = useStore((s) => s.brushRadius)
  const setBrushRadius = useStore((s) => s.setBrushRadius)
  const floodAngleDeg = useStore((s) => s.floodAngleDeg)
  const setFloodAngleDeg = useStore((s) => s.setFloodAngleDeg)
  const palette = useStore((s) => s.palette)
  const brushColorId = useStore((s) => s.brushColorId)
  const setBrushColor = useStore((s) => s.setBrushColor)
  const undoStack = useStore((s) => s.undoStack)
  const redoStack = useStore((s) => s.redoStack)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const invertSelection = useStore((s) => s.invertSelection)
  const preview = useStore((s) => s.preview)
  const setPreview = useStore((s) => s.setPreview)
  const busy = useStore((s) => s.busy)

  const paintTools = ['brush', 'pen', 'flood', 'box'] as const

  return (
    <aside className="tool-shelf" aria-label="Tools">
      <div className="tool-shelf-icons">
        {paintTools.map((tool) => (
          <button
            key={tool}
            type="button"
            className={`tool-icon${paintTool === tool ? ' active' : ''}`}
            title={`${PAINT_TOOL_REGISTRY[tool].label} (${PAINT_TOOL_REGISTRY[tool].shortcut})`}
            disabled={!model}
            onClick={() => setPaintTool(tool)}
          >
            {tool === 'brush' && <BrushIcon />}
            {tool === 'pen' && <PenIcon />}
            {tool === 'flood' && <FloodIcon />}
            {tool === 'box' && <BoxIcon />}
          </button>
        ))}
        <div className="tool-shelf-divider" />
        <button
          type="button"
          className="tool-icon"
          title="Undo (⌘Z)"
          disabled={!model || undoStack.length === 0}
          onClick={undo}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="tool-icon"
          title="Redo (⌘⇧Z)"
          disabled={!model || redoStack.length === 0}
          onClick={redo}
        >
          <RedoIcon />
        </button>
      </div>

      {model && (
        <div className="tool-shelf-settings">
          <div className="tool-shelf-heading">
            {PAINT_TOOL_REGISTRY[paintTool].label}
          </div>

          {(paintTool === 'brush' ||
            paintTool === 'flood' ||
            paintTool === 'box') && (
            <>
              <div className="bpy-prop-row">
                <span className="bpy-prop-label">Mode</span>
                <div className="bpy-prop-buttons">
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
              </div>

              {!insertsOnly && (
                <div className="bpy-prop-row">
                  <span className="bpy-prop-label">Target</span>
                  <div className="bpy-prop-buttons">
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
                      Fuse
                    </button>
                  </div>
                </div>
              )}

              {paintTool === 'brush' && (
                <label className="bpy-prop-row bpy-prop-slider">
                  <span className="bpy-prop-label">Radius</span>
                  <input
                    type="range"
                    min={0.2}
                    max={10}
                    step={0.1}
                    value={brushRadiusVal}
                    onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
                  />
                  <span className="bpy-prop-value">{brushRadiusVal.toFixed(1)}</span>
                </label>
              )}

              {paintTool === 'flood' && (
                <label className="bpy-prop-row bpy-prop-slider">
                  <span className="bpy-prop-label">Angle limit</span>
                  <input
                    type="range"
                    min={2}
                    max={60}
                    step={1}
                    value={floodAngleDeg}
                    onChange={(e) => setFloodAngleDeg(parseFloat(e.target.value))}
                  />
                  <span className="bpy-prop-value">{floodAngleDeg.toFixed(0)}°</span>
                </label>
              )}
            </>
          )}

          {(paintTool === 'pen' ||
            paintTool === 'flood' ||
            paintTool === 'box') && (
            <p className="tool-shelf-hint">{PAINT_TOOL_REGISTRY[paintTool].hint}</p>
          )}

          <div className="bpy-prop-row bpy-prop-buttons">
            <button type="button" className="block subtle" onClick={invertSelection}>
              Invert (⌘I)
            </button>
          </div>

          <div className="bpy-prop-row bpy-prop-colors">
            <span className="bpy-prop-label">Color</span>
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
            className={`bpy-prop-toggle${preview ? ' active' : ''}`}
            disabled={busy}
            onClick={() => setPreview(!preview)}
          >
            {preview ? '● Preview on' : '○ Preview off'}
          </button>
        </div>
      )}
    </aside>
  )
}
