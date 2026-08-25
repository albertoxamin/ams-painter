import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import {
  useStore,
  resolveIslandMeta,
  paletteColor,
} from '../../../state'
import { facesNearPoint } from '../../../lib/brush'
import { listSelectionIslands } from '../../../lib/select'
import {
  loopToVectors,
  penCutoutCentroid,
} from '../../../lib/penCutout'
import {
  isDepthHandleDragging,
  pointerNearDepthHandle,
} from '../interaction/depthHandlePick'
import { COLORS } from './constants'
import {
  pickHit,
  anyHitIsGizmo,
  islandCentroid,
  modelDiagonal,
  lightenHex,
} from './pick'
import { AxisGizmo } from './gizmos/AxisGizmo'
import { DepthHandles } from './gizmos/DepthHandles'
import { BrushCursor } from './overlays/BrushCursor'
import { HoverOutline } from './overlays/HoverOutline'
import { InsertEspOutline } from './overlays/InsertEspOutline'
import { PenCursorRing } from './overlays/PenCursorRing'
import { PenEspOutline } from './overlays/PenEspOutline'
import { PenLoopOverlay } from './overlays/PenLoopOverlay'
import { PenLoopEditor } from './overlays/PenLoopEditor'
import { SelectionOverlay } from './overlays/SelectionOverlay'
import { SplitCutOutline } from './overlays/SplitCutOutline'
import { useInteraction } from '../interaction/InteractionContext'
import { SplitPreview } from './SplitPreview'

function disableRaycast() {}

function commitIslandSelection(idx: number) {
  const s = useStore.getState()
  if (!s.model || idx < 0) return
  const islands = listSelectionIslands(s.dropIn, s.model.adjacency)
  const island = islands[idx]
  if (!island) return
  s.setActiveIsland(idx)
  const m = resolveIslandMeta(island, s.dropInMeta, {
    axis: s.cutAxis,
    floor: s.dropInFloorZ,
    colorId: s.brushColorId,
  })
  s.setCutAxis(m.axis)
  s.setDropInFloorZ(m.floor)
  s.setBrushColor(m.colorId)
}

