import type * as THREE from 'three'
import { analyzeTopology, toIndexedMesh } from './meshTopology'

export interface MeshCheckResult {
  nakedEdges: number
  planarHoles: number
  nonPlanarHoles: number
  nonManifoldEdges: number
  invertedNormals: number
  duplicateFaces: number
  degenerateFaces: number
  disjointShells: number
}

export interface MeshAnalysis {
  checks: MeshCheckResult
  triangleCount: number
  ok: boolean
}

export const CHECK_LABELS: { key: keyof MeshCheckResult; label: string }[] = [
  { key: 'nakedEdges', label: 'Naked edges' },
  { key: 'planarHoles', label: 'Planar holes' },
  { key: 'nonPlanarHoles', label: 'Non-planar holes' },
  { key: 'nonManifoldEdges', label: 'Non-manifold edges' },
  { key: 'invertedNormals', label: 'Inverted normals' },
  { key: 'duplicateFaces', label: 'Duplicate faces' },
  { key: 'degenerateFaces', label: 'Degenerate faces' },
  { key: 'disjointShells', label: 'Disjoint shells' },
]

export function analyzeMesh(geom: THREE.BufferGeometry): MeshAnalysis {
  const mesh = toIndexedMesh(geom)
  const topo = analyzeTopology(mesh)
  const checks: MeshCheckResult = {
    nakedEdges: topo.nakedEdges,
    planarHoles: topo.planarHoles,
    nonPlanarHoles: topo.nonPlanarHoles,
    nonManifoldEdges: topo.nonManifoldEdges,
    invertedNormals: topo.invertedNormals,
    duplicateFaces: topo.duplicateFaces,
    degenerateFaces: topo.degenerateFaces,
    disjointShells: topo.disjointShells,
  }
  return {
    checks,
    triangleCount: mesh.triCount,
    ok: Object.values(checks).every((v) => v === 0),
  }
}
