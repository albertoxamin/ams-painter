import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import * as THREE from 'three'
import {
  useStore,
  resolveIslandMeta,
  paletteColor,
} from '../state'
import {
  downloadSTL,
  downloadInsertsZip,
  downloadAllPartsZip,
  prepareForPrint,
} from '../lib/exportSTL'
import {
  assignBambuExtruders,
  buildBambu3mf,
  colorIdsOnResultMesh,
  concatGeometries,
} from '../lib/bambuPaint'
import {
  facesInsideProjectedLoop,
  loopSpan,
  loopToVectors,
} from '../lib/penCutout'
import {
  buildSelectionSnapshot,
  downloadSelectionSnapshot,
  downloadProjectFile,
  parseProjectFile,
  validateSnapshotForModel,
  MESH_TRI_WARN,
} from '../lib/selectionSnapshot'
import { tryRestoreAutosave } from '../lib/restoreAutosave'
import { loadEditorFile } from '../lib/loadEditorFile'
import {
  applyMeshBoolean,
  centerGeometryOn,
  primitiveGeometry,
  selectionCentroid,
  stlBufferToGeometry,
  type MeshBooleanOp,
} from '../lib/meshEdit'
import { countSelectionIslands, listSelectionIslands } from '../lib/select'
import { awaitPreparedParts } from '../features/painter/prepare/usePreparedParts'
import {
  CUT_AXES,
  AXIS_COLORS,
  axisBounds,
  axisLetter,
  type CutAxis,
  type InsertRole,
  type PaletteColor,
} from '../lib/extrude'
import CollapsibleSection from './layout/CollapsibleSection'

