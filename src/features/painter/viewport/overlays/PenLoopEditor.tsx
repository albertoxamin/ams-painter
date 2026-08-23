import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { axisLetter, type CutAxis } from '../../../../lib/extrude'
import { COLORS } from '../constants'

function axisNormal(axis: CutAxis): THREE.Vector3 {
  const n = new THREE.Vector3()
  const letter = axisLetter(axis)
  if (letter === 'x') n.set(1, 0, 0)
  else if (letter === 'y') n.set(0, 1, 0)
  else n.set(0, 0, 1)
  return n
}

/**
 * Edit a committed pen loop: drag vertices, alt-click to delete,
 * click an edge to insert a point (then drag).
 */
export function PenLoopEditor({
  loop,
  axis,
  color,
  size,
  onHover,
  onDragStart,
  onDragEnd,
  onChange,
}: {
  loop: THREE.Vector3[]
  axis: CutAxis
  color: string
  size: number
  onHover: (over: boolean) => void
  onDragStart: () => void
  onDragEnd: () => void
  onChange: (loop: THREE.Vector3[]) => void
}) {
  const { camera, gl, controls } = useThree()
  const drag = useRef<{ index: number } | null>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop
  const axisRef = useRef(axis)
  axisRef.current = axis
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onDragEndRef = useRef(onDragEnd)
  onDragEndRef.current = onDragEnd
  const onHoverRef = useRef(onHover)
  onHoverRef.current = onHover

  const r = Math.max(0.08, size * 0.18)
  const edgeR = r * 0.45

  const edges = useMemo(() => {
    const n = loop.length
    return Array.from({ length: n }, (_, i) => {
      const a = loop[i]!
      const b = loop[(i + 1) % n]!
      const dir = b.clone().sub(a)
      const len = dir.length()
      const mid = a.clone().add(b).multiplyScalar(0.5)
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        len > 1e-8 ? dir.normalize() : new THREE.Vector3(0, 1, 0),
      )
      return { i, mid, len, quat }
    })
  }, [loop])

  const setOrbit = (on: boolean) => {
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = on
    }
  }

  useEffect(() => {
    const ndc = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane()
    const hit = new THREE.Vector3()

    const project = (ev: PointerEvent, origin: THREE.Vector3) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      plane.setFromNormalAndCoplanarPoint(axisNormal(axisRef.current), origin)
      if (!raycaster.ray.intersectPlane(plane, hit)) return null
      return hit.clone()
    }

    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const origin = loopRef.current[d.index]
      if (!origin) return
      const p = project(ev, origin)
      if (!p) return
      const next = loopRef.current.map((v) => v.clone())
      next[d.index] = p
      onChangeRef.current(next)
    }

    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      setOrbit(true)
      onHoverRef.current(false)
      onDragEndRef.current()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [camera, gl, controls])

  const startDrag = (index: number) => {
    onDragStart()
    setOrbit(false)
    drag.current = { index }
    onHover(true)
  }

  const onEdgeDown = (e: ThreeEvent<PointerEvent>, i: number) => {
    e.stopPropagation()
    if (e.nativeEvent.button !== 0 || e.nativeEvent.altKey) return
    const a = loopRef.current[i]!
    const b = loopRef.current[(i + 1) % loopRef.current.length]!
    const inserted = a.clone().lerp(b, 0.5)
    const next = loopRef.current.map((p) => p.clone())
    next.splice(i + 1, 0, inserted)
    startDrag(i + 1)
    onChange(next)
  }

  const onVertDown = (e: ThreeEvent<PointerEvent>, i: number) => {
    e.stopPropagation()
    if (e.nativeEvent.button !== 0) return
    if (e.nativeEvent.altKey) {
      if (loopRef.current.length <= 3) return
      onDragStart()
      onChange(loopRef.current.filter((_, j) => j !== i))
      onDragEnd()
      return
    }
    startDrag(i)
  }

  if (loop.length < 3) return null

  return (
    <group userData={{ penLoopEdit: true }} renderOrder={26}>
      {edges.map(({ i, mid, len, quat }) => (
        <mesh
          key={`e-${i}`}
          position={mid}
          quaternion={quat}
          userData={{ penLoopEdit: true }}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(true)
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            if (!drag.current) onHover(false)
          }}
          onPointerDown={(e) => onEdgeDown(e, i)}
        >
          <cylinderGeometry args={[edgeR, edgeR, Math.max(len, r * 2), 6]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.22}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
      {loop.map((p, i) => (
        <mesh
          key={`v-${i}`}
          position={p}
          userData={{ penLoopEdit: true }}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(true)
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            if (!drag.current) onHover(false)
          }}
          onPointerDown={(e) => onVertDown(e, i)}
        >
          <sphereGeometry args={[r, 12, 12]} />
          <meshBasicMaterial
            color={COLORS.vertex}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}
