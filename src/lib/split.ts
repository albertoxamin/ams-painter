import * as THREE from 'three'
import {
  boxGeometry,
  manifoldIntersect,
} from './manifoldOps'

/**
 * Split a geometry at height H (model-local z) into lower and upper parts.
 * Uses Manifold CSG so results stay 2-manifold for slicers (Bambu, etc.).
 *
 * `clearance` (mm) opens a kerf at the seam: lower ends at H - clearance/2,
 * upper starts at H + clearance/2. Pass 0 for a flush cut.
 */
export async function splitAtHeight(
  geom: THREE.BufferGeometry,
  H: number,
  clearance = 0,
): Promise<{ lower: THREE.BufferGeometry; upper: THREE.BufferGeometry }> {
  geom.computeBoundingBox()
  const box = geom.boundingBox!
  const pad = 1.0
  const kerf = Math.max(0, clearance) / 2

  const min = new THREE.Vector3(box.min.x - pad, box.min.y - pad, box.min.z - pad)
  const max = new THREE.Vector3(box.max.x + pad, box.max.y + pad, box.max.z + pad)

  const lowerBox = await boxGeometry(
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, max.y, H - kerf),
  )
  const upperBox = await boxGeometry(
    new THREE.Vector3(min.x, min.y, H + kerf),
    new THREE.Vector3(max.x, max.y, max.z),
  )

  const lower = await manifoldIntersect(geom, lowerBox)
  const upper = await manifoldIntersect(geom, upperBox)
  lowerBox.dispose()
  upperBox.dispose()
  return { lower, upper }
}
