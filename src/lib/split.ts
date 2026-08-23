import * as THREE from 'three'
import { clipToSide } from './clipAtHeight'
import {
  clipToSplineSide,
  type SplitLockAxis,
} from './clipAlongSpline'

export type { SplitLockAxis }
export type SplitMode = 'height' | 'spline'

/**
 * Split at height H.
 *
 * Both sides are plane-clipped and capped at the cut. Window holes in the
 * original skin stay open (no cavity fill). Hollow CSG is avoided because it
 * left non-manifold edges that Bambu Studio rejects.
 */
export async function splitAtHeight(
  geom: THREE.BufferGeometry,
  H: number,
  clearance = 0,
  onProgress?: (pct: number) => void,
): Promise<{ lower: THREE.BufferGeometry; upper: THREE.BufferGeometry }> {
  const kerf = Math.max(0, clearance) / 2
  const lowerH = H - kerf
  const upperH = H + kerf
  onProgress?.(0.2)
  const lower = clipToSide(geom, lowerH, 'below')
  onProgress?.(0.6)
  const upper = clipToSide(geom, upperH, 'above', {
    cap: true,
    fillCavities: false,
  })
  onProgress?.(1)
  return { lower, upper }
}

export async function splitAlongSpline(
  geom: THREE.BufferGeometry,
  lock: SplitLockAxis,
  spline: THREE.Vector3[],
  clearance = 0,
  onProgress?: (pct: number) => void,
): Promise<{ lower: THREE.BufferGeometry; upper: THREE.BufferGeometry }> {
  const kerf = Math.max(0, clearance) / 2
  onProgress?.(0.2)
  const lower = clipToSplineSide(geom, lock, spline, 'below', {
    cap: true,
    vOffset: -kerf,
  })
  onProgress?.(0.6)
  const upper = clipToSplineSide(geom, lock, spline, 'above', {
    cap: true,
    vOffset: kerf,
  })
  onProgress?.(1)
  return { lower, upper }
}
