import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import Module from 'manifold-3d'

type ManifoldCtor = {
  new (mesh: unknown): ManifoldSolid
  union(...args: ManifoldSolid[]): ManifoldSolid
  difference(...args: ManifoldSolid[]): ManifoldSolid
  intersection(...args: ManifoldSolid[]): ManifoldSolid
  cube(size?: number | [number, number, number], center?: boolean): ManifoldSolid
}

type MeshCtor = {
  new (args: {
    numProp: number
    vertProperties: Float32Array
    triVerts: Uint32Array
  }): ManifoldMesh
}

type ManifoldSolid = {
  getMesh: (normalIdx?: number) => {
    numProp: number
    vertProperties: Float32Array
    triVerts: Uint32Array
  }
  delete: () => void
  translate: (offset: [number, number, number]) => ManifoldSolid
}

type ManifoldMesh = {
  merge: () => boolean
}

let ready: Promise<{ Manifold: ManifoldCtor; Mesh: MeshCtor }> | null = null

async function api() {
  if (!ready) {
    ready = (async () => {
      // In the browser Vite needs an explicit WASM URL. In Node, manifold
      // resolves manifold.wasm next to its own package — don't override that.
      const opts: { locateFile?: (path: string) => string } = {}
      if (typeof document !== 'undefined') {
        const { default: wasmUrl } = await import(
          'manifold-3d/manifold.wasm?url'
        )
        opts.locateFile = () => wasmUrl as string
      }
      // manifold's Module typing requires locateFile, but it's optional at runtime
      const wasm = await Module(opts as { locateFile: () => string })
      await wasm.setup()
      return {
        Manifold: wasm.Manifold as unknown as ManifoldCtor,
        Mesh: wasm.Mesh as unknown as MeshCtor,
      }
    })()
  }
  return ready
}

/** Eagerly load WASM (call once at app start). */
export function preloadManifold(): Promise<void> {
  return api().then(() => undefined)
}

/**
 * Convert a Three geometry into a Manifold solid.
 * Welds near-coincident verts first so STL triangle-soup becomes 2-manifold.
 */
export async function geomToManifold(
  geom: THREE.BufferGeometry,
): Promise<ManifoldSolid> {
  const { Manifold, Mesh } = await api()
  const prepared = prepareForManifold(geom)
  const pos = prepared.getAttribute('position') as THREE.BufferAttribute
  const idx = prepared.index!

  const vertProperties = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    vertProperties[i * 3] = pos.getX(i)
    vertProperties[i * 3 + 1] = pos.getY(i)
    vertProperties[i * 3 + 2] = pos.getZ(i)
  }
  const triVerts = new Uint32Array(idx.count)
  for (let i = 0; i < idx.count; i++) triVerts[i] = idx.getX(i)

  const mesh = new Mesh({
    numProp: 3,
    vertProperties,
    triVerts,
  })
  mesh.merge()
  try {
    return new Manifold(mesh)
  } catch (e) {
    throw new Error(
      `Mesh is not manifold (open/non-manifold edges). ${(e as Error).message || e}`,
    )
  }
}

/** Convert a Manifold solid back to a Three BufferGeometry. */
export async function manifoldToGeom(
  solid: ManifoldSolid,
): Promise<THREE.BufferGeometry> {
  const outMesh = solid.getMesh()
  const numProp = outMesh.numProp
  const verts = outMesh.vertProperties
  const tris = outMesh.triVerts
  const vertCount = verts.length / numProp

  const positions = new Float32Array(vertCount * 3)
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = verts[i * numProp]
    positions[i * 3 + 1] = verts[i * numProp + 1]
    positions[i * 3 + 2] = verts[i * numProp + 2]
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(Array.from(tris))
  geom.computeVertexNormals()
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  // Clear any leftover drawRange semantics
  geom.setDrawRange(0, Infinity)
  return geom
}

function prepareForManifold(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  // Materialize drawRange (three-bvh-csg leftover) into a real index buffer
  let g = materializeDrawRange(geom)
  // Drop non-position attrs so mergeVertices can weld freely
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name)
  }
  if (!g.getIndex()) {
    // mergeVertices requires an index; build a trivial one for triangle soup
    const n = (g.getAttribute('position') as THREE.BufferAttribute).count
    const index = new Uint32Array(n)
    for (let i = 0; i < n; i++) index[i] = i
    g.setIndex(new THREE.BufferAttribute(index, 1))
  }
  // Weld duplicates from STL / CSG T-vertices
  g = mergeVertices(g, 1e-4)
  // Remove zero-area triangles
  g = removeDegenerateTriangles(g)
  return g
}

