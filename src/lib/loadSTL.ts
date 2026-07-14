import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { MeshBVH } from 'three-mesh-bvh'
import type { Model } from '../state'
import { buildAdjacency } from './select'

/**
 * Parse an STL ArrayBuffer into a Model ready for the viewport.
 * STL convention: Z is up.
 * - converts to non-indexed triangles (so face index === triangle index)
 * - centers in XY and drops onto the bed (min z = 0)
 * - builds a BVH for fast raycasting
 * - caches triangle adjacency for selection island counting
 */
export function loadSTL(buffer: ArrayBuffer, name: string): Model {
  const loader = new STLLoader()
  let geom = loader.parse(buffer)
  if (!geom.getAttribute('position')) {
    throw new Error('STL has no geometry data')
  }

  // non-indexed so that triangle i always lives at positions [i*3 .. i*3+2]
  if (geom.index) {
    geom = geom.toNonIndexed()
  }

  geom.computeVertexNormals()

  // Center XY and drop to bed (min z = 0)
  geom.computeBoundingBox()
  const box = geom.boundingBox!
  const cx = (box.min.x + box.max.x) / 2
  const cy = (box.min.y + box.max.y) / 2
  geom.translate(-cx, -cy, -box.min.z)

  geom.computeBoundingBox()
  const zMin = geom.boundingBox!.min.z
  const zMax = geom.boundingBox!.max.z

  // Use indirect BVH so three-mesh-bvh does NOT rewrite geometry.index /
  // reorder triangles. Reordering broke face picking: raycast faceIndex
  // no longer matched position[i*3..i*3+2] used by selection + extrude.
  const bvh = new MeshBVH(geom, {
    maxDepth: 32,
    verbose: false,
    indirect: true,
  })

  const count = geom.getAttribute('position').count / 3
  const adjacency = buildAdjacency(geom)
  return { geometry: geom, bvh, count, adjacency, zMin, zMax, name }
}
