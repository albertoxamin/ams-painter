import * as THREE from 'three'
import { getCentroidGrid } from './centroidGrid'

/**
 * Return triangle indices whose centroid lies within `radius` of `point`
 * (model-local space). Uses a spatial grid for fast queries on large meshes.
 */
export function facesNearPoint(
  geom: THREE.BufferGeometry,
  point: THREE.Vector3,
  radius: number,
): number[] {
  if (radius <= 0.05) return []
  return getCentroidGrid(geom).querySphere(point, radius)
}

export function facesInScreenRect(
  geom: THREE.BufferGeometry,
  camera: THREE.Camera,
  domElement: HTMLElement,
  rect: { x0: number; y0: number; x1: number; y1: number },
): number[] {
  return getCentroidGrid(geom).queryScreenRect(camera, domElement, rect, {
    frontFacingOnly: true,
  })
}
