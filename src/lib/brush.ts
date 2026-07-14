import * as THREE from 'three'

/**
 * Return triangle indices whose centroid lies within `radius` of `point`
 * (model-local space). Used by the selection brush.
 */
export function facesNearPoint(
  geom: THREE.BufferGeometry,
  point: THREE.Vector3,
  radius: number,
): number[] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const triCount = pos.count / 3
  const r2 = radius * radius
  const out: number[] = []
  const c = new THREE.Vector3()
  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    c.set(
      (pos.getX(a) + pos.getX(a + 1) + pos.getX(a + 2)) / 3,
      (pos.getY(a) + pos.getY(a + 1) + pos.getY(a + 2)) / 3,
      (pos.getZ(a) + pos.getZ(a + 1) + pos.getZ(a + 2)) / 3,
    )
    if (c.distanceToSquared(point) <= r2) out.push(t)
  }
  return out
}
