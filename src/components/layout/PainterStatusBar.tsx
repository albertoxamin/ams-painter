import { useStore, paletteColor } from '../../state'
import { paintToolHint, PAINT_TOOL_REGISTRY } from '../../features/painter/tools/registry'

export default function PainterStatusBar({
  onShowShortcuts,
}: {
  onShowShortcuts?: () => void
}) {
  const model = useStore((s) => s.model)
  const paintTool = useStore((s) => s.paintTool)
  const mode = useStore((s) => s.mode)
  const paintTarget = useStore((s) => s.paintTarget)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const preview = useStore((s) => s.preview)
  const busy = useStore((s) => s.busy)
  const error = useStore((s) => s.error)
  const cutAxis = useStore((s) => s.cutAxis)
  const brushRadius = useStore((s) => s.brushRadius)
  const activeColor = paletteColor(
    useStore((s) => s.palette),
    useStore((s) => s.brushColorId),
  )

  const hint = model
    ? paintToolHint(paintTool, {
        mode,
        paintTarget,
        insertsOnly,
        colorName: activeColor.name,
      })
    : 'Load an STL to begin · Drop file on viewport'

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        {model ? (
          <>
            <span className="status-item status-model" title={model.name}>
              {model.name}
            </span>
            <span className="status-sep" />
            <span className="status-item">
              {model.count.toLocaleString()} tris
            </span>
            <span className="status-sep" />
            <span className="status-item">
              Z {model.zMin.toFixed(1)}–{model.zMax.toFixed(1)} mm
            </span>
          </>
        ) : (
          <span className="status-item status-dim">No model</span>
        )}
      </div>

      <div
        className={`status-bar-center status-hint${error ? ' status-error' : ''}`}
        title={`${hint} · Press ? for shortcuts`}
        onClick={onShowShortcuts}
        onKeyDown={(e) => e.key === 'Enter' && onShowShortcuts?.()}
        role="button"
        tabIndex={0}
      >
        {busy ? 'Preparing…' : error ?? hint}
      </div>

      <div className="status-bar-right">
        {model && (
          <>
            <span className="status-item">
              <kbd>{PAINT_TOOL_REGISTRY[paintTool].shortcut}</kbd> {paintTool}
            </span>
            {paintTool === 'brush' && (
              <>
                <span className="status-sep" />
                <span className="status-item">⌀ {brushRadius.toFixed(1)}</span>
              </>
            )}
            <span className="status-sep" />
            <span className="status-item">Axis {cutAxis}</span>
            <span className="status-sep" />
            <span
              className="status-color-chip"
              style={{ background: activeColor.hex }}
              title={activeColor.name}
            />
            {preview && (
              <>
                <span className="status-sep" />
                <span className="status-item status-accent">Preview</span>
              </>
            )}
          </>
        )}
      </div>
    </footer>
  )
}
