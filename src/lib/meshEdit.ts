import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { intersectSolid, subtractSolid, unionSolid } from './boolean'

export type MeshBooleanOp = 'subtract' | 'union' | 'intersect'

function posKey(pos: THREE.BufferAttribute, i: number): string {
  return `${pos.getX(i).toFixed(5)}_${pos.getY(i).toFixed(5)}_${pos.getZ(i).toFixed(5)}`
}

/** Vertex indices of the selected faces, including corners welded by position. */
export function weldedVertexIndices(
  geom: THREE.BufferGeometry,
  faces: Iterable<number>,
): number[] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const keys = new Set<string>()
  for (const t of faces) {
    const a = t * 3
    for (let c = 0; c < 3; c++) keys.add(posKey(pos, a + c))
  }
  const indices: number[] = []
  for (let i = 0; i < pos.count; i++) {
    if (keys.has(posKey(pos, i))) indices.push(i)
  }
  return indices
}

export function capturePositions(
  geom: THREE.BufferGeometry,
  indices: number[],
): Float32Array {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const base = new Float32Array(indices.length * 3)
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k]!
    base[k * 3] = pos.getX(i)
    base[k * 3 + 1] = pos.getY(i)
    base[k * 3 + 2] = pos.getZ(i)
  }
  return base
}

/** Write base + delta into the captured vertices. Face indices stay the same. */
export function applyCapturedMove(
  geom: THREE.BufferGeometry,
  indices: number[],
  base: Float32Array,
  delta: THREE.Vector3,
): void {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  for (let k = 0; k < indices.length; k++) {
    pos.setXYZ(
      indices[k]!,
      base[k * 3]! + delta.x,
      base[k * 3 + 1]! + delta.y,
      base[k * 3 + 2]! + delta.z,
    )
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()
  geom.computeBoundingBox()
}

export function selectionCentroid(
  geom: THREE.BufferGeometry,
  faces: Iterable<number>,
): THREE.Vector3 {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const c = new THREE.Vector3()
  let n = 0
  for (const t of faces) {
    const a = t * 3
    for (let i = 0; i < 3; i++) {
      c.x += pos.getX(a + i)
      c.y += pos.getY(a + i)
      c.z += pos.getZ(a + i)
      n++
    }
  }
  if (n > 0) c.multiplyScalar(1 / n)
  return c
}

export function primitiveGeometry(
  kind: 'box' | 'sphere',
  center: THREE.Vector3,
  size: number,
): THREE.BufferGeometry {
  const geom =
    kind === 'box'
      ? new THREE.BoxGeometry(size, size, size)
      : new THREE.SphereGeometry(size / 2, 24, 16)
  geom.translate(center.x, center.y, center.z)
  const soup = geom.index ? geom.toNonIndexed() : geom
  soup.computeVertexNormals()
  soup.computeBoundingBox()
  return soup
}

export function stlBufferToGeometry(buffer: ArrayBuffer): THREE.BufferGeometry {
  const geom = new STLLoader().parse(buffer)
  const soup = geom.index ? geom.toNonIndexed() : geom
  soup.computeVertexNormals()
  soup.computeBoundingBox()
  return soup
}

/** Place `geom` so its bounding-box center sits on `center`. */
export function centerGeometryOn(
  geom: THREE.BufferGeometry,
  center: THREE.Vector3,
): THREE.BufferGeometry {
  const g = geom.clone()
  g.computeBoundingBox()
  const box = g.boundingBox!
  g.translate(
    center.x - (box.min.x + box.max.x) / 2,
    center.y - (box.min.y + box.max.y) / 2,
    center.z - (box.min.z + box.max.z) / 2,
  )
  g.computeBoundingBox()
  return g
}

export async function applyMeshBoolean(
  target: THREE.BufferGeometry,
  cutter: THREE.BufferGeometry,
  op: MeshBooleanOp,
): Promise<THREE.BufferGeometry> {
  if (op === 'subtract') return subtractSolid(target, cutter)
  if (op === 'intersect') return intersectSolid(target, cutter)
  return unionSolid(target, cutter)
}
