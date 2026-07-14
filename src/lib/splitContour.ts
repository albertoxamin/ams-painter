import * as THREE from 'three'

/**
 * Compute the polyline where plane z=H intersects a non-indexed triangle mesh.
 * Returns flat pairs of endpoints suitable for THREE.LineSegments.
 */
export function splitContourSegments(
  geom: THREE.BufferGeometry,
  H: number,
): Float32Array {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const triCount = pos.count / 3
  const segs: number[] = []

  const eps = 1e-8
  const p = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]
  const hits: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    for (let i = 0; i < 3; i++) {
      p[i].set(pos.getX(a + i), pos.getY(a + i), pos.getZ(a + i))
    }

    const d0 = p[0].z - H
    const d1 = p[1].z - H
    const d2 = p[2].z - H

    // Skip if entirely above or below (allow vertices on plane)
    const above = (d0 > eps ? 1 : 0) + (d1 > eps ? 1 : 0) + (d2 > eps ? 1 : 0)
    const below = (d0 < -eps ? 1 : 0) + (d1 < -eps ? 1 : 0) + (d2 < -eps ? 1 : 0)
    if (above === 3 || below === 3) continue

    let nHits = 0
    // Intersect each edge with the plane
    for (let e = 0; e < 3; e++) {
      const i0 = e
      const i1 = (e + 1) % 3
      const z0 = p[i0].z
      const z1 = p[i1].z
      const dz = z1 - z0

      // Endpoint exactly on plane — include once (avoid double-counting shared verts
      // by only taking the "start" vertex of the edge when on-plane).
      if (Math.abs(z0 - H) <= eps) {
        hits[nHits++].copy(p[i0])
        continue
      }
      // Crossing edge
      if ((z0 - H) * (z1 - H) < 0 && Math.abs(dz) > eps) {
        const u = (H - z0) / dz
        hits[nHits].set(
          p[i0].x + (p[i1].x - p[i0].x) * u,
          p[i0].y + (p[i1].y - p[i0].y) * u,
          H,
        )
        nHits++
      }
    }

    // A proper cut yields 2 intersection points (a segment).
    // Coplanar triangles may yield 3 — skip or take first edge only.
    if (nHits >= 2) {
      segs.push(hits[0].x, hits[0].y, hits[0].z, hits[1].x, hits[1].y, hits[1].z)
    }
  }

  return new Float32Array(segs)
}
