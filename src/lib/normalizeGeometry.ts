import * as THREE from 'three'

/**
 * Convert interleaved / quantized GLTF attributes into plain Float32 positions.
 * Required before applyMatrix4, mergeGeometries, or mergeVertices — those
 * break on KHR_mesh_quantization (common in Meshy exports).
 */
export function ensureFloatGeometry(
  geom: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const pos = geom.getAttribute('position')
  if (!pos) throw new Error('Geometry has no position attribute')

  if (
    !(pos instanceof THREE.InterleavedBufferAttribute) &&
    pos.array instanceof Float32Array
  ) {
    return geom
  }

  const out = new THREE.BufferGeometry()
  const arr = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    arr[i * 3] = pos.getX(i)
    arr[i * 3 + 1] = pos.getY(i)
    arr[i * 3 + 2] = pos.getZ(i)
  }
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  if (geom.index) out.setIndex(geom.index.clone())
  return out
}
