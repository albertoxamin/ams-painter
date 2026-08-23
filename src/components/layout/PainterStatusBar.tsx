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
  const busyProgress = useStore((s) => s.busyProgress)
  const error = useStore((s) => s.error)
  const cutAxis = useStore((s) => s.cutAxis)
  const brushRadius = useStore((s) => s.brushRadius)
  const activeColor = paletteColor(
    useStore((s) => s.palette),
    useStore((s) => s.brushColorId),
  )

  const hint = !model
    ? 'Load an STL to begin · Drop file on viewport'
    : preview
      ? 'Preview is view-only · Turn Preview off to paint or select'
      : paintToolHint(paintTool, {
          mode,
          paintTarget,
          insertsOnly,
          colorName: activeColor.name,
        })

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
        {busy ? (
          <span className="status-busy">
            Preparing…
            {busyProgress != null && (
              <>
                <span
                  className="status-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(busyProgress * 100)}
                >
                  <span
                    className="status-progress-fill"
                    style={{ width: `${Math.round(busyProgress * 100)}%` }}
                  />
                </span>
                <span className="status-progress-pct">
                  {Math.round(busyProgress * 100)}%
                </span>
              </>
            )}
          </span>
        ) : (
          (error ?? hint)
        )}
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
