import * as THREE from 'three'

const gridCache = new WeakMap<THREE.BufferGeometry, CentroidGrid>()

/**
 * Uniform grid over triangle centroids for O(cells) brush queries
 * instead of scanning every triangle.
 */
export class CentroidGrid {
  private readonly cellSize: number
  private readonly buckets = new Map<string, number[]>()
  private readonly cx: Float32Array
  private readonly cy: Float32Array
  private readonly cz: Float32Array
  private readonly nx: Float32Array
  private readonly ny: Float32Array
  private readonly nz: Float32Array
  readonly triCount: number

  private constructor(
    cellSize: number,
    cx: Float32Array,
    cy: Float32Array,
    cz: Float32Array,
    nx: Float32Array,
    ny: Float32Array,
    nz: Float32Array,
    buckets: Map<string, number[]>,
  ) {
    this.cellSize = cellSize
    this.cx = cx
    this.cy = cy
    this.cz = cz
    this.nx = nx
    this.ny = ny
    this.nz = nz
    this.buckets = buckets
    this.triCount = cx.length
  }

  static build(geom: THREE.BufferGeometry): CentroidGrid {
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const triCount = pos.count / 3
    const cx = new Float32Array(triCount)
    const cy = new Float32Array(triCount)
    const cz = new Float32Array(triCount)
    const nx = new Float32Array(triCount)
    const ny = new Float32Array(triCount)
    const nz = new Float32Array(triCount)
    const e0 = new THREE.Vector3()
    const e1 = new THREE.Vector3()
    const n = new THREE.Vector3()

    geom.computeBoundingBox()
    const box = geom.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    const cellSize = Math.max(size.x, size.y, size.z, 1) / 64

    const buckets = new Map<string, number[]>()
    const key = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`

    for (let t = 0; t < triCount; t++) {
      const a = t * 3
      const x0 = pos.getX(a)
      const y0 = pos.getY(a)
      const z0 = pos.getZ(a)
      const x1 = pos.getX(a + 1)
      const y1 = pos.getY(a + 1)
      const z1 = pos.getZ(a + 1)
      const x2 = pos.getX(a + 2)
      const y2 = pos.getY(a + 2)
      const z2 = pos.getZ(a + 2)
      const x = (x0 + x1 + x2) / 3
      const y = (y0 + y1 + y2) / 3
      const z = (z0 + z1 + z2) / 3
      cx[t] = x
      cy[t] = y
      cz[t] = z
      e0.set(x1 - x0, y1 - y0, z1 - z0)
      e1.set(x2 - x0, y2 - y0, z2 - z0)
      n.crossVectors(e0, e1).normalize()
      nx[t] = n.x
      ny[t] = n.y
      nz[t] = n.z
      const ix = Math.floor(x / cellSize)
      const iy = Math.floor(y / cellSize)
      const iz = Math.floor(z / cellSize)
      const k = key(ix, iy, iz)
      let arr = buckets.get(k)
      if (!arr) {
        arr = []
        buckets.set(k, arr)
      }
      arr.push(t)
    }

    return new CentroidGrid(cellSize, cx, cy, cz, nx, ny, nz, buckets)
  }

  querySphere(point: THREE.Vector3, radius: number): number[] {
    const r2 = radius * radius
    const cs = this.cellSize
    const minIx = Math.floor((point.x - radius) / cs)
    const maxIx = Math.floor((point.x + radius) / cs)
    const minIy = Math.floor((point.y - radius) / cs)
    const maxIy = Math.floor((point.y + radius) / cs)
    const minIz = Math.floor((point.z - radius) / cs)
    const maxIz = Math.floor((point.z + radius) / cs)

    const out: number[] = []
    const px = point.x
    const py = point.y
    const pz = point.z

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const bucket = this.buckets.get(`${ix},${iy},${iz}`)
          if (!bucket) continue
          for (const t of bucket) {
            const dx = this.cx[t]! - px
            const dy = this.cy[t]! - py
            const dz = this.cz[t]! - pz
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(t)
          }
        }
      }
    }
    return out
  }

  /** All triangles whose centroid projects inside a screen-space rectangle. */
  queryScreenRect(
    camera: THREE.Camera,
    domElement: HTMLElement,
    rect: { x0: number; y0: number; x1: number; y1: number },
    options?: { frontFacingOnly?: boolean },
  ): number[] {
    const bounds = domElement.getBoundingClientRect()
    const w = bounds.width
    const h = bounds.height
    const minX = Math.min(rect.x0, rect.x1) - bounds.left
    const maxX = Math.max(rect.x0, rect.x1) - bounds.left
    const minY = Math.min(rect.y0, rect.y1) - bounds.top
    const maxY = Math.max(rect.y0, rect.y1) - bounds.top

    const v = new THREE.Vector3()
    const centroid = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const toCam = new THREE.Vector3()
    const out: number[] = []

    for (let t = 0; t < this.triCount; t++) {
      centroid.set(this.cx[t]!, this.cy[t]!, this.cz[t]!)

      if (options?.frontFacingOnly) {
        normal.set(this.nx[t]!, this.ny[t]!, this.nz[t]!)
        toCam.subVectors(camera.position, centroid).normalize()
        if (normal.dot(toCam) <= 0) continue
      }

      v.copy(centroid).project(camera)
      if (v.z < -1 || v.z > 1) continue
      const sx = (v.x * 0.5 + 0.5) * w
      const sy = (-v.y * 0.5 + 0.5) * h
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(t)
    }
    return out
  }
}

export function getCentroidGrid(geom: THREE.BufferGeometry): CentroidGrid {
  let grid = gridCache.get(geom)
  if (!grid) {
    grid = CentroidGrid.build(geom)
    gridCache.set(geom, grid)
  }
  return grid
}
