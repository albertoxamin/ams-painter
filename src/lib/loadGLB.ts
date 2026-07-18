import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ensureFloatGeometry } from './normalizeGeometry'

/**
 * Parse a GLB ArrayBuffer into a single merged BufferGeometry.
 * All mesh nodes in the scene graph are combined with their world transforms.
 */
export async function loadGLBGeometry(
  buffer: ArrayBuffer,
): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader()
  const gltf = await new Promise<{
    scene: THREE.Group
  }>((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (g) => resolve(g),
      (e) => reject(e),
    )
  })

  const geoms: THREE.BufferGeometry[] = []
  gltf.scene.updateMatrixWorld(true)

  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mesh = obj as THREE.Mesh
    if (!mesh.geometry?.getAttribute('position')) return
    const g = ensureFloatGeometry(mesh.geometry)
    g.applyMatrix4(mesh.matrixWorld)
    geoms.push(g)
  })

  if (geoms.length === 0) {
    throw new Error('GLB contains no mesh geometry')
  }

  const merged =
    geoms.length === 1 ? geoms[0]! : mergeGeometries(geoms, false)
  if (!merged) {
    throw new Error('Failed to merge GLB meshes')
  }

  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}
