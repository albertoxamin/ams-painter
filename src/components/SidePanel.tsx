import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import {
  useStore,
  resolveIslandMeta,
  paletteColor,
} from '../state'
import { downloadSTL, downloadInsertsZip, downloadAllPartsZip } from '../lib/exportSTL'
import {
  buildSelectionSnapshot,
  downloadSelectionSnapshot,
  downloadProjectFile,
  parseProjectFile,
  validateSnapshotForModel,
  MESH_TRI_WARN,
} from '../lib/selectionSnapshot'
import { tryRestoreAutosave } from '../lib/restoreAutosave'
import { countSelectionIslands, listSelectionIslands } from '../lib/select'
import { awaitPreparedParts } from '../features/painter/prepare/usePreparedParts'
import { CUT_AXES, AXIS_COLORS, axisBounds, axisLetter } from '../lib/extrude'
import CollapsibleSection from './layout/CollapsibleSection'

export default function SidePanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const markingsRef = useRef<HTMLInputElement>(null)

  const model = useStore((s) => s.model)
  const splitHeight = useStore((s) => s.splitHeight)
  const setSplitHeight = useStore((s) => s.setSplitHeight)
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
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
  const esp = useStore((s) => s.esp)
  const setEsp = useStore((s) => s.setEsp)
  const explode = useStore((s) => s.explode)
  const setExplode = useStore((s) => s.setExplode)
  const clearSelection = useStore((s) => s.clearSelection)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const invertSelection = useStore((s) => s.invertSelection)
  const setModel = useStore((s) => s.setModel)
  const setError = useStore((s) => s.setError)
  const busy = useStore((s) => s.busy)
  const error = useStore((s) => s.error)
  const setBusy = useStore((s) => s.setBusy)
  const setPaintTool = useStore((s) => s.setPaintTool)
  const restoreSelectionSnapshot = useStore((s) => s.restoreSelectionSnapshot)
  const penCutouts = useStore((s) => s.penCutouts)
  const activePenIndex = useStore((s) => s.activePenIndex)
  const setActivePenIndex = useStore((s) => s.setActivePenIndex)
  const removePenCutout = useStore((s) => s.removePenCutout)

  const dropInIslands = useMemo(
    () => (model ? listSelectionIslands(dropIn, model.adjacency) : []),
    [model, dropIn],
  )
  const brushMeta = useMemo(
    () => ({ axis: cutAxis, floor: dropInFloorZ, colorId: brushColorId }),
    [cutAxis, dropInFloorZ, brushColorId],
  )
  const activeColor = paletteColor(palette, brushColorId)
  const floorBounds = useMemo(
    () => (model ? axisBounds(model, cutAxis) : { min: 0, max: 1 }),
    [model, cutAxis],
  )

  const insertCount = dropInIslands.length + penCutouts.length
  const hasMarks =
    structural.size > 0 || dropIn.size > 0 || penCutouts.length > 0

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
      if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        invertSelection()
        return
      }
      if (mod || e.altKey) return

      const key = e.key.toLowerCase()

      if (key >= '1' && key <= '4') {
        const idx = Number(key) - 1
        const c = useStore.getState().palette[idx]
        if (c) {
          e.preventDefault()
          setBrushColor(c.id)
        }
        return
      }

      if (key === 'x' || key === 'y' || key === 'z') {
        e.preventDefault()
        const cur = useStore.getState().cutAxis
        const letter = key as 'x' | 'y' | 'z'
        const sign =
          cur[1] === letter ? (cur[0] === '-' ? '+' : '-') : cur[0]
        setCutAxis(`${sign}${letter}` as typeof cur)
        return
      }

      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        const cur = useStore.getState().brushRadius
        const step = e.shiftKey ? 1 : 0.2
        const next =
          e.key === ']'
            ? Math.min(10, cur + step)
            : Math.max(0.2, cur - step)
        setBrushRadius(Math.round(next * 10) / 10)
        return
      }

      if (key === 'b') {
        e.preventDefault()
        setPaintTool('brush')
        return
      }
      if (key === 'p') {
        e.preventDefault()
        setPaintTool('pen')
        return
      }
      if (key === 'g') {
        e.preventDefault()
        setPaintTool('flood')
        return
      }
      if (key === 'c') {
        e.preventDefault()
        setPaintTool('box')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, invertSelection, setBrushColor, setCutAxis, setBrushRadius, setPaintTool])

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer()
      const { loadSTL } = await import('../lib/loadSTL')
      const m = loadSTL(buf, file.name)
      setModel(m)
      if (m.count > MESH_TRI_WARN) {
        setError(
          `Large mesh (${m.count.toLocaleString()} tris). Consider simplifying in Repair tab first.`,
        )
      } else {
        setError(null)
      }
      await tryRestoreAutosave(m, restoreSelectionSnapshot)
    } catch (e) {
      setError((e as Error).message || 'Failed to load STL')
    }
  }

  const loadDemo = async () => {
    setBusy(true)
    setError(null)
    try {
      const stlUrl = `${import.meta.env.BASE_URL}dodge-viper-gen2.stl`
      const res = await fetch(stlUrl)
      if (!res.ok) throw new Error('Demo STL not found')
      const buf = await res.arrayBuffer()
      const { loadSTL } = await import('../lib/loadSTL')
      const m = loadSTL(buf, 'dodge-viper-gen2.stl')
      setModel(m)
      const markingsRes = await fetch(
        `${import.meta.env.BASE_URL}selections/dodge-viper-gen2.json`,
      )
      if (markingsRes.ok) {
        const snap = parseProjectFile(await markingsRes.json())
        const mismatch = validateSnapshotForModel(snap, m)
        if (!mismatch) restoreSelectionSnapshot(snap)
      } else {
        await tryRestoreAutosave(m, restoreSelectionSnapshot)
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to load demo')
    } finally {
      setBusy(false)
    }
  }

  const doExportAll = async () => {
    if (!model) return
    setBusy(true)
    setError(null)
    try {
      const parts = await runPrepare()
      if (!parts) return
      const colorNames = [
        ...dropInIslands.map((island) => {
          const m = resolveIslandMeta(island, dropInMeta, brushMeta)
          return paletteColor(palette, m.colorId).name
        }),
        ...penCutouts.map((c) => paletteColor(palette, c.meta.colorId).name),
      ]
      const snap = buildSelectionSnapshot({
        model,
        insertsOnly,
        splitHeight,
        cutAxis,
        dropInFloorZ,
        brushColorId,
        clearance,
        palette,
        structural,
        dropIn,
        dropInMeta,
        penCutouts,
      })
      downloadAllPartsZip({
        baseName: model.name,
        bottom: parts.bottom,
        upper: parts.upper,
        dropIns: parts.dropIns,
        dropInNames: colorNames,
        insertsOnly: parts.insertsOnly,
        snapshot: snap,
      })
    } catch (e) {
      setError((e as Error).message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const saveMarkings = () => {
    if (!model) return
    const snap = buildSelectionSnapshot({
      model,
      insertsOnly,
      splitHeight,
      cutAxis,
      dropInFloorZ,
      brushColorId,
      clearance,
      palette,
      structural,
      dropIn,
      dropInMeta,
      penCutouts,
    })
    downloadSelectionSnapshot(snap, model.name)
  }

  const saveProject = () => {
    if (!model) return
    const snap = buildSelectionSnapshot({
      model,
      insertsOnly,
      splitHeight,
      cutAxis,
      dropInFloorZ,
      brushColorId,
      clearance,
      palette,
      structural,
      dropIn,
      dropInMeta,
      penCutouts,
    })
    downloadProjectFile(snap, model.name)
  }

  const onMarkingsFile = async (file: File) => {
    if (!model) {
      setError('Load the STL first, then load markings')
      return
    }
    try {
      const text = await file.text()
      const snap = parseProjectFile(JSON.parse(text))
      const mismatch = validateSnapshotForModel(snap, model)
      if (mismatch) {
        setError(mismatch)
        return
      }
      restoreSelectionSnapshot(snap)
      setError(null)
    } catch (e) {
      setError((e as Error).message || 'Failed to load markings JSON')
    }
  }

  const runPrepare = async () => {
    const prepared = await awaitPreparedParts({
      model,
      splitHeight,
      structural,
      dropIn,
      dropInMeta,
      penCutouts,
      clearance,
      dropInFloorZ,
      insertsOnly,
      cutAxis,
    })
    if (!prepared) return null
    return {
      bottom: prepared.lower,
      upper: prepared.upper,
      dropIns: prepared.dropIns,
      insertsOnly: prepared.insertsOnly,
    }
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
          setError('No inserts marked yet')
          return
        }
        const colorNames = [
          ...dropInIslands.map((island) => {
            const m = resolveIslandMeta(island, dropInMeta, brushMeta)
            return paletteColor(palette, m.colorId).name
          }),
          ...penCutouts.map((c) => paletteColor(palette, c.meta.colorId).name),
        ]
        downloadInsertsZip(parts.dropIns, base, colorNames)
      }
    } catch (e) {
      setError((e as Error).message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="properties-panel" aria-label="Properties">
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
      <input
        ref={markingsRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onMarkingsFile(f)
          e.target.value = ''
        }}
      />

      <CollapsibleSection title="Scene" defaultOpen>
        <button className="primary block" onClick={() => fileRef.current?.click()}>
          {model ? 'Change model' : 'Open STL'}
        </button>
        <button type="button" className="block subtle" disabled={busy} onClick={() => void loadDemo()}>
          Load demo (Viper)
        </button>
        {model && (
          <div className="actions compact">
            <button
              type="button"
              className="block"
              disabled={!hasMarks}
              onClick={saveMarkings}
            >
              Save markings
            </button>
            <button
              type="button"
              className="block"
              disabled={!hasMarks}
              onClick={saveProject}
            >
              Save project (.amspaint)
            </button>
            <button
              type="button"
              className="block"
              onClick={() => markingsRef.current?.click()}
            >
              Load markings / project
            </button>
          </div>
        )}
        {model && model.count > MESH_TRI_WARN && (
          <p className="error-text">
            Large mesh ({model.count.toLocaleString()} tris) — painting may be
            slow. Try GLB repair to decimate first.
          </p>
        )}
        <div className="bpy-prop-row">
          <span className="bpy-prop-label">Workflow</span>
          <div className="bpy-prop-buttons">
            <button
              type="button"
              className={insertsOnly ? 'active' : ''}
              onClick={() => setInsertsOnly(true)}
            >
              Inserts
            </button>
            <button
              type="button"
              className={!insertsOnly ? 'active' : ''}
              onClick={() => setInsertsOnly(false)}
            >
              Split
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Insert regions" badge={insertCount || undefined}>
        {insertCount === 0 ? (
          <p className="empty-state">
            Paint or draw regions on the mesh. Each color becomes a separate
            printed piece.
          </p>
        ) : (
          <ul className="feature-list">
            {dropInIslands.map((island, i) => {
              const m = resolveIslandMeta(island, dropInMeta, brushMeta)
              const col = paletteColor(palette, m.colorId)
              const active = activeIsland === i
              return (
                <li key={`b-${i}`}>
                  <button
                    type="button"
                    className={`feature-row${active ? ' active' : ''}`}
                    onClick={() => {
                      setActiveIsland(active ? -1 : i)
                      setActivePenIndex(-1)
                      if (!active) {
                        setCutAxis(m.axis)
                        setDropInFloorZ(m.floor)
                        setBrushColor(m.colorId)
                      }
                    }}
                  >
                    <span className="feature-chip" style={{ background: col.hex }} />
                    <span className="feature-body">
                      <strong>{col.name}</strong>
                      <span>
                        Brush · {m.axis} · {m.floor.toFixed(1)} mm
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            {penCutouts.map((cutout, i) => {
              const col = paletteColor(palette, cutout.meta.colorId)
              const active = activePenIndex === i
              return (
                <li key={cutout.id}>
                  <button
                    type="button"
                    className={`feature-row${active ? ' active' : ''}`}
                    onClick={() => {
                      setActivePenIndex(active ? -1 : i)
                      setActiveIsland(-1)
                      if (!active) {
                        setPaintTool('pen')
                        setCutAxis(cutout.meta.axis)
                        setDropInFloorZ(cutout.meta.floor)
                        setBrushColor(cutout.meta.colorId)
                      }
                    }}
                  >
                    <span className="feature-chip" style={{ background: col.hex }} />
                    <span className="feature-body">
                      <strong>{col.name}</strong>
                      <span>
                        Pen · {cutout.loop.length} pts · {cutout.meta.axis}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {activeIsland >= 0 && activeIsland < dropInIslands.length && (
          <button
            type="button"
            className="block subtle"
            onClick={() =>
              applyBrushToIslands([dropInIslands[activeIsland]!])
            }
          >
            Apply color to selection
          </button>
        )}
        {activePenIndex >= 0 && activePenIndex < penCutouts.length && (
          <button
            type="button"
            className="block danger subtle"
            onClick={() => {
              const c = penCutouts[activePenIndex]
              if (c) removePenCutout(c.id)
            }}
          >
            Delete pen cutout
          </button>
        )}

        {hasMarks && (
          <button
            type="button"
            className="block subtle"
            onClick={clearSelection}
          >
            Clear all markings
          </button>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Export" defaultOpen>
        {preview && (
          <label className="bpy-prop-row bpy-prop-slider">
            <span className="bpy-prop-label">Explode</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explode}
              onChange={(e) => setExplode(parseFloat(e.target.value))}
            />
            <span className="bpy-prop-value">{Math.round(explode * 100)}%</span>
          </label>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={esp}
            onChange={(e) => setEsp(e.target.checked)}
          />
          Show cut depth guides
        </label>
        <div className="actions">
          <button
            className="primary"
            onClick={() => void doExportAll()}
            disabled={!model || busy}
          >
            Export all (.zip)
          </button>
          <button
            className="primary"
            onClick={() => doExport('bottom')}
            disabled={!model || busy}
          >
            {insertsOnly ? 'Body with holes' : 'Bottom part'}
          </button>
          {!insertsOnly && (
            <button
              className="primary"
              onClick={() => doExport('upper')}
              disabled={!model || busy}
            >
              Upper shell
            </button>
          )}
          <button
            className="primary"
            onClick={() => doExport('dropIns')}
            disabled={!model || busy || insertCount === 0}
          >
            Insert pieces (.zip)
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </CollapsibleSection>

      <CollapsibleSection title="Advanced" defaultOpen={false}>
        {model && !insertsOnly && (
          <label className="field">
            <span>Split height (Z)</span>
            <div className="field-row">
              <input
                type="range"
                min={model.zMin + 0.1}
                max={model.zMax - 0.1}
                step={0.1}
                value={splitHeight}
                onChange={(e) => setSplitHeight(parseFloat(e.target.value))}
              />
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
            </div>
          </label>
        )}

        <label className="field">
          <span>Default cut direction</span>
          <div className="modes axes">
            {CUT_AXES.map((a) => {
              const tint = AXIS_COLORS[axisLetter(a.id)]
              const active = cutAxis === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  className={active ? 'active axis-tint' : 'axis-tint'}
                  title={a.title}
                  style={{ '--axis-tint': tint, color: tint } as CSSProperties}
                  onClick={() => setCutAxis(a.id)}
                >
                  {a.label}
                </button>
              )
            })}
          </div>
        </label>

        <label className="field">
          <span>Default pocket depth ({cutAxis})</span>
          <div className="field-row">
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
          </div>
        </label>

        <label className="field">
          <span>Print clearance</span>
          <div className="field-row">
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
          </div>
        </label>

        <div className="field">
          <span>Color names (for export files)</span>
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
              onClick={() => addPaletteColor()}
            >
              +
            </button>
          </div>
          <input
            type="text"
            value={activeColor.name}
            placeholder="Color name"
            onChange={(e) =>
              updatePaletteColor(activeColor.id, { name: e.target.value })
            }
          />
          <div className="field-row">
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
            />
            <input
              type="text"
              value={activeColor.hex}
              onChange={(e) =>
                updatePaletteColor(activeColor.id, { hex: e.target.value })
              }
            />
            <button
              type="button"
              className="danger"
              disabled={palette.length <= 1}
              onClick={() => removePaletteColor(activeColor.id)}
            >
              Remove
            </button>
          </div>
        </div>

        {!insertsOnly && structural.size > 0 && (
          <p className="hint-line">
            Fused bottom: {countSelectionIslands(structural, model!.adjacency)}{' '}
            region{countSelectionIslands(structural, model!.adjacency) === 1 ? '' : 's'}
          </p>
        )}
      </CollapsibleSection>
    </aside>
  )
}
