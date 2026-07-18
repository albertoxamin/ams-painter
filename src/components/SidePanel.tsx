import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import {
  useStore,
  resolveIslandMeta,
  paletteColor,
  type SelectionMode,
  type PaintTarget,
} from '../state'
import { downloadSTL, downloadInsertsZip } from '../lib/exportSTL'
import { prepareParts } from '../lib/prepareParts'
import { countSelectionIslands, listSelectionIslands } from '../lib/select'
import { CUT_AXES, AXIS_COLORS, axisBounds, axisLetter } from '../lib/extrude'

const MODES: { id: SelectionMode; label: string; title: string }[] = [
  { id: 'add', label: 'Add', title: 'Drag to paint-add (hold Shift to remove)' },
  { id: 'remove', label: 'Remove', title: 'Drag to paint-remove triangles' },
]

const TARGETS: { id: PaintTarget; label: string; title: string }[] = [
  {
    id: 'structural',
    label: 'Bottom (fused)',
    title: 'Paint features that stay fused into the bottom chassis',
  },
  {
    id: 'dropIn',
    label: 'Drop-in insert',
    title: 'Paint features that export as separate inserts dropped in from above',
  },
]

export default function SidePanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const model = useStore((s) => s.model)
  const splitHeight = useStore((s) => s.splitHeight)
  const setSplitHeight = useStore((s) => s.setSplitHeight)
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
  const paintTarget = useStore((s) => s.paintTarget)
  const setPaintTarget = useStore((s) => s.setPaintTarget)
  const undoStack = useStore((s) => s.undoStack)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const brushRadius = useStore((s) => s.brushRadius)
  const setBrushRadius = useStore((s) => s.setBrushRadius)
  const clearance = useStore((s) => s.clearance)
  const setClearance = useStore((s) => s.setClearance)
  const dropInFloorZ = useStore((s) => s.dropInFloorZ)
  const setDropInFloorZ = useStore((s) => s.setDropInFloorZ)
  const cutAxis = useStore((s) => s.cutAxis)
  const setCutAxis = useStore((s) => s.setCutAxis)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const setInsertsOnly = useStore((s) => s.setInsertsOnly)
  const activeIsland = useStore((s) => s.activeIsland)
  const setActiveIsland = useStore((s) => s.setActiveIsland)
  const applyBrushToIslands = useStore((s) => s.applyBrushToIslands)
  const palette = useStore((s) => s.palette)
  const brushColorId = useStore((s) => s.brushColorId)
  const setBrushColor = useStore((s) => s.setBrushColor)
  const addPaletteColor = useStore((s) => s.addPaletteColor)
  const updatePaletteColor = useStore((s) => s.updatePaletteColor)
  const removePaletteColor = useStore((s) => s.removePaletteColor)
  const preview = useStore((s) => s.preview)
  const setPreview = useStore((s) => s.setPreview)
  const esp = useStore((s) => s.esp)
  const setEsp = useStore((s) => s.setEsp)
  const explode = useStore((s) => s.explode)
  const setExplode = useStore((s) => s.setExplode)
  const clearSelection = useStore((s) => s.clearSelection)
  const undo = useStore((s) => s.undo)
  const setModel = useStore((s) => s.setModel)
  const setError = useStore((s) => s.setError)
  const busy = useStore((s) => s.busy)
  const error = useStore((s) => s.error)
  const setBusy = useStore((s) => s.setBusy)

  const structuralFeatures = useMemo(
    () => (model ? countSelectionIslands(structural, model.adjacency) : 0),
    [model, structural],
  )
  const dropInIslands = useMemo(
    () => (model ? listSelectionIslands(dropIn, model.adjacency) : []),
    [model, dropIn],
  )
  const dropInFeatures = dropInIslands.length
  const brushMeta = useMemo(
    () => ({ axis: cutAxis, floor: dropInFloorZ, colorId: brushColorId }),
    [cutAxis, dropInFloorZ, brushColorId],
  )
  const activeColor = paletteColor(palette, brushColorId)
  const floorBounds = useMemo(
    () => (model ? axisBounds(model, cutAxis) : { min: 0, max: 1 }),
    [model, cutAxis],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if (mod || e.altKey) return

      const key = e.key.toLowerCase()

      // Palette colors 1–4
      if (key >= '1' && key <= '4') {
        const idx = Number(key) - 1
        const c = useStore.getState().palette[idx]
        if (c) {
          e.preventDefault()
          setBrushColor(c.id)
        }
        return
      }

      // Cut axis: x / y / z — same letter toggles ±, otherwise keep sign
      if (key === 'x' || key === 'y' || key === 'z') {
        e.preventDefault()
        const cur = useStore.getState().cutAxis
        const letter = key as 'x' | 'y' | 'z'
        const sign =
          cur[1] === letter ? (cur[0] === '-' ? '+' : '-') : cur[0]
        setCutAxis(`${sign}${letter}` as typeof cur)
        return
      }

      // Brush radius [ ] 
      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        const cur = useStore.getState().brushRadius
        const step = e.shiftKey ? 1 : 0.2
        const next =
          e.key === ']'
            ? Math.min(10, cur + step)
            : Math.max(0.2, cur - step)
        setBrushRadius(Math.round(next * 10) / 10)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, setBrushColor, setCutAxis, setBrushRadius])

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer()
      const { loadSTL } = await import('../lib/loadSTL')
      const m = loadSTL(buf, file.name)
      setModel(m)
    } catch (e) {
      setError((e as Error).message || 'Failed to load STL')
    }
  }

  const runPrepare = () => {
    if (!model) return null
    return prepareParts(
      model.geometry,
      splitHeight,
      structural,
      dropIn,
      model.zMin,
      clearance,
      {
        dropInFloorZ,
        insertsOnly,
        cutAxis,
        dropInMeta,
        adjacency: model.adjacency,
      },
    )
  }

  const doExport = async (which: 'bottom' | 'upper' | 'dropIns') => {
    if (!model) return
    setBusy(true)
    setError(null)
    try {
      const parts = await runPrepare()
      if (!parts) return
      const base = model.name.replace(/\.stl$/i, '')
      if (which === 'bottom') {
        downloadSTL(
          parts.bottom,
          insertsOnly ? `${base}_body.stl` : `${base}_bottom.stl`,
        )
      } else if (which === 'upper') {
        if (!parts.upper) {
          setError('No upper part in inserts-only mode')
          return
        }
        downloadSTL(parts.upper, `${base}_upper.stl`)
      } else {
        if (parts.dropIns.length === 0) {
          setError('No inserts painted')
          return
        }
        const colorNames = dropInIslands.map((island) => {
          const m = resolveIslandMeta(island, dropInMeta, brushMeta)
          return paletteColor(palette, m.colorId).name
        })
        downloadInsertsZip(parts.dropIns, base, colorNames)
      }
    } catch (e) {
      setError((e as Error).message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="panel">
      <section>
        <h3>Model</h3>
        <input
          ref={fileRef}
          type="file"
          accept=".stl"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <button className="primary" onClick={() => fileRef.current?.click()}>
          Load STL
        </button>
        {model && (
          <div className="help">
            <strong>{model.name}</strong>
            <br />
            {model.count.toLocaleString()} triangles
            <br />
            height (Z-up): {model.zMax.toFixed(2)} mm
          </div>
        )}
      </section>

      <section>
        <h3>Mode</h3>
        <div className="modes">
          <button
            className={!insertsOnly ? 'active' : ''}
            title="Split into bottom + upper, with optional fused features"
            onClick={() => setInsertsOnly(false)}
          >
            Split + features
          </button>
          <button
            className={insertsOnly ? 'active' : ''}
            title="No split — only paint inserts cut from the full body"
            onClick={() => setInsertsOnly(true)}
          >
            Inserts only
          </button>
        </div>
        <div className="help">
          {insertsOnly
            ? 'No horizontal split. Paint inserts; export the body with holes plus separate insert STLs.'
            : 'Split the model at a height. Fuse structural features into the bottom, or cut drop-in inserts.'}
        </div>
      </section>

      <section>
        <h3>{insertsOnly ? 'Insert cut' : 'Split + insert cut'}</h3>
        {model ? (
          <>
            {!insertsOnly && (
              <div className="row stack">
                <span className="label">Split height Z</span>
                <input
                  type="range"
                  min={model.zMin + 0.1}
                  max={model.zMax - 0.1}
                  step={0.1}
                  value={splitHeight}
                  onChange={(e) => setSplitHeight(parseFloat(e.target.value))}
                />
                <div className="row">
                  <span className="label">z = H</span>
                  <input
                    type="number"
                    min={model.zMin}
                    max={model.zMax}
                    step={0.1}
                    value={Number(splitHeight.toFixed(1))}
                    onChange={(e) =>
                      setSplitHeight(parseFloat(e.target.value) || 0)
                    }
                  />
                  <span className="label">mm</span>
                </div>
              </div>
            )}
            <div className="row stack">
              <span className="label">Brush cut axis</span>
              <div className="modes axes">
                {CUT_AXES.map((a) => {
                  const tint = AXIS_COLORS[axisLetter(a.id)]
                  const active = cutAxis === a.id
                  const letter = axisLetter(a.id)
                  return (
                    <button
                      key={a.id}
                      className={active ? 'active axis-tint' : 'axis-tint'}
                      title={`${a.title} (${letter.toUpperCase()} to cycle ±)`}
                      style={
                        {
                          '--axis-tint': tint,
                          color: tint,
                        } as CSSProperties
                      }
                      onClick={() => setCutAxis(a.id)}
                    >
                      {a.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="row stack">
              <span className="label">Brush floor ({cutAxis})</span>
              <div className="row">
                <input
                  type="range"
                  min={floorBounds.min}
                  max={floorBounds.max - 0.1}
                  step={0.1}
                  value={dropInFloorZ}
                  onChange={(e) => setDropInFloorZ(parseFloat(e.target.value))}
                />
                <input
                  type="number"
                  min={floorBounds.min}
                  max={floorBounds.max}
                  step={0.1}
                  value={Number(dropInFloorZ.toFixed(1))}
                  onChange={(e) =>
                    setDropInFloorZ(parseFloat(e.target.value) || floorBounds.min)
                  }
                />
                <span className="label">mm</span>
              </div>
            </div>
            <div className="row stack">
              <span className="label">Print clearance</span>
              <div className="row">
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={clearance}
                  onChange={(e) => setClearance(parseFloat(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={Number(clearance.toFixed(2))}
                  onChange={(e) => setClearance(parseFloat(e.target.value) || 0)}
                />
                <span className="label">mm</span>
              </div>
            </div>
            <div className="help">
              Axis + floor are stamped onto faces when you paint. Each insert
              stops at the floor; the body pocket matches that depth and opens
              a short safety cut the opposite way so the part can seat fully.
              Hover an insert: drag the filled disc to set pocket depth, the
              ring for entry depth, or a gizmo arrow to set axis.
            </div>
          </>
        ) : (
          <div className="empty">Load a model to configure heights.</div>
        )}
      </section>

      <section>
        <h3>Colors</h3>
        <div className="swatch-row">
          {palette.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`swatch${brushColorId === c.id ? ' active' : ''}`}
              title={i < 4 ? `${c.name} (${i + 1})` : c.name}
              style={{ background: c.hex }}
              onClick={() => setBrushColor(c.id)}
            />
          ))}
          <button
            type="button"
            className="swatch add"
            title="Add color"
            onClick={() => addPaletteColor()}
          >
            +
          </button>
        </div>
        <div className="row stack" style={{ marginTop: 6 }}>
          <span className="label">Brush color name</span>
          <input
            type="text"
            value={activeColor.name}
            onChange={(e) =>
              updatePaletteColor(activeColor.id, { name: e.target.value })
            }
          />
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <span className="label">Hex</span>
          <input
            type="color"
            value={
              /^#[0-9a-fA-F]{6}$/.test(activeColor.hex)
                ? activeColor.hex
                : '#5ec8ff'
            }
            onChange={(e) =>
              updatePaletteColor(activeColor.id, { hex: e.target.value })
            }
            style={{ width: 36, height: 28, padding: 0, border: 'none' }}
          />
          <input
            type="text"
            value={activeColor.hex}
            onChange={(e) =>
              updatePaletteColor(activeColor.id, { hex: e.target.value })
            }
            style={{ width: 90 }}
          />
          <button
            type="button"
            className="danger"
            disabled={palette.length <= 1}
            title="Remove color"
            onClick={() => removePaletteColor(activeColor.id)}
          >
            Remove
          </button>
        </div>
        <div className="help">
          Active color is stamped when you paint inserts. Assign per feature
          with Apply below.
        </div>
      </section>

      <section>
        <h3>{insertsOnly ? 'Inserts' : 'Features'}</h3>
        {!insertsOnly && (
          <div className="modes">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                className={paintTarget === t.id ? 'active' : ''}
                title={t.title}
                onClick={() => setPaintTarget(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="modes" style={{ marginTop: insertsOnly ? 0 : 6 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? 'active' : ''}
              title={m.title}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="row stack">
          <span className="label">Brush radius ([ ] · Shift for coarse)</span>
          <div className="row">
            <input
              type="range"
              min={0.2}
              max={10}
              step={0.1}
              value={brushRadius}
              onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
            />
            <span className="value">{brushRadius.toFixed(1)} mm</span>
          </div>
        </div>
        <div className="row stack">
          {!insertsOnly && (
            <span className="label">
              Bottom: {structural.size}
              {structuralFeatures > 0 &&
                ` · ${structuralFeatures} feature${structuralFeatures === 1 ? '' : 's'}`}
            </span>
          )}
          <span className="label">
            {insertsOnly ? 'Inserts' : 'Drop-in'}: {dropIn.size}
            {dropInFeatures > 0 &&
              ` · ${dropInFeatures} feature${dropInFeatures === 1 ? '' : 's'}`}
          </span>
        </div>
        {dropInIslands.length > 0 && (
          <div className="island-list">
            {dropInIslands.map((island, i) => {
              const m = resolveIslandMeta(island, dropInMeta, brushMeta)
              const col = paletteColor(palette, m.colorId)
              const active = activeIsland === i
              return (
                <button
                  key={i}
                  type="button"
                  className={`island-row${active ? ' active' : ''}`}
                  onClick={() => {
                    setActiveIsland(active ? -1 : i)
                    if (!active) {
                      setCutAxis(m.axis)
                      setDropInFloorZ(m.floor)
                      setBrushColor(m.colorId)
                    }
                  }}
                >
                  <span
                    className="island-chip"
                    style={{ background: col.hex }}
                  />
                  <span>
                    #{i + 1} · {island.size} faces · {m.axis} @{' '}
                    {m.floor.toFixed(1)} · {col.name}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              disabled={activeIsland < 0 || activeIsland >= dropInIslands.length}
              onClick={() => {
                if (activeIsland < 0 || activeIsland >= dropInIslands.length)
                  return
                applyBrushToIslands([dropInIslands[activeIsland]!])
              }}
            >
              Apply brush to selected feature
            </button>
          </div>
        )}
        <div className="row">
          <span className="label">
            {insertsOnly
              ? `Painting inserts (${activeColor.name})`
              : `Painting: ${paintTarget === 'structural' ? 'bottom (orange)' : `drop-in (${activeColor.name})`}`}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={undo} disabled={undoStack.length === 0} title="Ctrl/Cmd+Z">
              Undo
            </button>
            <button
              onClick={clearSelection}
              disabled={structural.size === 0 && dropIn.size === 0}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="help">
          {insertsOnly
            ? 'Paint regions that become separate inserts. Hold Shift to deselect. Holes are cut from the full body.'
            : 'Bottom (fused) stays on the chassis. Drop-in inserts are separate parts. Hold Shift to deselect.'}
        </div>
      </section>

      <section>
        <h3>Preview</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className={preview ? 'active' : ''}
            onClick={() => setPreview(!preview)}
            disabled={!model || busy}
          >
            {preview ? 'Hide preview' : 'Show preview'}
          </button>
          <label className="row" title="X-ray outlines of each insert curtain">
            <input
              type="checkbox"
              checked={esp}
              onChange={(e) => setEsp(e.target.checked)}
            />
            <span className="label">ESP outlines</span>
          </label>
        </div>
        {preview && (
          <div className="row stack">
            <span className="label">Explode</span>
            <div className="row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={explode}
                onChange={(e) => setExplode(parseFloat(e.target.value))}
              />
              <span className="value">{Math.round(explode * 100)}%</span>
            </div>
          </div>
        )}
        <div className="help">
          {insertsOnly
            ? 'Body stays put; inserts lift out (blue).'
            : 'Bottom drops, upper lifts, drop-in inserts rise further (blue).'}
        </div>
      </section>

      <section>
        <h3>Export</h3>
        <div className="actions">
          <button
            className="primary"
            onClick={() => doExport('bottom')}
            disabled={!model || busy}
          >
            {insertsOnly ? 'Download body' : 'Download bottom'}
          </button>
          {!insertsOnly && (
            <button
              className="primary"
              onClick={() => doExport('upper')}
              disabled={!model || busy}
            >
              Download upper
            </button>
          )}
          <button
            className="primary"
            onClick={() => doExport('dropIns')}
            disabled={!model || busy || dropIn.size === 0}
          >
            Download inserts (.zip)
          </button>
        </div>
        {error && (
          <div className="help" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        <div className="help">
          {insertsOnly ? (
            <>
              <code>_body.stl</code> — full model with insert holes.{' '}
              <code>_inserts.zip</code> — one STL per insert (
              <code>_insert_1_red.stl</code>, …).
            </>
          ) : (
            <>
              <code>_bottom.stl</code> — chassis ∪ fused features.{' '}
              <code>_upper.stl</code> — shell with holes.{' '}
              <code>_inserts.zip</code> — one STL per drop-in (
              <code>_insert_1_red.stl</code>, …).
            </>
          )}
        </div>
      </section>
    </aside>
  )
}
