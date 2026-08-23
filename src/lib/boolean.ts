import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBVH } from 'three-mesh-bvh'
import {
  manifoldSubtract,
  manifoldUnion,
  manifoldIntersect,
  materializeDrawRange,
} from './manifoldOps'

function positionOnly(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = materializeDrawRange(geom)
  const soup = g.index ? g.toNonIndexed() : g
  for (const name of Object.keys(soup.attributes)) {
    if (name !== 'position') soup.deleteAttribute(name)
  }
  return soup
}

function mergeSoup(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const merged = mergeGeometries([positionOnly(a), positionOnly(b)], false)
  if (!merged) {
    console.warn('mergeSolids failed; concatenating position buffers')
    return concatPositions(a, b)
  }
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function concatPositions(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const pa = positionOnly(a).getAttribute('position') as THREE.BufferAttribute
  const pb = positionOnly(b).getAttribute('position') as THREE.BufferAttribute
  const out = new Float32Array(pa.count * 3 + pb.count * 3)
  out.set(pa.array as Float32Array, 0)
  out.set(pb.array as Float32Array, pa.count * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(out, 3))
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** Concatenate two meshes into one STL (separate shells, no boolean). */
export function mergeSolids(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry {
  return mergeSoup(a, b)
}

function centroidInside(
  bvh: MeshBVH,
  x: number,
  y: number,
  z: number,
): boolean {
  const ray = new THREE.Ray(
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(1, 0.031, 0.017).normalize(),
  )
  const hits = bvh.raycast(ray, THREE.DoubleSide)
  return hits.length % 2 === 1
}

/** Drop target triangles whose centroid lies inside the cutter. */
function punchByCentroid(
  target: THREE.BufferGeometry,
  cutter: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const g = positionOnly(target)
  const cutterBvh = new MeshBVH(positionOnly(cutter), {
    maxDepth: 32,
    indirect: true,
    verbose: false,
  })
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const idx = g.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const corner = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c)
  const keep: number[] = []
  for (let t = 0; t < triCount; t++) {
    const i0 = corner(t, 0)
    const i1 = corner(t, 1)
    const i2 = corner(t, 2)
    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3
    if (centroidInside(cutterBvh, cx, cy, cz)) continue
    keep.push(
      pos.getX(i0),
      pos.getY(i0),
      pos.getZ(i0),
      pos.getX(i1),
      pos.getY(i1),
      pos.getZ(i1),
      pos.getX(i2),
      pos.getY(i2),
      pos.getZ(i2),
    )
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3))
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/**
 * Subtract `cutter` from `target` (e.g. cut the insert hole through the upper).
 */
export async function subtractSolid(
  target: THREE.BufferGeometry,
  cutter: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  try {
    return await manifoldSubtract(target, cutter)
  } catch {
    return punchByCentroid(target, cutter)
  }
}

/**
 * Boolean-union two solids (e.g. merge the insert into the bottom part).
 */
export async function unionSolid(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  try {
    return await manifoldUnion(a, b)
  } catch {
    return mergeSoup(a, b)
  }
}

/**
 * Boolean-intersect two solids (e.g. clip the model to a pen-loop prism).
 */
export async function intersectSolid(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  return manifoldIntersect(a, b)
}

/** @deprecated use subtractSolid */
export const cutRecess = subtractSolid
