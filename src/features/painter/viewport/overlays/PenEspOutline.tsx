import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { type InsertMeta } from '../../../../lib/extrude'
import { penLoopEspSegments } from '../../../../lib/penCutout'

export function PenEspOutline({
  geom,
  loop,
  meta,
  color,
}: {
  geom: THREE.BufferGeometry
  loop: THREE.Vector3[]
  meta: InsertMeta
  color: string
}) {
  const loopKey = useMemo(
    () => loop.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`).join('|'),
    [loop],
  )
  const edgeGeom = useMemo(() => {
    if (loop.length < 2) return null
    const pos = penLoopEspSegments(geom, loop, meta)
    if (!pos) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
    // loopKey stabilizes deps when loop is re-instantiated each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, loopKey, meta.axis, meta.floor, meta.entry])

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
