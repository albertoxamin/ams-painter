import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { Model } from '../state'
import { buildAdjacency } from './select'

/**
 * Turn a BufferGeometry into a viewport-ready Model.
 * Converts to non-indexed triangles, centers XY, drops to bed (min z = 0),
 * builds BVH and adjacency.
 */
export function geometryToModel(
  geom: THREE.BufferGeometry,
  name: string,
): Model {
  let g = geom.clone()
  if (!g.getAttribute('position')) {
    throw new Error('Geometry has no position data')
  }

  if (g.index) {
    g = g.toNonIndexed()
  }

  g.computeVertexNormals()

  g.computeBoundingBox()
  const box = g.boundingBox!
  const cx = (box.min.x + box.max.x) / 2
  const cy = (box.min.y + box.max.y) / 2
  g.translate(-cx, -cy, -box.min.z)

  g.computeBoundingBox()
  const zMin = g.boundingBox!.min.z
  const zMax = g.boundingBox!.max.z

  const bvh = new MeshBVH(g, {
    maxDepth: 32,
    verbose: false,
    indirect: true,
  })

  const count = g.getAttribute('position').count / 3
  const adjacency = buildAdjacency(g)
  return { geometry: g, bvh, count, adjacency, zMin, zMax, name }
}