/** Copy only the active drawRange into a fresh geometry (no drawRange tricks). */
export function materializeDrawRange(
  geom: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  if (!pos) return geom.clone()

  const start = geom.drawRange.start
  const count =
    geom.drawRange.count === Infinity || geom.drawRange.count == null
      ? (geom.index ? geom.index.count : pos.count) - start
      : geom.drawRange.count

  if (start === 0 && count === (geom.index ? geom.index.count : pos.count)) {
    const clone = geom.clone()
    clone.setDrawRange(0, Infinity)
    return clone
  }

  const out = new THREE.BufferGeometry()
  if (geom.index) {
    const idx = geom.index
    const newIndex: number[] = []
    const vertMap = new Map<number, number>()
    const positions: number[] = []
    const mapVert = (i: number) => {
      const existing = vertMap.get(i)
      if (existing !== undefined) return existing
      const n = positions.length / 3
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      vertMap.set(i, n)
      return n
    }
    for (let i = 0; i < count; i++) {
      newIndex.push(mapVert(idx.getX(start + i)))
    }
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    out.setIndex(newIndex)
  } else {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const s = start + i
      positions[i * 3] = pos.getX(s)
      positions[i * 3 + 1] = pos.getY(s)
      positions[i * 3 + 2] = pos.getZ(s)
    }
    out.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  }
  out.setDrawRange(0, Infinity)
  return out
}

function removeDegenerateTriangles(
  geom: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const idx = geom.index
  if (!idx) return geom

  const good: number[] = []
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t)
    const i1 = idx.getX(t + 1)
    const i2 = idx.getX(t + 2)
    if (i0 === i1 || i1 === i2 || i0 === i2) continue
    const ax = pos.getX(i0),
      ay = pos.getY(i0),
      az = pos.getZ(i0)
    const bx = pos.getX(i1),
      by = pos.getY(i1),
      bz = pos.getZ(i1)
    const cx = pos.getX(i2),
      cy = pos.getY(i2),
      cz = pos.getZ(i2)
    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az
    const acx = cx - ax,
      acy = cy - ay,
      acz = cz - az
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    if (nx * nx + ny * ny + nz * nz < 1e-20) continue
    good.push(i0, i1, i2)
  }
  if (good.length === idx.count) return geom
  const out = geom.clone()
  out.setIndex(good)
  return out
}

export async function manifoldUnion(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  const { Manifold } = await api()
  const ma = await geomToManifold(a)
  const mb = await geomToManifold(b)
  const result = Manifold.union(ma, mb)
  ma.delete()
  mb.delete()
  const geom = await manifoldToGeom(result)
  result.delete()
  return geom
}

export async function manifoldSubtract(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  const { Manifold } = await api()
  const ma = await geomToManifold(a)
  const mb = await geomToManifold(b)
  const result = Manifold.difference(ma, mb)
  ma.delete()
  mb.delete()
  const geom = await manifoldToGeom(result)
  result.delete()
  return geom
}

export async function manifoldIntersect(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  const { Manifold } = await api()
  const ma = await geomToManifold(a)
  const mb = await geomToManifold(b)
  const result = Manifold.intersection(ma, mb)
  ma.delete()
  mb.delete()
  const geom = await manifoldToGeom(result)
  result.delete()
  return geom
}

/** Axis-aligned box as a Manifold, then to Three geometry. */
export async function boxGeometry(
  min: THREE.Vector3,
  max: THREE.Vector3,
): Promise<THREE.BufferGeometry> {
  const { Manifold } = await api()
  const size: [number, number, number] = [
    Math.max(max.x - min.x, 1e-6),
    Math.max(max.y - min.y, 1e-6),
    Math.max(max.z - min.z, 1e-6),
  ]
  const cube = Manifold.cube(size, false)
  const solid = cube.translate([min.x, min.y, min.z])
  cube.delete()
  const geom = await manifoldToGeom(solid)
  solid.delete()
  return geom
}

/**
 * Round-trip a geometry through Manifold so the result is guaranteed
 * 2-manifold (welds verts, drops degenerates, orients consistently).
 */
export async function ensureManifoldSolid(
  geom: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  const solid = await geomToManifold(geom)
  const out = await manifoldToGeom(solid)
  solid.delete()
  return out
}
