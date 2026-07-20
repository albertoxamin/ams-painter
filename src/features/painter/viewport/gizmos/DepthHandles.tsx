import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  axisLetter,
  resolveInsertFloors,
  AXIS_COLORS,
  type InsertMeta,
} from '../../../../lib/extrude'
import {
  penCutoutCentroid,
  resolveLoopInsertFloors,
} from '../../../../lib/penCutout'
import {
  pointerNearEntryRing,
  pointerNearPocketHandle,
  setDepthHandleDragging,
  setDepthHandleTarget,
} from '../../interaction/depthHandlePick'
import { useSetInteractionMode } from '../../interaction/InteractionContext'
import { islandCentroid } from '../pick'

/**
 * Drag handles for pocket (insert floor) and entry safety planes along the
 * cut axis. Shown on the hovered/active island alongside the axis gizmo.
 *
 * Picking uses screen-space proximity (capture-phase) so the pocket handle
 * stays draggable even when it sits inside the mesh.
 */
export function DepthHandles({
  geom,
  faces,
  loop,
  meta,
  size,
  onHover,
  onDragStart,
  onDragEnd,
  onChange,
}: {
  geom: THREE.BufferGeometry
  faces?: Set<number>
  loop?: THREE.Vector3[]
  meta: InsertMeta
  size: number
  onHover: (over: boolean) => void
  onDragStart: () => void
  onDragEnd: () => void
  onChange: (patch: { floor?: number; entry?: number }) => void
}) {
  const { camera, gl } = useThree()
  const setInteractionMode = useSetInteractionMode()
  const dragging = useRef<'floor' | 'entry' | null>(null)
  const axisOrigin = useRef(new THREE.Vector3())
  const axisDir = useRef(new THREE.Vector3())
  const pocketRef = useRef(new THREE.Vector3())
  const entryRef = useRef(new THREE.Vector3())
  const metaRef = useRef(meta)
  metaRef.current = meta

  const resolveFloors = (
    g: THREE.BufferGeometry,
    m: InsertMeta,
    floorCoord: number,
    entryCoord?: number,
  ) => {
    if (loop) {
      return resolveLoopInsertFloors(
        g,
        loop,
        m.axis,
        floorCoord,
        0.75,
        entryCoord,
      )
    }
    return resolveInsertFloors(
      g,
      faces!,
      m.axis,
      floorCoord,
      0.75,
      entryCoord,
    )
  }

  const resolved = useMemo(
    () => resolveFloors(geom, meta, meta.floor, meta.entry),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faces/loop identity drives resolution
    [geom, faces, loop, meta.axis, meta.floor, meta.entry],
  )

  const center = useMemo(() => {
    if (loop) return penCutoutCentroid(loop)
    return islandCentroid(geom, faces!)
  }, [geom, faces, loop])
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

  const ringRadius = size * 0.28
  useEffect(() => {
    setDepthHandleTarget({
      pocket: pocketPos,
      entry: entryPos,
      ringRadius,
      axis: letter,
    })
    return () => setDepthHandleTarget(null)
  }, [
    pocketPos.x,
    pocketPos.y,
    pocketPos.z,
    entryPos.x,
    entryPos.y,
    entryPos.z,
    ringRadius,
    letter,
  ])

  const letterRef = useRef(letter)
  letterRef.current = letter
  const centerRef = useRef(center)
  centerRef.current = center
  const facesRef = useRef(faces)
  facesRef.current = faces
  const loopRef = useRef(loop)
  loopRef.current = loop
  const geomRef = useRef(geom)
  geomRef.current = geom

  const resolveFromRefs = (
    floorCoord: number,
    entryCoord?: number,
  ) => {
    const m = metaRef.current
    if (loopRef.current) {
      return resolveLoopInsertFloors(
        geomRef.current,
        loopRef.current,
        m.axis,
        floorCoord,
        0.75,
        entryCoord,
      )
    }
    return resolveInsertFloors(
      geomRef.current,
      facesRef.current!,
      m.axis,
      floorCoord,
      0.75,
      entryCoord,
    )
  }

  // Screen-space pick in capture phase — works for the pocket disc inside the mesh
  useEffect(() => {
    const el = gl.domElement

    const pickHandle = (
      clientX: number,
      clientY: number,
    ): 'floor' | 'entry' | null => {
      const hitPocket = pointerNearPocketHandle(
        clientX,
        clientY,
        camera,
        el,
        0.1,
      )
      const hitEntry = pointerNearEntryRing(clientX, clientY, camera, el, 0.12)
      if (!hitPocket && !hitEntry) return null
      if (hitPocket && !hitEntry) return 'floor'
      if (hitEntry && !hitPocket) return 'entry'
      const dPocket = screenDist(clientX, clientY, pocketRef.current)
      const dEntry = screenDist(clientX, clientY, entryRef.current)
      return dPocket <= dEntry ? 'floor' : 'entry'
    }

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
      const which = pickHandle(ev.clientX, ev.clientY)
      if (!which) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      const L = letterRef.current
      axisOrigin.current.copy(centerRef.current)
      axisDir.current.set(L === 'x' ? 1 : 0, L === 'y' ? 1 : 0, L === 'z' ? 1 : 0)
      dragging.current = which
      setDepthHandleDragging(true)
      setInteractionMode('drag-depth')
      onHover(true)
      onDragStart()
      document.body.style.cursor = 'ns-resize'
      try {
        el.setPointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
    }

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return
      ev.preventDefault()
      const m = metaRef.current
      const coord = coordFromEvent(ev.clientX, ev.clientY)
      const next = resolveFromRefs(
        dragging.current === 'floor' ? coord : m.floor,
        dragging.current === 'entry' ? coord : m.entry,
      )
      if (dragging.current === 'floor') onChange({ floor: next.insertFloor })
      else onChange({ entry: next.entryFloor })
    }

    const onUp = (ev: PointerEvent) => {
      if (!dragging.current) return
      dragging.current = null
      setDepthHandleDragging(false)
      setInteractionMode('orbit')
      onHover(false)
      onDragEnd()
      document.body.style.cursor = ''
      try {
        if (el.hasPointerCapture(ev.pointerId)) {
          el.releasePointerCapture(ev.pointerId)
        }
      } catch {
        /* ignore */
      }
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

  const r = ringRadius
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
