import { useMemo } from 'react'
import * as THREE from 'three'
import { COLORS } from '../constants'

/** Outline-only preview of the triangle currently under the cursor. */
export function HoverOutline({
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
