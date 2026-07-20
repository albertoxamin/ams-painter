import { type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

/** Nearest front-facing hit on `mesh`, or null. */
export function pickHit(
  e: ThreeEvent<MouseEvent | PointerEvent>,
  mesh: THREE.Mesh,
  triCount: number,
): { idx: number; point: THREE.Vector3 } | null {
  const hits = e.intersections.filter((h) => h.object === mesh)
  const _n = new THREE.Vector3()
  const hit =
    hits.find((h) => {
      if (!h.face) return false
      _n.copy(h.face.normal).transformDirection(mesh.matrixWorld)
      return _n.dot(e.ray.direction) < 0
    }) ?? hits[0]

  if (!hit?.face) return null
  const idx = hit.faceIndex ?? Math.floor(hit.face.a / 3)
  if (idx < 0 || idx >= triCount) return null
  return { idx, point: hit.point.clone() }
}

export function isGizmoObject(obj: THREE.Object3D | null | undefined): boolean {
  let o: THREE.Object3D | null | undefined = obj
  while (o) {
    const u = o.userData
    if (u?.axisGizmo || u?.depthHandle) return true
    o = o.parent
  }
  return false
}

/** True when any ray hit along the pointer ray is a gizmo. */
export function anyHitIsGizmo(e: ThreeEvent<PointerEvent>): boolean {
  const hit = e.intersections[0]
  if (hit) return isGizmoObject(hit.object)
  return isGizmoObject(e.object)
}

export function islandCentroid(
  geom: THREE.BufferGeometry,
  faces: Set<number>,
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

export function modelDiagonal(geom: THREE.BufferGeometry): number {
  geom.computeBoundingBox()
  const s = new THREE.Vector3()
  geom.boundingBox!.getSize(s)
  return Math.max(s.x, s.y, s.z, 1)
}

export function lightenHex(hex: string, amount = 0.35): string {
  const c = new THREE.Color(hex)
  c.lerp(new THREE.Color('#ffffff'), amount)
  return `#${c.getHexString()}`
}