export function ModelMesh() {
  const model = useStore((s) => s.model)
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
  const palette = useStore((s) => s.palette)
  const brushColorId = useStore((s) => s.brushColorId)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const mode = useStore((s) => s.mode)
  const brushRadius = useStore((s) => s.brushRadius)
  const splitHeight = useStore((s) => s.splitHeight)
  const splitMode = useStore((s) => s.splitMode)
  const preview = useStore((s) => s.preview)
  const esp = useStore((s) => s.esp)
  const activeIsland = useStore((s) => s.activeIsland)
  const setActiveIsland = useStore((s) => s.setActiveIsland)
  const applyAxisToIsland = useStore((s) => s.applyAxisToIsland)
  const applyDepthsToIsland = useStore((s) => s.applyDepthsToIsland)
  const paintTool = useStore((s) => s.paintTool)
  const penCutouts = useStore((s) => s.penCutouts)
  const addPenCutout = useStore((s) => s.addPenCutout)
  const activePenIndex = useStore((s) => s.activePenIndex)
  const setActivePenIndex = useStore((s) => s.setActivePenIndex)
  const applyAxisToPenCutout = useStore((s) => s.applyAxisToPenCutout)
  const applyDepthsToPenCutout = useStore((s) => s.applyDepthsToPenCutout)
  const setPenCutoutLoop = useStore((s) => s.setPenCutoutLoop)
  const setBusy = useStore((s) => s.setBusy)
  const setError = useStore((s) => s.setError)
  const beginStroke = useStore((s) => s.beginStroke)
  const paintFaces = useStore((s) => s.paintFaces)
  const floodPaintAt = useStore((s) => s.floodPaintAt)
  const selectLinkedAt = useStore((s) => s.selectLinkedAt)
  const busy = useStore((s) => s.busy)
  const { setIsPainting: setGlobalPainting } = useInteraction()
  const meshRef = useRef<THREE.Mesh>(null)
  const painting = useRef(false)
  const gizmoHit = useRef(false)
  const downPoint = useRef<THREE.Vector2 | null>(null)
  const lastPaintPoint = useRef<THREE.Vector3 | null>(null)
  const pendingIsland = useRef(-1)
  const lastHitIdx = useRef<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [penDraft, setPenDraft] = useState<THREE.Vector3[]>([])
  const [penCursor, setPenCursor] = useState<THREE.Vector3 | null>(null)
  const { controls, gl, camera } = useThree()

  const dropInIslands = useMemo(
    () => (model ? listSelectionIslands(dropIn, model.adjacency) : []),
    [model, dropIn],
  )

  const cutAxis = useStore((s) => s.cutAxis)
  const dropInFloorZ = useStore((s) => s.dropInFloorZ)
  const brushFallback = useMemo(
    () => ({
      axis: cutAxis,
      floor: dropInFloorZ,
      colorId: brushColorId,
    }),
    [cutAxis, dropInFloorZ, brushColorId],
  )

  // Track painting in state so the axis gizmo unmounts during strokes
  const [isPainting, setIsPainting] = useState(false)
  const setPainting = (v: boolean) => {
    painting.current = v
    setIsPainting(v)
    setGlobalPainting(v)
  }

  const gizmoIslandIdx =
    isPainting || paintTool === 'pen'
      ? -1
      : activeIsland >= 0 && activeIsland < dropInIslands.length
        ? activeIsland
        : -1

  const gizmoPenIdx =
    isPainting || paintTool !== 'pen' || penDraft.length > 0
      ? -1
      : activePenIndex >= 0 && activePenIndex < penCutouts.length
        ? activePenIndex
        : -1

  const closePenDraft = () => {
    if (penDraft.length >= 3) {
      addPenCutout(
        penDraft.map(
          (p) => [p.x, p.y, p.z] as [number, number, number],
        ),
      )
    }
    setPenDraft([])
    setPenCursor(null)
  }

  useEffect(() => {
    if (paintTool !== 'pen' || preview) {
      if (paintTool !== 'pen') {
        setPenDraft([])
        setPenCursor(null)
      }
      return
    }
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
      if (e.key === 'Enter') {
        e.preventDefault()
        setPenDraft((d) => {
          if (d.length >= 3) {
            addPenCutout(
              d.map(
                (p) => [p.x, p.y, p.z] as [number, number, number],
              ),
            )
          }
          return []
        })
        setPenCursor(null)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setPenDraft([])
        setPenCursor(null)
      } else if (e.key === 'Backspace' && penDraft.length > 0) {
        e.preventDefault()
        setPenDraft((d) => d.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paintTool, preview, penDraft.length, addPenCutout, hoverIdx, selectLinkedAt])

  useEffect(() => {
    if (preview) return
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
      if (e.key.toLowerCase() === 'l' && hoverIdx != null) {
        e.preventDefault()
        selectLinkedAt(hoverIdx)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, hoverIdx, selectLinkedAt])

  const paintAt = (e: ThreeEvent<PointerEvent>) => {
    if (!model || !meshRef.current) return
    const hit = pickHit(e, meshRef.current, model.count)
    if (!hit) return
    lastHitIdx.current = hit.idx
    setHoverIdx(hit.idx)
    if (
      lastPaintPoint.current &&
      lastPaintPoint.current.distanceToSquared(hit.point) <
        (brushRadius * 0.2) ** 2
    ) {
      return
    }
    lastPaintPoint.current = hit.point.clone()
    const faces =
      brushRadius <= 0.05
        ? [hit.idx]
        : facesNearPoint(model.geometry, hit.point, brushRadius)
    paintFaces(
      faces.length > 0 ? faces : [hit.idx],
      e.nativeEvent.shiftKey ? 'remove' : mode,
    )
  }

  const restoreOrbit = () => {
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = true
    }
  }

  const endPaint = () => {
    if (!painting.current) return
    setPainting(false)
    lastPaintPoint.current = null
    restoreOrbit()
  }

  const beginBrushStroke = (e: ThreeEvent<PointerEvent>) => {
    setPainting(true)
    lastPaintPoint.current = null
    setActiveIsland(-1)
    beginStroke()
    paintAt(e)
  }

  useEffect(() => {
    if (!preview) return
    pendingIsland.current = -1
    downPoint.current = null
    gizmoHit.current = false
    endPaint()
    restoreOrbit()
    // preview toggle: drop any in-progress stroke and restore picking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  useEffect(() => {
    const up = (e: PointerEvent) => {
      if (
        pendingIsland.current >= 0 &&
        !painting.current &&
        downPoint.current
      ) {
        const dx = e.clientX - downPoint.current.x
        const dy = e.clientY - downPoint.current.y
        if (dx * dx + dy * dy < 16) {
          commitIslandSelection(pendingIsland.current)
        }
      } else if (
        painting.current &&
        downPoint.current &&
        lastHitIdx.current != null
      ) {
        const dx = e.clientX - downPoint.current.x
        const dy = e.clientY - downPoint.current.y
        if (dx * dx + dy * dy < 16) {
          const s = useStore.getState()
          if (s.model) {
            const islands = listSelectionIslands(s.dropIn, s.model.adjacency)
            const idx = islands.findIndex((isl) =>
              isl.has(lastHitIdx.current!),
            )
            if (idx >= 0) commitIslandSelection(idx)
          }
        }
      }
      pendingIsland.current = -1
      downPoint.current = null
      endPaint()
      restoreOrbit()
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [controls])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!model || busy || preview || e.button !== 0) return
    if (
      isDepthHandleDragging() ||
      pointerNearDepthHandle(
        e.nativeEvent.clientX,
        e.nativeEvent.clientY,
        camera,
        gl.domElement,
      )
    ) {
      return
    }
    if (gizmoHit.current || anyHitIsGizmo(e)) {
      e.stopPropagation()
      return
    }

    if (paintTool === 'pen') {
      e.stopPropagation()
      if (!meshRef.current) return
      const hit = pickHit(e, meshRef.current, model.count)
      if (!hit) return
      const minD = Math.max(0.15, brushRadius * 0.35)
      if (
        penDraft.length > 0 &&
        penDraft[penDraft.length - 1]!.distanceToSquared(hit.point) <
          minD * minD
      ) {
        if (e.detail >= 2 && penDraft.length >= 3) closePenDraft()
        return
      }
      setPenDraft((d) => [...d, hit.point.clone()])
      setActiveIsland(-1)
      setActivePenIndex(-1)
      return
    }

    if (paintTool === 'splitLine') {
      return
    }

    if (paintTool === 'flood') {
      e.stopPropagation()
      if (!meshRef.current) return
      const hit = pickHit(e, meshRef.current, model.count)
      if (!hit) return
      floodPaintAt(hit.idx, e.nativeEvent.shiftKey ? 'remove' : mode)
      return
    }

    if (paintTool === 'box') {
      // Box select is handled by BoxSelectLayer over the full viewport.
      return
    }

    e.stopPropagation()
    downPoint.current = new THREE.Vector2(
      e.nativeEvent.clientX,
      e.nativeEvent.clientY,
    )
    pendingIsland.current = -1
    if (meshRef.current) {
      const hit = pickHit(e, meshRef.current, model.count)
      if (hit && dropIn.has(hit.idx) && !e.nativeEvent.shiftKey) {
        const idx = dropInIslands.findIndex((isl) => isl.has(hit.idx))
        if (idx >= 0) pendingIsland.current = idx
      }
    }
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = false
    }
    try {
      gl.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    // Clicking an existing region selects it; drag (or empty mesh) paints.
    if (pendingIsland.current >= 0) return
    beginBrushStroke(e)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (
      !model ||
      !meshRef.current ||
      busy ||
      preview ||
      isDepthHandleDragging()
    ) {
      return
    }

    if (paintTool === 'pen' && !painting.current) {
      if (gizmoHit.current || anyHitIsGizmo(e)) return
      const hit = pickHit(e, meshRef.current, model.count)
      setPenCursor(hit?.point ?? null)
      if (hit) setHoverIdx(hit.idx)
      return
    }
    if (
      !painting.current &&
      downPoint.current &&
      pendingIsland.current >= 0
    ) {
      const dx = e.nativeEvent.clientX - downPoint.current.x
      const dy = e.nativeEvent.clientY - downPoint.current.y
      if (dx * dx + dy * dy >= 16) {
        pendingIsland.current = -1
        beginBrushStroke(e)
      }
      return
    }
    if (painting.current) {
      e.stopPropagation()
      paintAt(e)
      return
    }
    // Don't clear island hover while the pointer is on a gizmo
    if (gizmoHit.current || anyHitIsGizmo(e)) return

    const hit = pickHit(e, meshRef.current, model.count)
    setHoverIdx(hit?.idx ?? null)
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    try {
      gl.domElement.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onPointerOut = () => {
    if (preview) return
    if (!painting.current) setHoverIdx(null)
  }

  if (!model) return null

  // Preview explode replaces the source. Do not keep a ghost copy — opacity 0
  // still draws the original mesh in the middle of the split.
  const showSource = !preview
  const diag = modelDiagonal(model.geometry)
  const penActive = paintTool === 'pen'

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={model.geometry}
        visible={showSource}
        // Hidden meshes still raycast by default — block picks in preview.
        raycast={showSource ? THREE.Mesh.prototype.raycast : disableRaycast}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOut={onPointerOut}
        castShadow={showSource}
        receiveShadow={showSource}
      >
        <meshStandardMaterial
          color={'#b8c0d0'}
          metalness={0.1}
          roughness={0.75}
          flatShading
          side={THREE.FrontSide}
        />
      </mesh>

      {showSource && (
        <>
          <HoverOutline
            geom={model.geometry}
            faceIndex={hoverIdx}
            brushRadius={brushRadius}
            hitPoint={null}
          />
          <BrushCursor
            geom={model.geometry}
            faceIndex={paintTool === 'pen' ? null : hoverIdx}
            brushRadius={brushRadius}
          />
          <SelectionOverlay
            geom={model.geometry}
            selection={structural}
            faceColor={COLORS.selected}
            outlineColor={COLORS.outline}
          />
          {dropInIslands.map((island, i) => {
            const m = resolveIslandMeta(island, dropInMeta, {
              ...brushFallback,
              colorId: brushColorId,
            })
            const col = paletteColor(palette, m.colorId)
            return (
              <SelectionOverlay
                key={`drop-${i}-${col.id}`}
                geom={model.geometry}
                selection={island}
                faceColor={col.hex}
                outlineColor={lightenHex(col.hex)}
              />
            )
          })}
          {esp &&
            dropInIslands.map((island, i) => {
              const m = resolveIslandMeta(island, dropInMeta, {
                ...brushFallback,
                colorId: brushColorId,
              })
              const col = paletteColor(palette, m.colorId)
              return (
                <InsertEspOutline
                  key={`esp-${i}-${m.axis}-${m.floor.toFixed(2)}-${(m.entry ?? 0).toFixed(2)}-${col.id}`}
                  geom={model.geometry}
                  selection={island}
                  axis={m.axis}
                  floor={m.floor}
                  entry={m.entry}
                  color={col.hex}
                />
              )
            })}
          {!insertsOnly && splitMode === 'height' && (
            <SplitCutOutline geom={model.geometry} height={splitHeight} />
          )}
        </>
      )}
      {showSource && gizmoIslandIdx >= 0 && dropInIslands[gizmoIslandIdx] && (
        <>
          <AxisGizmo
            center={islandCentroid(
              model.geometry,
              dropInIslands[gizmoIslandIdx]!,
            )}
            size={diag * 0.07}
            activeAxis={
              resolveIslandMeta(
                dropInIslands[gizmoIslandIdx]!,
                dropInMeta,
                { ...brushFallback, colorId: brushColorId },
              ).axis
            }
            onPick={(axis) => {
              applyAxisToIsland(dropInIslands[gizmoIslandIdx]!, axis)
              setActiveIsland(gizmoIslandIdx)
            }}
          />
          <DepthHandles
            geom={model.geometry}
            faces={dropInIslands[gizmoIslandIdx]!}
            meta={resolveIslandMeta(
              dropInIslands[gizmoIslandIdx]!,
              dropInMeta,
              { ...brushFallback, colorId: brushColorId },
            )}
            size={diag * 0.07}
            onHover={(v) => {
              gizmoHit.current = v
            }}
            onDragStart={() => {
              if (painting.current) endPaint()
              gizmoHit.current = true
              beginStroke()
              setActiveIsland(gizmoIslandIdx)
              if (controls && 'enabled' in controls) {
                ;(controls as { enabled: boolean }).enabled = false
              }
            }}
            onDragEnd={() => {
              gizmoHit.current = false
              if (controls && 'enabled' in controls) {
                ;(controls as { enabled: boolean }).enabled = true
              }
            }}
            onChange={(patch) => {
              applyDepthsToIsland(dropInIslands[gizmoIslandIdx]!, patch)
            }}
          />
        </>
      )}
      {showSource &&
        penCutouts.map((cutout, i) => {
          const col = paletteColor(palette, cutout.meta.colorId)
          const pts = loopToVectors(cutout.loop)
          if (gizmoPenIdx === i) {
            return (
              <group key={cutout.id}>
                <PenLoopOverlay loop={pts} color={col.hex} closed />
                <PenLoopEditor
                  loop={pts}
                  axis={cutout.meta.axis}
                  color={col.hex}
                  size={diag * 0.07}
                  onHover={(v) => {
                    gizmoHit.current = v
                  }}
                  onDragStart={() => {
                    if (painting.current) endPaint()
                    gizmoHit.current = true
                    beginStroke()
                    setActivePenIndex(i)
                    if (controls && 'enabled' in controls) {
                      ;(controls as { enabled: boolean }).enabled = false
                    }
                  }}
                  onDragEnd={() => {
                    gizmoHit.current = false
                    if (controls && 'enabled' in controls) {
                      ;(controls as { enabled: boolean }).enabled = true
                    }
                  }}
                  onChange={(next) => {
                    setPenCutoutLoop(
                      cutout.id,
                      next.map(
                        (p) =>
                          [p.x, p.y, p.z] as [number, number, number],
                      ),
                    )
                  }}
                />
              </group>
            )
          }
          return (
            <PenLoopOverlay
              key={cutout.id}
              loop={pts}
              color={col.hex}
              closed
            />
          )
        })}
      {showSource && (penDraft.length > 0 || penCursor) && (
        <PenLoopOverlay
          loop={penDraft}
          cursor={penCursor}
          color={paletteColor(palette, brushColorId).hex}
          closed={false}
        />
      )}
      {showSource && penActive && penCursor && (
        <PenCursorRing
          geom={model.geometry}
          point={penCursor}
          faceIndex={hoverIdx}
          color={paletteColor(palette, brushColorId).hex}
          size={diag * 0.012}
        />
      )}
      {showSource &&
        esp &&
        penCutouts.map((cutout) => {
          const col = paletteColor(palette, cutout.meta.colorId)
          return (
            <PenEspOutline
              key={`pen-esp-${cutout.id}`}
              geom={model.geometry}
              loop={loopToVectors(cutout.loop)}
              meta={cutout.meta}
              color={col.hex}
            />
          )
        })}
      {showSource && gizmoPenIdx >= 0 && penCutouts[gizmoPenIdx] && (
        <>
          <AxisGizmo
            center={penCutoutCentroid(
              loopToVectors(penCutouts[gizmoPenIdx]!.loop),
            )}
            size={diag * 0.07}
            activeAxis={penCutouts[gizmoPenIdx]!.meta.axis}
            onPick={(axis) => {
              applyAxisToPenCutout(penCutouts[gizmoPenIdx]!.id, axis)
              setActivePenIndex(gizmoPenIdx)
            }}
          />
          <DepthHandles
            geom={model.geometry}
            loop={loopToVectors(penCutouts[gizmoPenIdx]!.loop)}
            meta={penCutouts[gizmoPenIdx]!.meta}
            size={diag * 0.07}
            onHover={(v) => {
              gizmoHit.current = v
            }}
            onDragStart={() => {
              gizmoHit.current = true
              beginStroke()
              setActivePenIndex(gizmoPenIdx)
              if (controls && 'enabled' in controls) {
                ;(controls as { enabled: boolean }).enabled = false
              }
            }}
            onDragEnd={() => {
              gizmoHit.current = false
              if (controls && 'enabled' in controls) {
                ;(controls as { enabled: boolean }).enabled = true
              }
            }}
            onChange={(patch) => {
              applyDepthsToPenCutout(penCutouts[gizmoPenIdx]!.id, patch)
            }}
          />
        </>
      )}
      <SplitPreview
        splitHeight={splitHeight}
        model={model}
        preview={preview}
        setBusy={setBusy}
        setError={setError}
        dropInIslands={dropInIslands}
      />
    </group>
  )
}
