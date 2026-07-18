import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  useStore,
  resolveIslandMeta,
  paletteColor,
} from '../state'
import {
  selectionBoundaryEdges,
  resolveInsertFloors,
  axisLetter,
  AXIS_COLORS,
  type CutAxis,
  type InsertMeta,
} from '../lib/extrude'
import { prepareParts } from '../lib/prepareParts'
import { facesNearPoint } from '../lib/brush'
import { splitContourSegments } from '../lib/splitContour'
import { listSelectionIslands } from '../lib/select'

const COLORS = {
  lower: '#9aa3b2',
  upper: '#c2c8d4',
  selected: '#ff8c42',
  dropIn: '#5ec8ff',
  dropInOutline: '#a8e4ff',
  outline: '#ffe08a',
  hover: '#7dd3fc',
  vertex: '#ffffff',
  insert: '#ff5a5a',
  recess: '#9aa3b2',
  plane: '#6ea8fe',
  cut: '#ffd166',
}

/** Nearest front-facing hit on `mesh`, or null. */
function pickHit(
  e: ThreeEvent<MouseEvent | PointerEvent>,
  mesh: THREE.Mesh,
  triCount: number,
): { idx: number; point: THREE.Vector3 } | null {
  const hits = e.intersections.filter((h) => h.object === mesh)
  const _n = new THREE.Vector3()
  const hit =
    hits.find((h) => {
      if (!h.face) return false
      _n.copy(h.face.normal).transformDirection(mesh.matrixWorld)
      return _n.dot(e.ray.direction) < 0
    }) ?? hits[0]

  if (!hit?.face) return null
  const idx = hit.faceIndex ?? Math.floor(hit.face.a / 3)
  if (idx < 0 || idx >= triCount) return null
  return { idx, point: hit.point.clone() }
}

/** Shared pick targets so the model mesh can yield raycasts to depth handles. */
const depthHandlePick: {
  pocket: THREE.Vector3
  entry: THREE.Vector3
  radius: number
  active: boolean
} = {
  pocket: new THREE.Vector3(),
  entry: new THREE.Vector3(),
  radius: 1,
  active: false,
}

const _pickAb = new THREE.Vector3()
const _pickAo = new THREE.Vector3()
const _pickRayPt = new THREE.Vector3()
const _pickSegPt = new THREE.Vector3()

function distSqRayToSegment(
  ray: THREE.Ray,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  _pickAb.subVectors(b, a)
  const len = _pickAb.length()
  if (len < 1e-8) return ray.distanceSqToPoint(a)
  _pickAb.multiplyScalar(1 / len)
  _pickAo.subVectors(ray.origin, a)
  const d1 = ray.direction
  const d2 = _pickAb
  const aDot = d1.dot(d1)
  const bDot = d1.dot(d2)
  const cDot = d2.dot(d2)
  const dDot = d1.dot(_pickAo)
  const eDot = d2.dot(_pickAo)
  const denom = aDot * cDot - bDot * bDot
  let t = 0
  let s = eDot
  if (Math.abs(denom) > 1e-8) {
    t = (bDot * eDot - cDot * dDot) / denom
    s = (aDot * eDot - bDot * dDot) / denom
  }
  s = Math.max(0, Math.min(len, s))
  _pickRayPt.copy(ray.origin).addScaledVector(d1, Math.max(0, t))
  _pickSegPt.copy(a).addScaledVector(d2, s)
  return _pickRayPt.distanceToSquared(_pickSegPt)
}

function rayNearDepthHandle(ray: THREE.Ray): boolean {
  if (!depthHandlePick.active) return false
  const r2 = depthHandlePick.radius * depthHandlePick.radius
  return (
    distSqRayToSegment(ray, depthHandlePick.pocket, depthHandlePick.entry) <= r2
  )
}

function isGizmoObject(obj: THREE.Object3D | null | undefined): boolean {
  let o: THREE.Object3D | null | undefined = obj
  while (o) {
    const u = o.userData
    if (u?.axisGizmo || u?.depthHandle) return true
    o = o.parent
  }
  return false
}

/** True only when the nearest ray hit is a gizmo (not a gizmo behind the mesh). */
function closestHitIsGizmo(e: ThreeEvent<PointerEvent>): boolean {
  const hit = e.intersections[0]
  if (hit) return isGizmoObject(hit.object)
  return isGizmoObject(e.object)
}

