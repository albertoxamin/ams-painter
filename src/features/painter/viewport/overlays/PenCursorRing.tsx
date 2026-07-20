import { useMemo } from 'react'
import * as THREE from 'three'

/** X-ray wire outline of an insert curtain (surface → floor), always on top. */
export function PenCursorRing({
  geom,
  point,
  faceIndex,
  color,
  size,
}: {
  geom: THREE.BufferGeometry
  point: THREE.Vector3
  faceIndex: number | null
  color: string
  size: number
}) {
  const quat = useMemo(() => {
    if (faceIndex == null) return new THREE.Quaternion()
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const a = faceIndex * 3
    const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
    const v1 = new THREE.Vector3(
      pos.getX(a + 1),
      pos.getY(a + 1),
      pos.getZ(a + 2),
    )
    const v2 = new THREE.Vector3(
      pos.getX(a + 2),
      pos.getY(a + 2),
      pos.getZ(a + 2),
    )
    const n = new THREE.Vector3()
      .subVectors(v1, v0)
      .cross(new THREE.Vector3().subVectors(v2, v0))
      .normalize()
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      n.lengthSq() > 1e-12 ? n : new THREE.Vector3(0, 0, 1),
    )
  }, [geom, faceIndex])

  return (
    <mesh position={point} quaternion={quat} raycast={() => {}} renderOrder={26}>
      <ringGeometry args={[size * 0.55, size, 32]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}
