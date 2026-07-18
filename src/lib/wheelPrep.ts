import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { manifoldSubtract, manifoldUnion } from './manifoldOps'

export type MirrorAxis = 'x' | 'y'

export interface Axle {
  /** Wheel center clicked by the user (in model space, Z-up). */
  center: THREE.Vector3
  /** Mirrored center across the symmetry plane. */
  mirrored: THREE.Vector3
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Quaternion that rotates local +Y onto `target` (a unit vector). */
function alignYTo(target: THREE.Vector3): THREE.Quaternion {
  const q = new THREE.Quaternion()
  q.setFromUnitVectors(Y_AXIS, target.clone().normalize())
  return q
}

/** Mirror a point across the symmetry plane (x=0 or y=0). */
export function mirrorPoint(p: THREE.Vector3, axis: MirrorAxis): THREE.Vector3 {
  return axis === 'x'
    ? new THREE.Vector3(-p.x, p.y, p.z)
    : new THREE.Vector3(p.x, -p.y, p.z)
}

/** Axle direction = normal of the mirror plane. */
export function axleDirection(axis: MirrorAxis): THREE.Vector3 {
  return axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
}

/**
 * Fetch + parse an STL asset, then center its bounding box on the origin so
 * rotations/translations are predictable. Does NOT drop to bed — assets are
 * meant to be placed at arbitrary points.
 */
export async function loadWheelAsset(url: string): Promise<THREE.BufferGeometry> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  const buf = await res.arrayBuffer()
  const loader = new STLLoader()
  const geom = loader.parse(buf)
  if (!geom.getAttribute('position')) {
    throw new Error(`Asset ${url} has no geometry`)
  }
  geom.computeBoundingBox()
  const b = geom.boundingBox!
  const cx = (b.min.x + b.max.x) / 2
  const cy = (b.min.y + b.max.y) / 2
  const cz = (b.min.z + b.max.z) / 2
  geom.translate(-cx, -cy, -cz)
  geom.computeVertexNormals()
  geom.computeBoundingSphere()
  return geom
}

/**
 * Cylinder cutter oriented along `axleDir`, centered at `center`.
 * Uses THREE.CylinderGeometry (axis = local Y) then aligns Y → axleDir.
 */
export function buildCutter(
  center: THREE.Vector3,
  axleDir: THREE.Vector3,
  radius: number,
  length: number,
): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(
    Math.max(radius, 1e-4),
    Math.max(radius, 1e-4),
    Math.max(length, 1e-4),
    48,
    1,
    false,
  )
  cyl.applyQuaternion(alignYTo(axleDir))
  cyl.translate(center.x, center.y, center.z)
  cyl.computeVertexNormals()
  cyl.computeBoundingBox()
  cyl.computeBoundingSphere()
  return cyl
}

/**
 * Unit cylinder (radius 1, height 1) aligned to `axleDir`, NOT translated.
 * Intended for gizmo-driven scaling: set mesh.scale = (radius, length, radius)
 * to represent a cutter of the given size, then a scale TransformControls
 * gizmo can manipulate radius (x/z) and length (y) directly in the viewport.
 */
export function unitCutterGeometry(axleDir: THREE.Vector3): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 32, 1, false)
  cyl.applyQuaternion(alignYTo(axleDir))
  cyl.computeVertexNormals()
  return cyl
}

/**
 * Subtract every axle's pair of cutters from the car body.
 * Runs sequentially through manifoldSubtract; returns the prepared body.
 * If `axles` is empty, returns a clone of the original geometry.
 */
export async function prepareBody(
  carGeom: THREE.BufferGeometry,
  axles: Axle[],
  radius: number,
  length: number,
  axis: MirrorAxis,
): Promise<THREE.BufferGeometry> {
  if (axles.length === 0) {
    return carGeom.clone()
  }
  const dir = axleDirection(axis)
  let current = carGeom.clone()
  for (const axle of axles) {
    const cutters = [
      buildCutter(axle.center, dir, radius, length),
      buildCutter(axle.mirrored, dir, radius, length),
    ]
    for (const c of cutters) {
      const next = await manifoldSubtract(current, c)
      current.dispose()
      c.dispose()
      current = next
    }
  }
  return current
}