function islandCentroid(
  geom: THREE.BufferGeometry,
  faces: Set<number>,
): THREE.Vector3 {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const c = new THREE.Vector3()
  let n = 0
  for (const t of faces) {
    const a = t * 3
    for (let i = 0; i < 3; i++) {
      c.x += pos.getX(a + i)
      c.y += pos.getY(a + i)
      c.z += pos.getZ(a + i)
      n++
    }
  }
  if (n > 0) c.multiplyScalar(1 / n)
  return c
}

function modelDiagonal(geom: THREE.BufferGeometry): number {
  geom.computeBoundingBox()
  const s = new THREE.Vector3()
  geom.boundingBox!.getSize(s)
  return Math.max(s.x, s.y, s.z, 1)
}

function lightenHex(hex: string, amount = 0.35): string {
  const c = new THREE.Color(hex)
  c.lerp(new THREE.Color('#ffffff'), amount)
  return `#${c.getHexString()}`
}

function ModelMesh() {
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
  const preview = useStore((s) => s.preview)
  const esp = useStore((s) => s.esp)
  const activeIsland = useStore((s) => s.activeIsland)
  const setActiveIsland = useStore((s) => s.setActiveIsland)
  const applyAxisToIsland = useStore((s) => s.applyAxisToIsland)
  const applyDepthsToIsland = useStore((s) => s.applyDepthsToIsland)
  const setBusy = useStore((s) => s.setBusy)
  const setError = useStore((s) => s.setError)
  const beginStroke = useStore((s) => s.beginStroke)
  const paintFaces = useStore((s) => s.paintFaces)
  const busy = useStore((s) => s.busy)
  const error = useStore((s) => s.error)
  const meshRef = useRef<THREE.Mesh>(null)
  const painting = useRef(false)
  const gizmoHit = useRef(false)
  const downPoint = useRef<THREE.Vector2 | null>(null)
  const lastPaintPoint = useRef<THREE.Vector3 | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const { controls, gl } = useThree()

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

  const hoveredIslandIdx = useMemo(() => {
    if (hoverIdx == null || !dropIn.has(hoverIdx)) return -1
    return dropInIslands.findIndex((isl) => isl.has(hoverIdx))
  }, [hoverIdx, dropIn, dropInIslands])

  // Track painting in state so the axis gizmo unmounts during strokes
  const [isPainting, setIsPainting] = useState(false)
  const setPainting = (v: boolean) => {
    painting.current = v
    setIsPainting(v)
  }

  const gizmoIslandIdx = isPainting
    ? -1
    : hoveredIslandIdx >= 0
      ? hoveredIslandIdx
      : activeIsland >= 0 && activeIsland < dropInIslands.length
        ? activeIsland
        : -1

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const proto = THREE.Mesh.prototype.raycast
    mesh.raycast = (raycaster, intersects) => {
      // Pocket handle sits inside the shell — yield so the disc can be picked
      if (rayNearDepthHandle(raycaster.ray)) return
      proto.call(mesh, raycaster, intersects)
    }
    return () => {
      mesh.raycast = proto
    }
  }, [model])

  const paintAt = (e: ThreeEvent<PointerEvent>) => {
    if (!model || !meshRef.current) return
    const hit = pickHit(e, meshRef.current, model.count)
    if (!hit) return
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

  const endPaint = () => {
    if (!painting.current) return
    setPainting(false)
    lastPaintPoint.current = null
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = true
    }
  }

  useEffect(() => {
    const up = () => {
      endPaint()
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [controls])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!model || busy || e.button !== 0) return
    // Gizmo is frontmost (events.filter prefers them) — leave it alone
    if (gizmoHit.current || closestHitIsGizmo(e)) {
      e.stopPropagation()
      return
    }
    e.stopPropagation()
    setPainting(true)
    lastPaintPoint.current = null
    downPoint.current = new THREE.Vector2(
      e.nativeEvent.clientX,
      e.nativeEvent.clientY,
    )
    // Drop sticky island selection so the axis gizmo unmounts while painting
    // a new region (otherwise arrows steal hits / block new selections).
    setActiveIsland(-1)
    beginStroke()
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = false
    }
    try {
      gl.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    paintAt(e)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!model || !meshRef.current || busy) return
    if (painting.current) {
      e.stopPropagation()
      paintAt(e)
      return
    }
    // Don't clear island hover while the pointer is on a gizmo
    if (gizmoHit.current || closestHitIsGizmo(e)) return

    const hit = pickHit(e, meshRef.current, model.count)
    setHoverIdx(hit?.idx ?? null)
    // Stick the island so gizmos stay mounted when moving onto handles
    if (hit && dropIn.has(hit.idx)) {
      const idx = dropInIslands.findIndex((isl) => isl.has(hit.idx))
      if (idx >= 0 && activeIsland !== idx) setActiveIsland(idx)
    }
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    try {
      gl.domElement.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    // Short click on a drop-in face selects that island (gizmo / panel sync)
    if (
      painting.current &&
      downPoint.current &&
      model &&
      meshRef.current
    ) {
      const dx = e.nativeEvent.clientX - downPoint.current.x
      const dy = e.nativeEvent.clientY - downPoint.current.y
      if (dx * dx + dy * dy < 16) {
        const hit = pickHit(e, meshRef.current, model.count)
        if (hit && dropIn.has(hit.idx)) {
          const idx = dropInIslands.findIndex((isl) => isl.has(hit.idx))
          if (idx >= 0) setActiveIsland(idx)
        }
      }
    }
    downPoint.current = null
    endPaint()
  }

  const onPointerOut = () => {
    if (!painting.current) setHoverIdx(null)
  }

  if (!model) return null

  // Keep the painted source visible until preview parts are ready, and whenever
  // preview CSG fails — otherwise a failed prepare leaves an empty viewport.
  const showSource = !preview || busy || !!error
  const diag = modelDiagonal(model.geometry)

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={model.geometry}
        visible={showSource}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOut={onPointerOut}
        castShadow
        receiveShadow
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
            faceIndex={hoverIdx}
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
          {!insertsOnly && (
            <SplitCutOutline geom={model.geometry} height={splitHeight} />
          )}
          {gizmoIslandIdx >= 0 && dropInIslands[gizmoIslandIdx] && (
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
                onHover={(v) => {
                  gizmoHit.current = v
                }}
                onDragStart={() => {
                  if (painting.current) endPaint()
                  gizmoHit.current = true
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

/**
 * Drag handles for pocket (insert floor) and entry safety planes along the
 * cut axis. Shown on the hovered/active island alongside the axis gizmo.
 *
 * Picking uses screen-space proximity (capture-phase) so the pocket handle
 * stays draggable even when it sits inside the mesh.
 */
function DepthHandles({
  geom,
  faces,
  meta,
  size,
  onHover,
  onDragStart,
  onDragEnd,
  onChange,
}: {
  geom: THREE.BufferGeometry
  faces: Set<number>
  meta: InsertMeta
  size: number
  onHover: (over: boolean) => void
  onDragStart: () => void
  onDragEnd: () => void
  onChange: (patch: { floor?: number; entry?: number }) => void
}) {
  const { camera, gl } = useThree()
  const dragging = useRef<'floor' | 'entry' | null>(null)
  const axisOrigin = useRef(new THREE.Vector3())
  const axisDir = useRef(new THREE.Vector3())
  const pocketRef = useRef(new THREE.Vector3())
  const entryRef = useRef(new THREE.Vector3())
  const metaRef = useRef(meta)
  metaRef.current = meta

  const resolved = useMemo(
    () =>
      resolveInsertFloors(
        geom,
        faces,
        meta.axis,
        meta.floor,
        0.75,
        meta.entry,
      ),
    [geom, faces, meta.axis, meta.floor, meta.entry],
  )

  const center = useMemo(() => islandCentroid(geom, faces), [geom, faces])
  const letter = axisLetter(resolved.axis)
  const color = AXIS_COLORS[letter]
  const axisUnit = useMemo(() => {
    if (letter === 'x') return new THREE.Vector3(1, 0, 0)
    if (letter === 'y') return new THREE.Vector3(0, 1, 0)
    return new THREE.Vector3(0, 0, 1)
  }, [letter])
  const quatDisc = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        axisUnit,
      ),
    [axisUnit],
  )
  const quatTube = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        axisUnit,
      ),
    [axisUnit],
  )

  const planePoint = (coord: number) => {
    if (letter === 'x') return new THREE.Vector3(coord, center.y, center.z)
    if (letter === 'y') return new THREE.Vector3(center.x, coord, center.z)
    return new THREE.Vector3(center.x, center.y, coord)
  }

  const pocketPos = planePoint(resolved.insertFloor)
  const entryPos = planePoint(resolved.entryFloor)
  pocketRef.current.copy(pocketPos)
  entryRef.current.copy(entryPos)

  const hitR = size * 0.55
  useEffect(() => {
    depthHandlePick.pocket.copy(pocketPos)
    depthHandlePick.entry.copy(entryPos)
    depthHandlePick.radius = hitR
    depthHandlePick.active = true
    return () => {
      depthHandlePick.active = false
    }
  }, [pocketPos.x, pocketPos.y, pocketPos.z, entryPos.x, entryPos.y, entryPos.z, hitR])

  const letterRef = useRef(letter)
  letterRef.current = letter
  const centerRef = useRef(center)
  centerRef.current = center
  const facesRef = useRef(faces)
  facesRef.current = faces
  const geomRef = useRef(geom)
  geomRef.current = geom

  // Screen-space pick in capture phase — works for the pocket disc inside the mesh
  useEffect(() => {
    const el = gl.domElement
    const ndcThresh = 0.09

    const screenDist = (
      clientX: number,
      clientY: number,
      world: THREE.Vector3,
    ) => {
      const rect = el.getBoundingClientRect()
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1
      const v = world.clone().project(camera)
      if (v.z > 1) return Infinity
      return Math.hypot(nx - v.x, ny - v.y)
    }

    const coordFromEvent = (clientX: number, clientY: number): number => {
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, camera)
      const ray = raycaster.ray
      const ao = axisOrigin.current
      const ad = axisDir.current
      const w0 = new THREE.Vector3().subVectors(ray.origin, ao)
      const a = ray.direction.dot(ray.direction)
      const b = ray.direction.dot(ad)
      const c = ad.dot(ad)
      const d = ray.direction.dot(w0)
      const eDot = ad.dot(w0)
      const denom = a * c - b * b
      const s = Math.abs(denom) < 1e-10 ? 0 : (b * eDot - c * d) / denom
      const closest = new THREE.Vector3()
        .copy(ray.origin)
        .addScaledVector(ray.direction, s)
      const L = letterRef.current
      return L === 'x' ? closest.x : L === 'y' ? closest.y : closest.z
    }

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || dragging.current) return
      const dPocket = screenDist(ev.clientX, ev.clientY, pocketRef.current)
      const dEntry = screenDist(ev.clientX, ev.clientY, entryRef.current)
      const hitPocket = dPocket <= ndcThresh
      const hitEntry = dEntry <= ndcThresh
      if (!hitPocket && !hitEntry) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      const which =
        hitPocket && (!hitEntry || dPocket <= dEntry) ? 'floor' : 'entry'
      const L = letterRef.current
      axisOrigin.current.copy(centerRef.current)
      axisDir.current.set(L === 'x' ? 1 : 0, L === 'y' ? 1 : 0, L === 'z' ? 1 : 0)
      dragging.current = which
      onHover(true)
      onDragStart()
      document.body.style.cursor = 'ns-resize'
    }

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return
      const m = metaRef.current
      const coord = coordFromEvent(ev.clientX, ev.clientY)
      const next = resolveInsertFloors(
        geomRef.current,
        facesRef.current,
        m.axis,
        dragging.current === 'floor' ? coord : m.floor,
        0.75,
        dragging.current === 'entry' ? coord : m.entry,
      )
      if (dragging.current === 'floor') onChange({ floor: next.insertFloor })
      else onChange({ entry: next.entryFloor })
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = null
      onHover(false)
      onDragEnd()
      document.body.style.cursor = ''
    }

    el.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [camera, gl, onChange, onDragEnd, onDragStart, onHover])

  const r = size * 0.28
  const tubeR = size * 0.04
  const mid = pocketPos.clone().add(entryPos).multiplyScalar(0.5)
  const spanLen = Math.max(pocketPos.distanceTo(entryPos), size * 0.5)

  return (
    <group>
      {/* Visible axis guide (display only) */}
      <mesh position={mid} quaternion={quatTube} raycast={() => {}}>
        <cylinderGeometry args={[tubeR, tubeR, spanLen, 6]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35}
          depthTest={false}
        />
      </mesh>

      {/* Pocket depth — filled disc */}
      <mesh position={pocketPos} quaternion={quatDisc} raycast={() => {}}>
        <circleGeometry args={[r, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.95}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Entry safety — ring */}
      <mesh position={entryPos} quaternion={quatDisc} raycast={() => {}}>
        <ringGeometry args={[r * 0.55, r, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.95}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

/** Six clickable axis arrows for setting an island's cut direction. */
function AxisGizmo({
  center,
  size,
  activeAxis,
  onPick,
  onHover,
  onDragStart,
  onDragEnd,
}: {
  center: THREE.Vector3
  size: number
  activeAxis: CutAxis
  onPick: (axis: CutAxis) => void
  onHover: (over: boolean) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const axes: { id: CutAxis; dir: THREE.Vector3; letter: 'x' | 'y' | 'z' }[] = [
    { id: '+x', dir: new THREE.Vector3(1, 0, 0), letter: 'x' },
    { id: '-x', dir: new THREE.Vector3(-1, 0, 0), letter: 'x' },
    { id: '+y', dir: new THREE.Vector3(0, 1, 0), letter: 'y' },
    { id: '-y', dir: new THREE.Vector3(0, -1, 0), letter: 'y' },
    { id: '+z', dir: new THREE.Vector3(0, 0, 1), letter: 'z' },
    { id: '-z', dir: new THREE.Vector3(0, 0, -1), letter: 'z' },
  ]

  const shaftLen = size * 0.72
  const coneLen = size * 0.28
  const shaftR = size * 0.04
  const coneR = size * 0.1

  return (
    <group position={center}>
      {/* small hub */}
      <mesh raycast={() => {}}>
        <sphereGeometry args={[size * 0.06, 12, 12]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
      {axes.map(({ id, dir, letter }) => {
        const active = activeAxis === id
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        )
        const mid = dir.clone().multiplyScalar(shaftLen / 2)
        const tip = dir.clone().multiplyScalar(shaftLen + coneLen / 2)
        const color = AXIS_COLORS[letter]
        return (
          <group key={id}>
            <mesh
              position={mid}
              quaternion={quat}
              userData={{ axisGizmo: true }}
              onPointerDown={(e) => {
                e.stopPropagation()
                onHover(true)
                onDragStart()
                onPick(id)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                onHover(false)
                onDragEnd()
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                onHover(true)
                document.body.style.cursor = 'pointer'
              }}
              onPointerOut={(e) => {
                e.stopPropagation()
                onHover(false)
                document.body.style.cursor = ''
              }}
            >
              <cylinderGeometry
                args={[shaftR * (active ? 1.4 : 1.1), shaftR * (active ? 1.4 : 1.1), shaftLen, 8]}
              />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 1 : 0.55}
                depthTest={false}
              />
            </mesh>
            <mesh
              position={tip}
              quaternion={quat}
              userData={{ axisGizmo: true }}
              onPointerDown={(e) => {
                e.stopPropagation()
                onHover(true)
                onDragStart()
                onPick(id)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                onHover(false)
                onDragEnd()
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                onHover(true)
                document.body.style.cursor = 'pointer'
              }}
              onPointerOut={(e) => {
                e.stopPropagation()
                onHover(false)
                document.body.style.cursor = ''
              }}
            >
              <coneGeometry args={[coneR * (active ? 1.25 : 1), coneLen, 10]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 1 : 0.75}
                depthTest={false}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Yellow contour where z=H cuts through the mesh surface. */
function SplitCutOutline({
  geom,
  height,
}: {
  geom: THREE.BufferGeometry
  height: number
}) {
  const lineGeom = useMemo(() => {
    const segs = splitContourSegments(geom, height)
    if (segs.length < 6) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(segs, 3))
    return g
  }, [geom, height])

  if (!lineGeom) return null

  return (
    <lineSegments geometry={lineGeom} raycast={() => {}}>
      <lineBasicMaterial color={COLORS.cut} depthTest={false} />
    </lineSegments>
  )
}

/** Ring showing brush radius at the hovered face centroid. */
function BrushCursor({
  geom,
  faceIndex,
  brushRadius,
}: {
  geom: THREE.BufferGeometry
  faceIndex: number | null
  brushRadius: number
}) {
  if (faceIndex == null || brushRadius <= 0.05) return null
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const a = faceIndex * 3
  const c = new THREE.Vector3(
    (pos.getX(a) + pos.getX(a + 1) + pos.getX(a + 2)) / 3,
    (pos.getY(a) + pos.getY(a + 1) + pos.getY(a + 2)) / 3,
    (pos.getZ(a) + pos.getZ(a + 1) + pos.getZ(a + 2)) / 3,
  )
  // Orient ring using face normal so it sits on the surface
  const n = new THREE.Vector3()
  const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
  const v1 = new THREE.Vector3(pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1))
  const v2 = new THREE.Vector3(pos.getX(a + 2), pos.getY(a + 2), pos.getZ(a + 2))
  n.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    n,
  )

  return (
    <mesh position={c} quaternion={quat} raycast={() => {}}>
      <ringGeometry args={[brushRadius * 0.92, brushRadius, 48]} />
      <meshBasicMaterial
        color={COLORS.hover}
        transparent
        opacity={0.55}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  )
}

/** Outline-only preview of the triangle currently under the cursor. */
function HoverOutline({
  geom,
  faceIndex,
}: {
  geom: THREE.BufferGeometry
  faceIndex: number | null
  brushRadius?: number
  hitPoint?: THREE.Vector3 | null
}) {
  const edgeGeom = useMemo(() => {
    if (faceIndex == null) return null
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const a = faceIndex * 3
    const corners = [0, 1, 2].map(
      (i) => new THREE.Vector3(pos.getX(a + i), pos.getY(a + i), pos.getZ(a + i)),
    )
    const edgePos: number[] = []
    for (let e = 0; e < 3; e++) {
      const u = corners[e]
      const v = corners[(e + 1) % 3]
      edgePos.push(u.x, u.y, u.z, v.x, v.y, v.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
    return g
  }, [geom, faceIndex])

  if (!edgeGeom) return null

  return (
    <lineSegments geometry={edgeGeom} raycast={() => {}}>
      <lineBasicMaterial color={COLORS.hover} depthTest={false} />
    </lineSegments>
  )
}

/** X-ray wire outline of an insert curtain (surface → floor), always on top. */
function InsertEspOutline({
  geom,
  selection,
  axis,
  floor,
  entry,
  color,
}: {
  geom: THREE.BufferGeometry
  selection: Set<number>
  axis: CutAxis
  floor: number
  entry?: number
  color: string
}) {
  const edgeGeom = useMemo(() => {
    if (selection.size === 0) return null
    const resolved = resolveInsertFloors(
      geom,
      selection,
      axis,
      floor,
      0.75,
      entry,
    )
    const letter = axisLetter(resolved.axis)
    const f = resolved.insertFloor
    const entryPlane = resolved.entryFloor
    const boundary = selectionBoundaryEdges(geom, selection)
    if (boundary.length < 2) return null

    const pos: number[] = []
    const project = (v: THREE.Vector3, plane: number): THREE.Vector3 => {
      if (letter === 'x') return new THREE.Vector3(plane, v.y, v.z)
      if (letter === 'y') return new THREE.Vector3(v.x, plane, v.z)
      return new THREE.Vector3(v.x, v.y, plane)
    }

    for (let i = 0; i + 1 < boundary.length; i += 2) {
      const u = boundary[i]!
      const v = boundary[i + 1]!
      const pu = project(u, f)
      const pv = project(v, f)
      const eu = project(u, entryPlane)
      const ev = project(v, entryPlane)
      // surface boundary
      pos.push(u.x, u.y, u.z, v.x, v.y, v.z)
      // insert floor boundary
      pos.push(pu.x, pu.y, pu.z, pv.x, pv.y, pv.z)
      // entry safety boundary (opposite direction)
      pos.push(eu.x, eu.y, eu.z, ev.x, ev.y, ev.z)
      // side posts: entry → surface → floor
      pos.push(eu.x, eu.y, eu.z, u.x, u.y, u.z)
      pos.push(ev.x, ev.y, ev.z, v.x, v.y, v.z)
      pos.push(u.x, u.y, u.z, pu.x, pu.y, pu.z)
      pos.push(v.x, v.y, v.z, pv.x, pv.y, pv.z)
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [geom, selection, axis, floor, entry])

  useEffect(() => {
    return () => {
      edgeGeom?.dispose()
    }
  }, [edgeGeom])

  if (!edgeGeom) return null

  return (
    <lineSegments geometry={edgeGeom} raycast={() => {}} renderOrder={20}>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        transparent
        opacity={0.9}
      />
    </lineSegments>
  )
}

/** Renders selected triangles with face fill, edge outline, and vertex points. */
function SelectionOverlay({
  geom,
  selection,
  faceColor,
  outlineColor,
}: {
  geom: THREE.BufferGeometry
  selection: Set<number>
  faceColor: string
  outlineColor: string
}) {
  const { faceGeom, edgeGeom, boundaryGeom, vertexGeom } = useMemo(() => {
    if (selection.size === 0) {
      return {
        faceGeom: null as THREE.BufferGeometry | null,
        edgeGeom: null as THREE.BufferGeometry | null,
        boundaryGeom: null as THREE.BufferGeometry | null,
        vertexGeom: null as THREE.BufferGeometry | null,
      }
    }

    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const facePos: number[] = []
    const edgePos: number[] = []
    const vertKeys = new Map<string, THREE.Vector3>()

    for (const t of selection) {
      const a = t * 3
      const corners: THREE.Vector3[] = []
      for (let i = 0; i < 3; i++) {
        const vi = a + i
        const v = new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
        corners.push(v)
        facePos.push(v.x, v.y, v.z)
        const k = `${v.x.toFixed(5)}_${v.y.toFixed(5)}_${v.z.toFixed(5)}`
        vertKeys.set(k, v)
      }
      // all three edges of the triangle (wireframe)
      for (let e = 0; e < 3; e++) {
        const u = corners[e]
        const v = corners[(e + 1) % 3]
        edgePos.push(u.x, u.y, u.z, v.x, v.y, v.z)
      }
    }

    const faceG = new THREE.BufferGeometry()
    faceG.setAttribute('position', new THREE.Float32BufferAttribute(facePos, 3))
    faceG.computeVertexNormals()

    const edgeG = new THREE.BufferGeometry()
    edgeG.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))

    const boundary = selectionBoundaryEdges(geom, selection)
    const boundPos: number[] = []
    for (const v of boundary) boundPos.push(v.x, v.y, v.z)
    const boundG = new THREE.BufferGeometry()
    boundG.setAttribute('position', new THREE.Float32BufferAttribute(boundPos, 3))

    const vertPos: number[] = []
    for (const v of vertKeys.values()) vertPos.push(v.x, v.y, v.z)
    const vertG = new THREE.BufferGeometry()
    vertG.setAttribute('position', new THREE.Float32BufferAttribute(vertPos, 3))

    return {
      faceGeom: faceG,
      edgeGeom: edgeG,
      boundaryGeom: boundG,
      vertexGeom: vertG,
    }
  }, [geom, selection])

  if (!faceGeom || selection.size === 0) return null

  return (
    <group>
      {/* face fill — raycast disabled so overlays never steal picks */}
      <mesh geometry={faceGeom} raycast={() => {}}>
        <meshBasicMaterial
          color={faceColor}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          transparent
          opacity={0.75}
        />
      </mesh>

      {/* all selected triangle edges */}
      <lineSegments geometry={edgeGeom!} raycast={() => {}}>
        <lineBasicMaterial
          color={outlineColor}
          transparent
          opacity={0.55}
          depthTest
        />
      </lineSegments>

      {/* selection boundary silhouette */}
      <lineSegments geometry={boundaryGeom!} raycast={() => {}}>
        <lineBasicMaterial
          color={outlineColor}
          linewidth={2}
          depthTest={false}
        />
      </lineSegments>

      {/* vertex markers */}
      <points geometry={vertexGeom!} raycast={() => {}}>
        <pointsMaterial
          color={COLORS.vertex}
          size={3}
          sizeAttenuation={false}
          depthTest={false}
        />
      </points>
    </group>
  )
}

function SplitPreview({
  splitHeight,
  model,
  preview,
  setBusy,
  setError,
  dropInIslands,
}: {
  splitHeight: number
  model: NonNullable<ReturnType<typeof useStore.getState>['model']>
  preview: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  dropInIslands: Set<number>[]
}) {
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
  const palette = useStore((s) => s.palette)
  const brushColorId = useStore((s) => s.brushColorId)
  const cutAxis = useStore((s) => s.cutAxis)
  const dropInFloorZ = useStore((s) => s.dropInFloorZ)
  const explode = useStore((s) => s.explode)
  const clearance = useStore((s) => s.clearance)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const [parts, setParts] = useState<{
    lower: THREE.BufferGeometry
    upper: THREE.BufferGeometry | null
    dropIns: THREE.BufferGeometry[]
    dropInAxes: CutAxis[]
    insertsOnly: boolean
  } | null>(null)

  useEffect(() => {
    if (!preview) {
      setParts(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    ;(async () => {
      try {
        const prepared = await prepareParts(
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
        if (cancelled) return
        prepared.bottom.computeVertexNormals()
        prepared.upper?.computeVertexNormals()
        for (const g of prepared.dropIns) g.computeVertexNormals()
        setParts({
          lower: prepared.bottom,
          upper: prepared.upper,
          dropIns: prepared.dropIns,
          dropInAxes: prepared.dropInAxes,
          insertsOnly: prepared.insertsOnly,
        })
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setError((err as Error).message || 'CSG failed')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    preview,
    model,
    splitHeight,
    structural,
    dropIn,
    dropInMeta,
    clearance,
    dropInFloorZ,
    insertsOnly,
    cutAxis,
    setBusy,
    setError,
  ])

  const box = model.geometry.boundingBox!
  const size = new THREE.Vector3()
  box.getSize(size)
  const planeW = Math.max(size.x, size.y) * 1.4
  const planeH = planeW
  const gap = size.z * 0.85 * explode

  const fallback = {
    axis: cutAxis,
    floor: dropInFloorZ,
    colorId: brushColorId,
  }

  return (
    <group>
      {!insertsOnly && explode < 0.05 && (
        <>
          <mesh position={[0, 0, splitHeight]} raycast={() => {}}>
            <planeGeometry args={[planeW, planeH]} />
            <meshBasicMaterial
              color={COLORS.plane}
              transparent
              opacity={0.18}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments position={[0, 0, splitHeight]} raycast={() => {}}>
            <edgesGeometry args={[new THREE.PlaneGeometry(planeW, planeH)]} />
            <lineBasicMaterial color={COLORS.plane} />
          </lineSegments>
        </>
      )}

      {preview && parts && (
        <group>
          <mesh
            geometry={parts.lower}
            position={[0, 0, parts.insertsOnly ? 0 : -gap]}
            raycast={() => {}}
          >
            <meshStandardMaterial
              color={COLORS.lower}
              flatShading
              side={THREE.DoubleSide}
            />
          </mesh>
          {parts.upper && (
            <mesh geometry={parts.upper} position={[0, 0, gap]} raycast={() => {}}>
              <meshStandardMaterial
                color={COLORS.upper}
                flatShading
                side={THREE.DoubleSide}
                transparent
                opacity={0.7}
              />
            </mesh>
          )}
          {parts.dropIns.map((g, i) => {
            const island = dropInIslands[i]
            const axis = parts.dropInAxes[i] ?? '-z'
            const hex = island
              ? paletteColor(
                  palette,
                  resolveIslandMeta(island, dropInMeta, fallback).colorId,
                ).hex
              : COLORS.dropIn
            // Explode along the insert's cut axis so ±X / ±Y inserts are visible
            const lift = gap * (parts.insertsOnly ? 1.1 : 1.35)
            const ox =
              axis === '+x' ? lift : axis === '-x' ? -lift : 0
            const oy =
              axis === '+y' ? lift : axis === '-y' ? -lift : 0
            const oz =
              axis === '+z' ? lift : axis === '-z' ? lift : 0
            return (
              <mesh
                key={i}
                geometry={g}
                position={[ox, oy, oz]}
                raycast={() => {}}
              >
                <meshStandardMaterial
                  color={hex}
                  flatShading
                  side={THREE.DoubleSide}
                />
              </mesh>
            )
          })}
        </group>
      )}
    </group>
  )
}

function Grid() {
  // Three.js GridHelper lies in XZ with Y-up; rotate so it sits on the Z-up bed (XY).
  return (
    <gridHelper
      args={[400, 80, '#2a2f3a', '#1a1d24']}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
    />
  )
}

function CameraRig() {
  const model = useStore((s) => s.model)
  const { camera, controls } = useThree()
  useEffect(() => {
    // STL convention: Z is up
    camera.up.set(0, 0, 1)
    if (!model) return
    model.geometry.computeBoundingBox()
    const b = model.geometry.boundingBox!
    const size = new THREE.Vector3()
    b.getSize(size)
    const dist = Math.max(size.x, size.y, size.z) * 1.8
    const midZ = size.z / 2
    camera.position.set(dist, -dist * 0.85, dist * 0.55)
    camera.lookAt(0, 0, midZ)
    if (controls && 'target' in controls) {
      ;(controls as unknown as { target: THREE.Vector3; update: () => void }).target.set(0, 0, midZ)
      ;(controls as unknown as { update: () => void }).update()
    }
  }, [model, camera, controls])
  return null
}

export default function Viewport() {
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const setError = useStore((s) => s.setError)
  const [dropActive, setDropActive] = useState(false)

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

  return (
    <div
      className="viewport"
      onDragOver={(e) => {
        e.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
    >
      <Canvas
        shadows
        camera={{ fov: 45, near: 0.1, far: 5000, position: [200, -170, 120], up: [0, 0, 1] }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        onCreated={({ camera, scene }) => {
          camera.up.set(0, 0, 1)
          scene.background = new THREE.Color('#0a0c10')
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[200, -150, 300]}
          intensity={1.2}
          castShadow
        />
        <directionalLight position={[-150, 100, 200]} intensity={0.4} />
        <Grid />
        <ModelMesh />
        <CameraRig />
        <OrbitControls makeDefault target={[0, 0, 10]} maxPolarAngle={Math.PI * 0.95} />
      </Canvas>

      <div className="overlay">
        {model && (
          <>
            <div className="badge">
              {model.name} · {model.count.toLocaleString()} tris · z{' '}
              {model.zMin.toFixed(1)}–{model.zMax.toFixed(1)}
            </div>
          </>
        )}
      </div>

      {!model && (
        <div className={`dropzone ${dropActive ? 'active' : ''}`}>
          <div className="card">
            <h2>Drop an STL here</h2>
            <p>or use “Load STL” in the panel</p>
          </div>
        </div>
      )}
    </div>
  )
}
