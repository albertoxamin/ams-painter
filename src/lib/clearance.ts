import * as THREE from 'three'
import type { CutAxis } from './extrude'
import { axisLetter } from './extrude'

/**
 * Scale a geometry in the two axes perpendicular to `cutAxis`, about bbox center.
 * `deltaPerSide` > 0 expands, < 0 shrinks. The cut-axis coordinate is unchanged
 * so column depth/height stays the same.
 */
export function scalePerpByClearance(
  geom: THREE.BufferGeometry,
  deltaPerSide: number,
  cutAxis: CutAxis = '-z',
): THREE.BufferGeometry {
  if (Math.abs(deltaPerSide) < 1e-9) return geom.clone()

  const out = geom.clone()
  out.computeBoundingBox()
  const box = out.boundingBox!
  const letter = axisLetter(cutAxis)
  const axes = (['x', 'y', 'z'] as const).filter((a) => a !== letter)

  const centers = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  }
  const sizes = {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  }

  const minSize = Math.max(0.05, Math.abs(deltaPerSide) * 2 + 0.05)
  const scales = { x: 1, y: 1, z: 1 }
  for (const a of axes) {
    scales[a] = sizes[a] > minSize ? (sizes[a] + 2 * deltaPerSide) / sizes[a] : 1
    if (scales[a] <= 0) return out
  }

  const pos = out.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    pos.setXYZ(
      i,
      centers.x + (x - centers.x) * scales.x,
      centers.y + (y - centers.y) * scales.y,
      centers.z + (z - centers.z) * scales.z,
    )
  }
  pos.needsUpdate = true
  out.computeBoundingBox()
  out.computeBoundingSphere()
  out.computeVertexNormals()
  return out
}

/** @deprecated use scalePerpByClearance */
export function scaleXYByClearance(
  geom: THREE.BufferGeometry,
  deltaPerSide: number,
): THREE.BufferGeometry {
  return scalePerpByClearance(geom, deltaPerSide, '-z')
}