function InsertInspector({
  colorId,
  axis,
  floor,
  bounds,
  palette,
  onColor,
  onAxis,
  onFloorStart,
  onFloor,
  role,
  splitEnabled,
  onRole,
  extra,
}: {
  colorId: string
  axis: CutAxis
  floor: number
  bounds: { min: number; max: number }
  palette: PaletteColor[]
  onColor: (id: string) => void
  onAxis: (axis: CutAxis) => void
  onFloorStart: () => void
  onFloor: (floor: number) => void
  role: InsertRole
  splitEnabled: boolean
  onRole: (role: InsertRole) => void
  extra?: ReactNode
}) {
  const span = Math.max(bounds.max - bounds.min, 0.2)
  const lo = bounds.min
  const hi = bounds.min + span
  const depth = Math.min(hi, Math.max(lo, floor))
  return (
    <div className="insert-inspector">
      <div className="bpy-prop-row bpy-prop-colors">
        <span className="bpy-prop-label">Color</span>
        <div className="tool-swatches">
          {palette.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`swatch${colorId === c.id ? ' active' : ''}`}
              title={c.name}
              style={{ background: c.hex }}
              onClick={() => onColor(c.id)}
            />
          ))}
        </div>
      </div>
      <div className="bpy-prop-row">
        <span className="bpy-prop-label">Kind</span>
        <div className="bpy-prop-buttons insert-kind">
          {(
            [
              ['paint', 'Painted only'],
              ['insert', 'Insert'],
              ['bottom', 'Bottom fused'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={role === id ? 'active' : ''}
              disabled={id === 'bottom' && !splitEnabled}
              title={
                id === 'bottom' && !splitEnabled
                  ? 'Only in the Split workflow'
                  : label
              }
              onClick={() => onRole(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {role === 'paint' && (
        <p className="hint-line">
          Other inserts still cut holes. This region is painted on the mesh that remains.
        </p>
      )}
      {role !== 'paint' && (
      <>
      <div className="field">
        <span>Direction</span>
        <div className="modes axes">
          {CUT_AXES.map((a) => {
            const tint = AXIS_COLORS[axisLetter(a.id)]
            return (
              <button
                key={a.id}
                type="button"
                className={axis === a.id ? 'active axis-tint' : 'axis-tint'}
                title={a.title}
                style={{ '--axis-tint': tint, color: tint } as CSSProperties}
                onClick={() => onAxis(a.id)}
              >
                {a.label}
              </button>
            )
          })}
        </div>
      </div>
      <label className="field">
        <span>Depth ({axis})</span>
        <div className="field-row">
          <input
            type="range"
            min={lo}
            max={hi}
            step={0.1}
            value={depth}
            onPointerDown={onFloorStart}
            onChange={(e) => onFloor(parseFloat(e.target.value))}
          />
          <input
            type="number"
            min={lo}
            max={hi}
            step={0.1}
            value={Number(depth.toFixed(1))}
            onFocus={onFloorStart}
            onChange={(e) => onFloor(parseFloat(e.target.value) || lo)}
          />
        </div>
      </label>
      </>
      )}
      {extra}
    </div>
  )
}

function MeshBooleanSection() {
  const model = useStore((s) => s.model)
  const editCount = useStore((s) => s.editFaces.size)
  const busy = useStore((s) => s.busy)
  const setBusy = useStore((s) => s.setBusy)
  const setError = useStore((s) => s.setError)
  const replaceEditedGeometry = useStore((s) => s.replaceEditedGeometry)
  const [op, setOp] = useState<MeshBooleanOp>('subtract')
  const [shape, setShape] = useState<'box' | 'sphere'>('box')
  const [size, setSize] = useState(10)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (stl?: ArrayBuffer) => {
    const s = useStore.getState()
    if (!s.model) return
    setBusy(true)
    setError(null)
    try {
      const geom = s.model.geometry
      geom.computeBoundingBox()
      const center =
        s.editFaces.size > 0
          ? selectionCentroid(geom, s.editFaces)
          : geom.boundingBox!.getCenter(new THREE.Vector3())
      const cutter = stl
        ? centerGeometryOn(stlBufferToGeometry(stl), center)
        : primitiveGeometry(shape, center, size)
      replaceEditedGeometry(await applyMeshBoolean(geom, cutter, op))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Boolean failed')
    } finally {
      setBusy(false)
    }
  }

  if (!model) return null

  return (
    <CollapsibleSection title="Mesh edit">
      <p className="empty-state">
        Applied to the base mesh before insert cuts.
        {editCount > 0
          ? ' Cutter sits on the yellow face selection.'
          : ' Cutter sits on the mesh center.'}{' '}
        Face inserts are cleared. Pen outlines stay.
      </p>
      <div className="bpy-prop-row">
        <span className="bpy-prop-label">Op</span>
        <div className="bpy-prop-buttons">
          {(['subtract', 'union', 'intersect'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={op === id ? 'active' : ''}
              onClick={() => setOp(id)}
            >
              {id === 'subtract' ? 'Subtract' : id === 'union' ? 'Union' : 'Intersect'}
            </button>
          ))}
        </div>
      </div>
      <div className="bpy-prop-row">
        <span className="bpy-prop-label">Shape</span>
        <div className="bpy-prop-buttons">
          <button
            type="button"
            className={shape === 'box' ? 'active' : ''}
            onClick={() => setShape('box')}
          >
            Box
          </button>
          <button
            type="button"
            className={shape === 'sphere' ? 'active' : ''}
            onClick={() => setShape('sphere')}
          >
            Sphere
          </button>
        </div>
      </div>
      <label className="bpy-prop-row bpy-prop-slider">
        <span className="bpy-prop-label">Size</span>
        <input
          type="range"
          min={1}
          max={80}
          step={1}
          value={size}
          onChange={(e) => setSize(parseFloat(e.target.value))}
        />
        <span className="bpy-prop-value">{size.toFixed(0)}</span>
      </label>
      <div className="bpy-prop-buttons">
        <button type="button" disabled={busy} onClick={() => void run()}>
          Apply
        </button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          STL…
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".stl"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          void file.arrayBuffer().then((buf) => run(buf))
        }}
      />
    </CollapsibleSection>
  )
}

export default function SidePanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const markingsRef = useRef<HTMLInputElement>(null)

  const model = useStore((s) => s.model)
  const splitHeight = useStore((s) => s.splitHeight)
  const setSplitHeight = useStore((s) => s.setSplitHeight)
  const splitMode = useStore((s) => s.splitMode)
  const setSplitMode = useStore((s) => s.setSplitMode)
  const splitLockAxis = useStore((s) => s.splitLockAxis)
  const setSplitLockAxis = useStore((s) => s.setSplitLockAxis)
  const splitSpline = useStore((s) => s.splitSpline)
  const setSplitSpline = useStore((s) => s.setSplitSpline)
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
  const selectPenCutout = useStore((s) => s.selectPenCutout)
  const removePenCutout = useStore((s) => s.removePenCutout)
  const flattenPenCutout = useStore((s) => s.flattenPenCutout)
  const applyColorToPenCutout = useStore((s) => s.applyColorToPenCutout)
  const applyAxisToIsland = useStore((s) => s.applyAxisToIsland)
  const applyDepthsToIsland = useStore((s) => s.applyDepthsToIsland)
  const applyAxisToPenCutout = useStore((s) => s.applyAxisToPenCutout)
  const applyDepthsToPenCutout = useStore((s) => s.applyDepthsToPenCutout)
  const applyRoleToIsland = useStore((s) => s.applyRoleToIsland)
  const applyRoleToPenCutout = useStore((s) => s.applyRoleToPenCutout)
  const beginStroke = useStore((s) => s.beginStroke)
  const removeDropInFaces = useStore((s) => s.removeDropInFaces)

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
        if (useStore.getState().preview) return
        e.preventDefault()
        setPaintTool('brush')
        return
      }
      if (key === 'p') {
        if (useStore.getState().preview) return
        e.preventDefault()
        setPaintTool('pen')
        return
      }
      if (key === 'g') {
        if (useStore.getState().preview) return
        e.preventDefault()
        setPaintTool('flood')
        return
      }
      if (key === 'c') {
        if (useStore.getState().preview) return
        e.preventDefault()
        setPaintTool('box')
        return
      }
      if (key === 'v') {
        if (useStore.getState().preview) return
        e.preventDefault()
        setPaintTool('move')
        return
      }
      if (key === 'n') {
        if (useStore.getState().preview) return
        e.preventDefault()
        const s = useStore.getState()
        if (!s.insertsOnly) {
          s.setSplitMode('spline')
          setPaintTool('splitLine')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, invertSelection, setBrushColor, setCutAxis, setBrushRadius, setPaintTool])

  const onFile = async (file: File) => {
    try {
      const loaded = await loadEditorFile(file)
      setModel(loaded.model)
      if (loaded.snapshot) {
        restoreSelectionSnapshot(loaded.snapshot)
        setError(null)
        return
      }
      if (loaded.model.count > MESH_TRI_WARN) {
        setError(
          `Large mesh (${loaded.model.count.toLocaleString()} tris). Consider simplifying in Repair tab first.`,
        )
      } else {
        setError(null)
      }
      await tryRestoreAutosave(loaded.model, restoreSelectionSnapshot)
    } catch (e) {
      setError((e as Error).message || 'Failed to load file')
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
      const colorNames = parts.dropInColorIds.map(
        (id) => paletteColor(palette, id).name,
      )
      const snap = buildSelectionSnapshot({
        model,
        insertsOnly,
        splitHeight,
        splitMode,
        splitLockAxis,
        splitSpline,
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
      const sourceFaceColor = new Map<number, string>()
      for (const island of dropInIslands) {
        const m = resolveIslandMeta(island, dropInMeta, brushMeta)
        if (m.role !== 'paint') continue
        for (const face of island) sourceFaceColor.set(face, m.colorId)
      }
      for (const cutout of penCutouts) {
        if (cutout.meta.role !== 'paint') continue
        const loop = loopToVectors(cutout.loop)
        const span = loopSpan(loop, axisLetter(cutout.meta.axis))
        // ponytail: paints the surface band under the loop (±1 mm), not the extruded pocket.
        const faces = facesInsideProjectedLoop(
          model.geometry,
          loop,
          cutout.meta.axis,
          span.min - 1,
          span.max + 1,
        )
        for (const face of faces) {
          if (!sourceFaceColor.has(face)) {
            sourceFaceColor.set(face, cutout.meta.colorId)
          }
        }
      }
      const printBottom = prepareForPrint(parts.bottom)
      const printUpper = parts.upper
        ? prepareForPrint(parts.upper, { dropFloating: true })
        : null
      const printInserts = parts.dropIns.map((geom) => prepareForPrint(geom))
      const paintedGeoms = [printBottom, printUpper].filter(
        (g): g is NonNullable<typeof g> => g != null,
      )
      const resultColors = paintedGeoms.flatMap((geom) =>
        colorIdsOnResultMesh(geom, model.bvh, sourceFaceColor),
      )
      const resultGeom = concatGeometries(paintedGeoms)
      const paintGroups = new Map<string, number[]>()
      resultColors.forEach((id, face) => {
        if (!id) return
        const list = paintGroups.get(id)
        if (list) list.push(face)
        else paintGroups.set(id, [face])
      })
      const bambu = assignBambuExtruders({
        triCount: resultColors.length,
        palette,
        regions: [...paintGroups.entries()].map(([colorId, faces]) => ({
          colorId,
          faces,
        })),
      })
      const filaments = bambu.filaments.map((f) => ({ ...f }))
      const slotByColorId = new Map<string, number>()
      for (let i = 1; i < filaments.length; i++) {
        const match = palette.find(
          (c) =>
            c.name === filaments[i]!.name &&
            c.hex.toUpperCase() === filaments[i]!.hex.toUpperCase(),
        )
        if (match) slotByColorId.set(match.id, i + 1)
      }
      for (const id of parts.dropInColorIds) {
        if (slotByColorId.has(id)) continue
        const color = paletteColor(palette, id)
        filaments.push({ name: color.name, hex: color.hex })
        slotByColorId.set(id, filaments.length)
      }
      downloadAllPartsZip({
        baseName: model.name,
        bottom: parts.bottom,
        upper: parts.upper,
        dropIns: parts.dropIns,
        dropInNames: colorNames,
        insertsOnly: parts.insertsOnly,
        snapshot: snap,
        originalStl: new Uint8Array(model.sourceStl),
        bambu3mf: buildBambu3mf({
          filaments,
          objects: [
            {
              name: model.name,
              geometry: resultGeom,
              faceExtruder: bambu.faceExtruder,
              extruder: 1,
              plate: 1,
            },
            ...printInserts.map((geometry, i) => ({
              name: colorNames[i] || `Insert ${i + 1}`,
              geometry,
              extruder: slotByColorId.get(parts.dropInColorIds[i] ?? '') ?? 1,
              plate: 2,
            })),
          ],
        }),
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
      splitMode,
      splitLockAxis,
      splitSpline,
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
      splitMode,
      splitLockAxis,
      splitSpline,
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
      splitMode,
      splitLockAxis,
      splitSpline,
    })
    if (!prepared) return null
    return {
      bottom: prepared.lower,
      upper: prepared.upper,
      dropIns: prepared.dropIns,
      dropInColorIds: prepared.dropInColorIds,
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
        downloadSTL(parts.upper, `${base}_upper.stl`, { dropFloating: true })
      } else {
        if (parts.dropIns.length === 0) {
          setError('No inserts marked yet')
          return
        }
        const colorNames = parts.dropInColorIds.map(
          (id) => paletteColor(palette, id).name,
        )
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
        accept=".stl,.zip,application/zip"
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

      <MeshBooleanSection />

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
                  <div className={`feature-row-wrap${active ? ' active' : ''}`}>
                    <button
                      type="button"
                      className={`feature-row${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) {
                          setActiveIsland(-1)
                          return
                        }
                        setActiveIsland(i)
                        setCutAxis(m.axis)
                        setDropInFloorZ(m.floor)
                        setBrushColor(m.colorId)
                      }}
                    >
                      <span className="feature-chip" style={{ background: col.hex }} />
                      <span className="feature-body">
                        <strong>{col.name}</strong>
                        <span>
                          {m.role === 'paint'
                            ? 'Painted only'
                            : m.role === 'bottom'
                              ? 'Bottom fused'
                              : 'Insert'}{' '}
                          · {m.axis} · {m.floor.toFixed(1)} mm
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="feature-delete"
                      title="Delete insert"
                      aria-label="Delete insert"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeDropInFaces(island)
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {active && model && (
                    <InsertInspector
                      colorId={m.colorId}
                      axis={m.axis}
                      floor={m.floor}
                      bounds={axisBounds(model, m.axis)}
                      palette={palette}
                      onColor={(id) => {
                        setBrushColor(id)
                        applyBrushToIslands([island])
                      }}
                      onAxis={(axis) => applyAxisToIsland(island, axis)}
                      onFloorStart={beginStroke}
                      onFloor={(floor) =>
                        applyDepthsToIsland(island, { floor })
                      }
                      role={m.role ?? 'insert'}
                      splitEnabled={!insertsOnly}
                      onRole={(role) => applyRoleToIsland(island, role)}
                    />
                  )}
                </li>
              )
            })}
            {penCutouts.map((cutout, i) => {
              const col = paletteColor(palette, cutout.meta.colorId)
              const active = activePenIndex === i
              return (
                <li key={cutout.id}>
                  <div className={`feature-row-wrap${active ? ' active' : ''}`}>
                    <button
                      type="button"
                      className={`feature-row${active ? ' active' : ''}`}
                      onClick={() => {
                        if (active) setActivePenIndex(-1)
                        else selectPenCutout(i)
                      }}
                    >
                      <span className="feature-chip" style={{ background: col.hex }} />
                      <span className="feature-body">
                        <strong>{col.name}</strong>
                        <span>
                          Pen ·{' '}
                          {cutout.meta.role === 'paint'
                            ? 'Painted only'
                            : cutout.meta.role === 'bottom'
                              ? 'Bottom fused'
                              : 'Insert'}{' '}
                          · {cutout.meta.axis}
                          {cutout.flat ? ' · flat' : ''}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="feature-delete"
                      title="Delete insert"
                      aria-label="Delete insert"
                      onClick={(e) => {
                        e.stopPropagation()
                        removePenCutout(cutout.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {active && model && (
                    <InsertInspector
                      colorId={cutout.meta.colorId}
                      axis={cutout.meta.axis}
                      floor={cutout.meta.floor}
                      bounds={axisBounds(model, cutout.meta.axis)}
                      palette={palette}
                      onColor={(id) => applyColorToPenCutout(cutout.id, id)}
                      onAxis={(axis) => applyAxisToPenCutout(cutout.id, axis)}
                      onFloorStart={beginStroke}
                      onFloor={(floor) =>
                        applyDepthsToPenCutout(cutout.id, { floor })
                      }
                      role={cutout.meta.role ?? 'insert'}
                      splitEnabled={!insertsOnly}
                      onRole={(role) => applyRoleToPenCutout(cutout.id, role)}
                      extra={
                        <>
                          <button
                            type="button"
                            className="block feature-flat"
                            onClick={() => flattenPenCutout(cutout.id)}
                          >
                            Make it flat
                          </button>
                          <p className="hint-line">
                            Drag points · click an edge to add · Alt-click a point to delete
                          </p>
                        </>
                      }
                    />
                  )}
                </li>
              )
            })}
          </ul>
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
          <p className="hint-line">
            Zip includes a Bambu Studio 3MF. Each painted color is its own filament.
          </p>
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
          {insertsOnly && (
            <button
              className="primary"
              onClick={() => doExport('dropIns')}
              disabled={!model || busy || insertCount === 0}
            >
              Insert pieces (.zip)
            </button>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
      </CollapsibleSection>

      <CollapsibleSection title="Advanced" defaultOpen={false}>
        {model && !insertsOnly && (
          <>
            <div className="bpy-prop-row">
              <span className="bpy-prop-label">Split method</span>
              <div className="bpy-prop-buttons">
                <button
                  type="button"
                  className={splitMode === 'height' ? 'active' : ''}
                  onClick={() => setSplitMode('height')}
                >
                  Height
                </button>
                <button
                  type="button"
                  className={splitMode === 'spline' ? 'active' : ''}
                  onClick={() => {
                    setSplitMode('spline')
                    setPaintTool('splitLine')
                  }}
                >
                  Spline
                </button>
              </div>
            </div>
            {splitMode === 'height' && (
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
            {splitMode === 'spline' && (
              <>
                <div className="bpy-prop-row">
                  <span className="bpy-prop-label">Lock axis</span>
                  <div className="bpy-prop-buttons">
                    {(['x', 'y', 'z'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={splitLockAxis === a ? 'active' : ''}
                        onClick={() => setSplitLockAxis(a)}
                      >
                        {a.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="tool-shelf-hint">
                  {splitSpline.length} point{splitSpline.length === 1 ? '' : 's'}
                  {splitSpline.some((p) => p.in || p.out) ? ' · Bézier' : ''} ·
                  draw-plane faces are in the tool shelf
                </p>
                <button
                  type="button"
                  className="block subtle"
                  disabled={splitSpline.length === 0}
                  onClick={() => setSplitSpline([])}
                >
                  Clear split line
                </button>
              </>
            )}
          </>
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
