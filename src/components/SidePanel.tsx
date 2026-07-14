import { useEffect, useMemo, useRef } from 'react'
import {
  useStore,
  resolveIslandMeta,
  type SelectionMode,
  type PaintTarget,
} from '../state'
import { downloadSTL, downloadInsertsZip } from '../lib/exportSTL'
import { prepareParts } from '../lib/prepareParts'
import { countSelectionIslands, listSelectionIslands } from '../lib/select'
import { CUT_AXES, axisBounds } from '../lib/extrude'

const MODES: { id: SelectionMode; label: string; title: string }[] = [
  { id: 'add', label: 'Add', title: 'Drag to paint-add triangles' },
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
  const preview = useStore((s) => s.preview)
  const setPreview = useStore((s) => s.setPreview)
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
    () => ({ axis: cutAxis, floor: dropInFloorZ }),
    [cutAxis, dropInFloorZ],
  )
  const floorBounds = useMemo(
    () => (model ? axisBounds(model, cutAxis) : { min: 0, max: 1 }),
    [model, cutAxis],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

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
        downloadInsertsZip(parts.dropIns, base)
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
                {CUT_AXES.map((a) => (
                  <button
                    key={a.id}
                    className={cutAxis === a.id ? 'active' : ''}
                    title={a.title}
                    onClick={() => setCutAxis(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
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
              feature keeps its own cut direction (e.g. −Z for roof, ±X for
              headlights). Select a feature below and Apply to reassign.
            </div>
          </>
        ) : (
          <div className="empty">Load a model to configure heights.</div>
        )}
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
          <span className="label">Brush radius</span>
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
                    }
                  }}
                >
                  <span>
                    #{i + 1} · {island.size} faces · {m.axis} @{' '}
                    {m.floor.toFixed(1)}
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
              ? 'Painting inserts (blue)'
              : `Painting: ${paintTarget === 'structural' ? 'bottom (orange)' : 'drop-in (blue)'}`}
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
            ? 'Paint regions that become separate inserts. Holes are cut from the full body.'
            : 'Bottom (fused) stays on the chassis. Drop-in inserts are separate parts assembled from above.'}
        </div>
      </section>

      <section>
        <h3>Preview</h3>
        <button
          className={preview ? 'active' : ''}
          onClick={() => setPreview(!preview)}
          disabled={!model || busy}
        >
          {preview ? 'Hide preview' : 'Show preview'}
        </button>
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
              <code>_inserts.zip</code> — one STL per insert feature.
            </>
          ) : (
            <>
              <code>_bottom.stl</code> — chassis ∪ fused features.{' '}
              <code>_upper.stl</code> — shell with holes.{' '}
              <code>_inserts.zip</code> — one STL per drop-in feature.
            </>
          )}
        </div>
      </section>
    </aside>
  )
}
