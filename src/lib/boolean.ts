import * as THREE from 'three'
import { manifoldSubtract, manifoldUnion } from './manifoldOps'

/**
 * Subtract `cutter` from `target` (e.g. cut the insert hole through the upper).
 */
export async function subtractSolid(
  target: THREE.BufferGeometry,
  cutter: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  return manifoldSubtract(target, cutter)
}

/**
 * Boolean-union two solids (e.g. merge the insert into the bottom part).
 */
export async function unionSolid(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  return manifoldUnion(a, b)
}

/** @deprecated use subtractSolid */
export const cutRecess = subtractSolid
