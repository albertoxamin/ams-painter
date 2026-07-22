import type * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'

export interface Model {
  geometry: THREE.BufferGeometry
  bvh: MeshBVH
  /** triangle count */
  count: number
  /** edge-adjacent triangle neighbors (by position), cached at load */
  adjacency: number[][]
  /** z bounds in model-local space (model is dropped to bed z=0) */
  zMin: number
  zMax: number
  name: string
  /** Content hash of source STL bytes (for autosave / project matching). */
  meshHash: string
}
