import { useMemo } from 'react'
import * as THREE from 'three'
import { COLORS } from '../constants'
import {
  fromUV,
  toUV,
  type SplitLockAxis,
} from '../../../../lib/clipAlongSpline'
import {
  cloneNode,
  cornerAt,
  handleWorld,
  hasHandles,
  sampleSplitPath,
  type SplitPathNode,
} from '../../../../lib/splitBezier'

export function SplitSplineOverlay({
  nodes,
  cursor,
  lock,
  bbox,
  showAnchors = true,
  showHandles = true,
}: {
  nodes: SplitPathNode[]
  cursor?: THREE.Vector3 | null
  lock: SplitLockAxis
  bbox: THREE.Box3
  showAnchors?: boolean
  showHandles?: boolean
}) {
  const sampled = useMemo(() => {
    const path =
      cursor && nodes.length > 0
        ? [...nodes.map(cloneNode), cornerAt(cursor)]
        : nodes
    return sampleSplitPath(path)
  }, [nodes, cursor])

  const lineGeom = useMemo(() => {
    if (sampled.length < 2) return null
    const pos: number[] = []
    for (let i = 0; i < sampled.length - 1; i++) {
      const a = sampled[i]!
      const b = sampled[i + 1]!
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [sampled])

  const ribbonGeom = useMemo(() => {
    if (sampled.length < 2) return null
    const c0 = toUV(bbox.min, lock)
    const c1 = toUV(bbox.max, lock)
    const w0 = Math.min(c0.w, c1.w)
    const w1 = Math.max(c0.w, c1.w)
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i < sampled.length; i++) {
      const uv = toUV(sampled[i]!, lock)
      const a = fromUV(uv.u, uv.v, w0, lock)
      const b = fromUV(uv.u, uv.v, w1, lock)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
      if (i > 0) {
        const i0 = (i - 1) * 2
        idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [sampled, lock, bbox])

  const handleLines = useMemo(() => {
    if (!showHandles) return null
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
  }, [nodes, showHandles])

  const handleDots = useMemo(() => {
    if (!showHandles) return [] as { key: string; p: THREE.Vector3 }[]
    const out: { key: string; p: THREE.Vector3 }[] = []
    nodes.forEach((n, i) => {
      if (n.in && n.in.x ** 2 + n.in.y ** 2 + n.in.z ** 2 > 1e-8) {
        out.push({ key: `hin-${i}`, p: handleWorld(n, 'in') })
      }
      if (n.out && n.out.x ** 2 + n.out.y ** 2 + n.out.z ** 2 > 1e-8) {
        out.push({ key: `hout-${i}`, p: handleWorld(n, 'out') })
      }
    })
    return out
  }, [nodes, showHandles])

  const dots = useMemo(() => {
    if (!showAnchors) return [] as THREE.Vector3[]
    const pts = nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z))
    if (cursor) pts.push(cursor)
    return pts
  }, [nodes, cursor, showAnchors])

  return (
    <group>
      {ribbonGeom && (
        <mesh geometry={ribbonGeom} raycast={() => {}}>
          <meshBasicMaterial
            color={COLORS.cut}
            transparent
            opacity={0.16}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {lineGeom && (
        <lineSegments geometry={lineGeom} raycast={() => {}}>
          <lineBasicMaterial color={COLORS.cut} depthTest={false} />
        </lineSegments>
      )}
      {handleLines && (
        <lineSegments geometry={handleLines} raycast={() => {}}>
          <lineBasicMaterial color="#7dd3fc" depthTest={false} />
        </lineSegments>
      )}
      {handleDots.map(({ key, p }) => (
        <mesh key={key} position={p} raycast={() => {}}>
          <sphereGeometry args={[0.32, 8, 8]} />
          <meshBasicMaterial color="#7dd3fc" depthTest={false} />
        </mesh>
      ))}
      {dots.map((p, i) => (
        <mesh key={i} position={p} raycast={() => {}}>
          <sphereGeometry args={[0.45, 10, 10]} />
          <meshBasicMaterial color={COLORS.cut} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}