/**
 * Clone an asset geometry (pin or wheel), apply a local Euler rotation
 * (degrees), then align the asset's local +Y to `axleDir`, then translate
 * to `center`. Returns a fresh geometry ready for the viewport.
 */
export function placePart(
  asset: THREE.BufferGeometry,
  center: THREE.Vector3,
  axleDir: THREE.Vector3,
  rotOffsetDeg: [number, number, number],
  scaleAlongAxle?: number,
  offsetAlongAxle?: number,
): THREE.BufferGeometry {
  const g = asset.clone()
  g.applyMatrix4(
    new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        (rotOffsetDeg[0] * Math.PI) / 180,
        (rotOffsetDeg[1] * Math.PI) / 180,
        (rotOffsetDeg[2] * Math.PI) / 180,
        'XYZ',
      ),
    ),
  )
  g.applyQuaternion(alignYTo(axleDir))
  // After alignment the asset's local +Y maps to axleDir, so scaling on Y
  // stretches it along the axle and translating on Y offsets along the axle.
  if (scaleAlongAxle !== undefined) {
    g.computeBoundingBox()
    const b = g.boundingBox!
    const curLen = Math.max(b.max.y - b.min.y, 1e-6)
    g.scale(1, scaleAlongAxle / curLen, 1)
  }
  if (offsetAlongAxle !== undefined) {
    g.translate(0, offsetAlongAxle, 0)
  }
  g.translate(center.x, center.y, center.z)
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/**
 * Direction from `center` away from the symmetry plane (toward the outside of
 * the car). For a center on the +x side of an x-mirror plane, outward is +x.
 */
export function outwardDir(center: THREE.Vector3, axis: MirrorAxis): THREE.Vector3 {
  const dir = axleDirection(axis)
  const c = axis === 'x' ? center.x : center.y
  return dir.multiplyScalar(c >= 0 ? 1 : -1)
}

/**
 * Build a pin geometry for every wheel center (both sides of every axle).
 * The pin is a fixed mechanical joint — it is NOT stretched. It is placed at
 * its natural size, centered on the wheel, so it sits inside the cut hole and
 * connects to the body there.
 */
export function buildAllPins(
  pinAsset: THREE.BufferGeometry,
  axles: Axle[],
  axis: MirrorAxis,
  rotOffsetDeg: [number, number, number],
): THREE.BufferGeometry[] {
  const dir = axleDirection(axis)
  const reversed = dir.clone().negate()
  const out: THREE.BufferGeometry[] = []
  for (const a of axles) {
    // Primary pin aligned to +axleDir; opposite-side pin aligned to -axleDir
    // (a 180° rotation about the symmetry plane) so the two pins point
    // opposite ways — i.e. the mirrored pin faces the same way relative to
    // the car (head outward on both sides). Pure rotation preserves winding.
    out.push(placePart(pinAsset, a.center, dir, rotOffsetDeg))
    out.push(placePart(pinAsset, a.mirrored, reversed, rotOffsetDeg))
  }
  return out
}

/**
 * Build preview-wheel geometries for every wheel center. Each wheel sits at the
 * outer end of the pin (where the wheel would mount), offset from the wheel
 * center along the axle by half the pin's natural length, on the side away
 * from the symmetry plane — so the wheel connects to the end of the pin
 * without the pin being stretched.
 */
export function buildAllWheels(
  wheelAsset: THREE.BufferGeometry,
  axles: Axle[],
  axis: MirrorAxis,
  rotOffsetDeg: [number, number, number],
  pinHalfLength: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  for (const a of axles) {
    for (const c of [a.center, a.mirrored]) {
      const outDir = outwardDir(c, axis)
      out.push(placePart(wheelAsset, c, outDir, rotOffsetDeg, undefined, pinHalfLength))
    }
  }
  return out
}

/**
 * Union the prepared body with every pin so the export is a single solid
 * (pins fused into the chassis). Used when `unionPins` is enabled.
 */
export async function unionPinsIntoBody(
  body: THREE.BufferGeometry,
  pins: THREE.BufferGeometry[],
): Promise<THREE.BufferGeometry> {
  if (pins.length === 0) return body
  let current = body
  for (const p of pins) {
    const next = await manifoldUnion(current, p)
    if (current !== body) current.dispose()
    p.dispose()
    current = next
  }
  return current
}
