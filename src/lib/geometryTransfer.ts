import * as THREE from 'three'
import { materializeDrawRange } from './manifoldOps'

export interface PackedGeometry {
  positions: Float32Array
  /** Triangle indices; omitted for non-indexed triangle soup. */
  index?: Uint32Array
}

/** Copy geometry into standalone typed arrays (safe for worker postMessage). */
export function packGeometry(geom: THREE.BufferGeometry): PackedGeometry {
  const clean = materializeDrawRange(geom)
  const pos = clean.getAttribute('position') as THREE.BufferAttribute
  const positions = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i)
    positions[i * 3 + 1] = pos.getY(i)
    positions[i * 3 + 2] = pos.getZ(i)
  }

  const idxAttr = clean.index
  if (!idxAttr) {
    return { positions }
  }

  const index = new Uint32Array(idxAttr.count)
  for (let i = 0; i < idxAttr.count; i++) {
    index[i] = idxAttr.getX(i)
  }
  return { positions, index }
}

export function unpackGeometry(packed: PackedGeometry): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute(
    'position',
    new THREE.BufferAttribute(packed.positions, 3),
  )
  if (packed.index && packed.index.length > 0) {
    geom.setIndex(new THREE.BufferAttribute(packed.index, 1))
  }
  geom.setDrawRange(0, Infinity)
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  return geom
}

export function stableSet(arr: Iterable<number>): number[] {
  return [...arr].sort((a, b) => a - b)
}
