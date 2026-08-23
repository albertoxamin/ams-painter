import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '../constants'
import {
  cloneNode,
  closestOnPath,
  handleWorld,
  hasHandles,
  insertNodeAt,
  makeCorner,
  makeMirrored,
  moveAnchor,
  sampleSplitPath,
  setHandle,
  type SplitPathNode,
} from '../../../../lib/splitBezier'

const HANDLE_COLOR = '#7dd3fc'

/**
 * Figma/Photoshop-style edit: drag anchors, drag Bézier handles,
 * Alt-drag to break a pair, double-click to convert corner/smooth,
 * click the curve to insert, Alt-click to delete an anchor.
 */
export function SplitBezierEditor({
  nodes,
  plane,
  size,
  onChange,
  onCommit,
}: {
  nodes: SplitPathNode[]
  plane: THREE.Plane
  size: number
  onChange: (nodes: SplitPathNode[]) => void
  onCommit: () => void
}) {
  const { camera, gl, controls } = useThree()
  const drag = useRef<
    | { kind: 'anchor'; i: number }
    | { kind: 'in' | 'out'; i: number; breakPair: boolean }
    | null
  >(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const planeRef = useRef(plane)
  planeRef.current = plane
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const r = Math.max(0.12, size * 0.012)
  const handleR = r * 0.72
  const tubeR = r * 0.28

  const sampled = useMemo(() => sampleSplitPath(nodes), [nodes])

  const tubeGeom = useMemo(() => {
    if (sampled.length < 2) return null
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 0; i < sampled.length - 1; i++) {
      path.add(new THREE.LineCurve3(sampled[i]!, sampled[i + 1]!))
    }
    return new THREE.TubeGeometry(path, Math.max(sampled.length * 2, 12), tubeR, 5, false)
  }, [sampled, tubeR])

  const handleLines = useMemo(() => {
    const pos: number[] = []
    for (const n of nodes) {
      if (!hasHandles(n)) continue
      const a = new THREE.Vector3(n.x, n.y, n.z)
      if (n.in) {
        const h = handleWorld(n, 'in')
        pos.push(a.x, a.y, a.z, h.x, h.y, h.z)
      }
      if (n.out) {
        const h = handleWorld(n, 'out')
        pos.push(a.x, a.y, a.z, h.x, h.y, h.z)
      }
    }
    if (pos.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [nodes])

  const setOrbit = (on: boolean) => {
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = on
    }
  }

  useEffect(() => {
    const ndc = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    const hit = new THREE.Vector3()

    const project = (ev: PointerEvent): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(planeRef.current, hit)) return null
      return hit.clone()
    }

    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const p = project(ev)
      if (!p) return
      const cur = nodesRef.current
      if (d.kind === 'anchor') {
        const next = cur.map((n, i) => (i === d.i ? moveAnchor(n, p) : cloneNode(n)))
        onChangeRef.current(next)
        return
      }
      const n = cur[d.i]
      if (!n) return
      const next = cur.map(cloneNode)
      next[d.i] = setHandle(n, d.kind, p, d.breakPair || ev.altKey)
      onChangeRef.current(next)
    }

    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      setOrbit(true)
      onCommitRef.current()
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

  const startAnchor = (i: number) => {
    setOrbit(false)
    drag.current = { kind: 'anchor', i }
  }

  const startHandle = (i: number, which: 'in' | 'out', breakPair: boolean) => {
    setOrbit(false)
    drag.current = { kind: which, i, breakPair }
  }

  const onAnchorDown = (e: ThreeEvent<PointerEvent>, i: number) => {
    e.stopPropagation()
    if (e.nativeEvent.button !== 0) return
    if (e.nativeEvent.altKey) {
      if (nodesRef.current.length <= 2) return
      onChange(nodesRef.current.filter((_, j) => j !== i).map(cloneNode))
      onCommit()
      return
    }
    startAnchor(i)
  }

  const onAnchorDouble = (e: ThreeEvent<MouseEvent>, i: number) => {
    e.stopPropagation()
    const cur = nodesRef.current
    const n = cur[i]
    if (!n) return
    const next = cur.map(cloneNode)
    next[i] = hasHandles(n)
      ? makeCorner(n)
      : makeMirrored(n, cur[i - 1], cur[i + 1])
    onChange(next)
    onCommit()
  }

  const onHandleDown = (
    e: ThreeEvent<PointerEvent>,
    i: number,
    which: 'in' | 'out',
  ) => {
    e.stopPropagation()
    if (e.nativeEvent.button !== 0) return
    startHandle(i, which, e.nativeEvent.altKey)
  }

  const onCurveDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (e.nativeEvent.button !== 0 || e.nativeEvent.altKey) return
    const hit = e.point
    const closest = closestOnPath(nodesRef.current, hit)
    if (!closest || closest.dist > r * 4) return
    if (closest.t < 0.04 || closest.t > 0.96) return
    const next = insertNodeAt(nodesRef.current, closest.seg, closest.t)
    onChange(next)
    const newI = closest.seg + 1
    startAnchor(newI)
  }

  if (nodes.length < 2) return null

  return (
    <group userData={{ splitBezierEdit: true }} renderOrder={28}>
      {tubeGeom && (
        <mesh
          geometry={tubeGeom}
          onPointerDown={onCurveDown}
          userData={{ splitBezierEdit: true }}
        >
          <meshBasicMaterial
            color={COLORS.cut}
            transparent
            opacity={0.01}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {handleLines && (
        <lineSegments geometry={handleLines} raycast={() => {}}>
          <lineBasicMaterial color={HANDLE_COLOR} depthTest={false} />
        </lineSegments>
      )}
      {nodes.map((n, i) => (
        <group key={`n-${i}`}>
          {n.in && offsetVisible(n.in) && (
            <mesh
              position={handleWorld(n, 'in')}
              userData={{ splitBezierEdit: true }}
              onPointerDown={(e) => onHandleDown(e, i, 'in')}
            >
              <sphereGeometry args={[handleR, 10, 10]} />
              <meshBasicMaterial color={HANDLE_COLOR} depthTest={false} />
            </mesh>
          )}
          {n.out && offsetVisible(n.out) && (
            <mesh
              position={handleWorld(n, 'out')}
              userData={{ splitBezierEdit: true }}
              onPointerDown={(e) => onHandleDown(e, i, 'out')}
            >
              <sphereGeometry args={[handleR, 10, 10]} />
              <meshBasicMaterial color={HANDLE_COLOR} depthTest={false} />
            </mesh>
          )}
          <mesh
            position={[n.x, n.y, n.z]}
            userData={{ splitBezierEdit: true }}
            onPointerDown={(e) => onAnchorDown(e, i)}
            onDoubleClick={(e) => onAnchorDouble(e, i)}
          >
            {hasHandles(n) ? (
              <sphereGeometry args={[r, 12, 12]} />
            ) : (
              <boxGeometry args={[r * 1.7, r * 1.7, r * 1.7]} />
            )}
            <meshBasicMaterial color={COLORS.vertex} depthTest={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function offsetVisible(o: { x: number; y: number; z: number }): boolean {
  return o.x * o.x + o.y * o.y + o.z * o.z > 1e-8
}
