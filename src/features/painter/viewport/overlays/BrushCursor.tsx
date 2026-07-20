import * as THREE from 'three'
import { COLORS } from '../constants'

/** Ring showing brush radius at the hovered face centroid. */
export function BrushCursor({
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
