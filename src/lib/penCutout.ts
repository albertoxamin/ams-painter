import * as THREE from 'three'
import { ShapeUtils } from 'three'
import {
  axisLetter,
  type CutAxis,
  type InsertMeta,
} from './extrude'
import { resolveSpanInsertFloors } from './insertDepth'

/** User-drawn closed loop on the mesh surface (not triangle selection). */
export interface PenCutout {
  id: string
  /** Closed loop vertices in model space (first ≠ last; we close implicitly). */
  loop: [number, number, number][]
  meta: InsertMeta
  /** When true, insert is a planar prism (no interior mesh). */
  flat?: boolean
}

export function loopToVectors(loop: [number, number, number][]): THREE.Vector3[] {
  return loop.map(([x, y, z]) => new THREE.Vector3(x, y, z))
}

/** Nudge a surface loop slightly into the body so CSG cutters overlap solid volume. */
export function nudgeLoopIntoBody(
  loop: THREE.Vector3[],
  axis: CutAxis,
  amount = 0.2,
): THREE.Vector3[] {
  const letter = axisLetter(axis)
  const sign = axis[0] === '-' ? -1 : 1
  return loop.map((p) => {
    const v = p.clone()
    if (letter === 'x') v.x += sign * amount
    else if (letter === 'y') v.y += sign * amount
    else v.z += sign * amount
    return v
  })
}

/** Push a floor plane slightly further along the cut axis (deeper pocket cutter). */
export function deeperFloorAlongAxis(
  floor: number,
  axis: CutAxis,
  extra = 0.35,
): number {
  const sign = axis[0] === '-' ? -1 : 1
  return floor + sign * extra
}

function projectPerp(
  x: number,
  y: number,
  z: number,
  letter: 'x' | 'y' | 'z',
): { u: number; v: number; w: number } {
  if (letter === 'x') return { u: y, v: z, w: x }
  if (letter === 'y') return { u: x, v: z, w: y }
  return { u: x, v: y, w: z }
}

/** Even-odd test in the plane perpendicular to the cut axis. */
export function pointInProjectedLoop(
  u: number,
  v: number,
  ring: { u: number; v: number }[],
): boolean {
  const n = ring.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ui = ring[i]!.u
    const vi = ring[i]!.v
    const uj = ring[j]!.u
    const vj = ring[j]!.v
    if (vi === vj) continue
    const crosses = vi > v !== vj > v
    if (crosses && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside
  }
  return inside
}

/**
 * Triangles whose centroid projects inside the pen loop along the cut axis
 * and whose axis-height lies in `[wMin, wMax]`. Useful for preview/tests;
 * printable inserts use model∩prism instead of curtain-extruding these faces.
 */
export function facesInsideProjectedLoop(
  geom: THREE.BufferGeometry,
  loop: THREE.Vector3[],
  axis: CutAxis,
  wMin: number,
  wMax: number,
): Set<number> {
  const faces = new Set<number>()
  if (loop.length < 3) return faces
  const letter = axisLetter(axis)
  const ring = loop.map((p) => projectPerp(p.x, p.y, p.z, letter))
  const lo = Math.min(wMin, wMax)
  const hi = Math.max(wMin, wMax)
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const triCount = Math.floor(pos.count / 3)
  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    const p0 = projectPerp(pos.getX(a), pos.getY(a), pos.getZ(a), letter)
    const p1 = projectPerp(pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1), letter)
    const p2 = projectPerp(pos.getX(a + 2), pos.getY(a + 2), pos.getZ(a + 2), letter)
    const w = (p0.w + p1.w + p2.w) / 3
    if (w < lo - 1e-4 || w > hi + 1e-4) continue
    const u = (p0.u + p1.u + p2.u) / 3
    const v = (p0.v + p1.v + p2.v) / 3
    if (pointInProjectedLoop(u, v, ring)) faces.add(t)
  }
  return faces
}

export function loopSpan(
  loop: THREE.Vector3[],
  letter: 'x' | 'y' | 'z',
): { min: number; max: number; mean: number } {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const p of loop) {
    const c = letter === 'x' ? p.x : letter === 'y' ? p.y : p.z
    min = Math.min(min, c)
    max = Math.max(max, c)
    sum += c
  }
  const n = loop.length || 1
  return { min, max, mean: sum / n }
}

/** Project every loop vertex onto a plane of constant cut-axis coordinate `w`. */
export function flattenLoopOnAxis(
  loop: THREE.Vector3[],
  axis: CutAxis,
  w: number,
): THREE.Vector3[] {
  const letter = axisLetter(axis)
  return loop.map((p) => {
    const v = p.clone()
    if (letter === 'x') v.x = w
    else if (letter === 'y') v.y = w
    else v.z = w
    return v
  })
}

/**
 * Furthermost mesh coordinate along `axis` among triangles whose centroid
 * projects inside `loop`, plus 1 mm outward so a flat insert clears the skin.
 * Cut toward −Z → largest Z + 1 mm; toward +Z → smallest Z − 1 mm.
 */
export const FLAT_LOOP_PAD_MM = 1

function outwardWithPad(
  span: { min: number; max: number },
  axis: CutAxis,
): number {
  const sign = axis[0] === '-' ? -1 : 1
  const extreme = sign < 0 ? span.max : span.min
  return extreme - sign * FLAT_LOOP_PAD_MM
}

export function meshFurthermostOnAxis(
  geom: THREE.BufferGeometry,
  loop: THREE.Vector3[],
  axis: CutAxis,
): number {
  const letter = axisLetter(axis)
  const faces = facesInsideProjectedLoop(
    geom,
    loop,
    axis,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  )
  const span =
    faces.size > 0
      ? (() => {
          const pos = geom.getAttribute('position') as THREE.BufferAttribute
          let min = Infinity
          let max = -Infinity
          for (const t of faces) {
            const a = t * 3
            for (let i = 0; i < 3; i++) {
              const p = projectPerp(
                pos.getX(a + i),
                pos.getY(a + i),
                pos.getZ(a + i),
                letter,
              )
              min = Math.min(min, p.w)
              max = Math.max(max, p.w)
            }
          }
          return { min, max }
        })()
      : loopSpan(loop, letter)
  return outwardWithPad(span, axis)
}

export function flattenPenLoopToMeshExtreme(
  geom: THREE.BufferGeometry | null,
  loop: THREE.Vector3[],
  axis: CutAxis,
): THREE.Vector3[] {
  const w = geom
    ? meshFurthermostOnAxis(geom, loop, axis)
    : outwardWithPad(loopSpan(loop, axisLetter(axis)), axis)
  return flattenLoopOnAxis(loop, axis, w)
}

function getCoord(x: number, y: number, z: number, letter: 'x' | 'y' | 'z'): number {
  return letter === 'x' ? x : letter === 'y' ? y : z
}

function projectToFloor(
  x: number,
  y: number,
  z: number,
  letter: 'x' | 'y' | 'z',
  floor: number,
): [number, number, number] {
  if (letter === 'x') return [floor, y, z]
  if (letter === 'y') return [x, floor, z]
  return [x, y, floor]
}

/**
 * Resolve insert / pocket / entry floors for a pen loop (same rules as face
 * selections, but span comes from the drawn boundary).
 */
export function resolveLoopInsertFloors(
  geom: THREE.BufferGeometry,
  loop: THREE.Vector3[],
  axis: CutAxis,
  userFloor: number,
  pad = 0.75,
  userEntry?: number,
): {
  insertFloor: number
  cutterFloor: number
  entryFloor: number
  axis: CutAxis
} {
  const letter = axisLetter(axis)
  const span = loopSpan(loop, letter)
  return resolveSpanInsertFloors(geom, span, axis, userFloor, pad, userEntry)
}

/** Build a closed prism from a surface loop extruded along `axis` to `floor`. */
export function buildInsertFromLoop(
  loop: THREE.Vector3[],
  axis: CutAxis,
  floor: number,
): THREE.BufferGeometry | null {
  if (loop.length < 3) return null

  const letter = axisLetter(axis)
  const verts: number[] = []
  const tris: number[] = []
  const key = (x: number, y: number, z: number) =>
    `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
  const vidx = new Map<string, number>()

  const addVert = (x: number, y: number, z: number): number => {
    const k = key(x, y, z)
    const existing = vidx.get(k)
    if (existing !== undefined) return existing
    verts.push(x, y, z)
    const i = verts.length / 3 - 1
    vidx.set(k, i)
    return i
  }

  const addTri = (a: number, b: number, c: number) => {
    tris.push(a, b, c)
  }

  const n = loop.length
  const topIdx: number[] = []
  const botIdx: number[] = []
  for (const p of loop) {
    topIdx.push(addVert(p.x, p.y, p.z))
    const [bx, by, bz] = projectToFloor(p.x, p.y, p.z, letter, floor)
    botIdx.push(addVert(bx, by, bz))
  }

  // Top cap — 2D triangulation in the plane ⊥ cut axis
  const coords2d: THREE.Vector2[] = []
  for (const p of loop) {
    if (letter === 'x') coords2d.push(new THREE.Vector2(p.y, p.z))
    else if (letter === 'y') coords2d.push(new THREE.Vector2(p.x, p.z))
    else coords2d.push(new THREE.Vector2(p.x, p.y))
  }
  let topTris: number[][] = []
  try {
    topTris = ShapeUtils.triangulateShape(coords2d, [])
  } catch {
    // fan fallback for degenerate loops
    for (let i = 1; i < n - 1; i++) topTris.push([0, i, i + 1])
  }

  const topTowardFloor = (ia: number, ib: number, ic: number) => {
    const ax = verts[ia * 3]!,
      ay = verts[ia * 3 + 1]!,
      az = verts[ia * 3 + 2]!
    const bx = verts[ib * 3]!,
      by = verts[ib * 3 + 1]!,
      bz = verts[ib * 3 + 2]!
    const cx = verts[ic * 3]!,
      cy = verts[ic * 3 + 1]!,
      cz = verts[ic * 3 + 2]!
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    const nAxis = letter === 'x' ? nx : letter === 'y' ? ny : nz
    const cAxis =
      (getCoord(ax, ay, az, letter) +
        getCoord(bx, by, bz, letter) +
        getCoord(cx, cy, cz, letter)) /
      3
    return nAxis * (floor - cAxis) > 0
  }

  for (const [a, b, c] of topTris) {
    const ia = topIdx[a]!
    const ib = topIdx[b]!
    const ic = topIdx[c]!
    if (topTowardFloor(ia, ib, ic)) addTri(ia, ic, ib)
    else addTri(ia, ib, ic)
  }

  // Bottom cap (opposite winding)
  for (const [a, b, c] of topTris) {
    const ia = botIdx[a]!
    const ib = botIdx[b]!
    const ic = botIdx[c]!
    if (topTowardFloor(topIdx[a]!, topIdx[b]!, topIdx[c]!)) addTri(ia, ib, ic)
    else addTri(ia, ic, ib)
  }

  // Side walls
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const u = topIdx[i]!
    const v = topIdx[j]!
    const pu = botIdx[i]!
    const pv = botIdx[j]!
    addTri(u, pv, v)
    addTri(u, pu, pv)
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  out.setIndex(tris)
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/** ESP boundary segments for a pen loop (surface ring + posts to floors). */
export function penLoopEspSegments(
  geom: THREE.BufferGeometry,
  loop: THREE.Vector3[],
  meta: InsertMeta,
): Float32Array | null {
  if (loop.length < 2) return null
  const resolved = resolveLoopInsertFloors(
    geom,
    loop,
    meta.axis,
    meta.floor,
    0.75,
    meta.entry,
  )
  const letter = axisLetter(resolved.axis)
  const f = resolved.insertFloor
  const entry = resolved.entryFloor
  const project = (p: THREE.Vector3, plane: number): THREE.Vector3 => {
    if (letter === 'x') return new THREE.Vector3(plane, p.y, p.z)
    if (letter === 'y') return new THREE.Vector3(p.x, plane, p.z)
    return new THREE.Vector3(p.x, p.y, plane)
  }

  const pos: number[] = []
  const n = loop.length
  for (let i = 0; i < n; i++) {
    const u = loop[i]!
    const v = loop[(i + 1) % n]!
    const pu = project(u, f)
    const pv = project(v, f)
    const eu = project(u, entry)
    const ev = project(v, entry)
    pos.push(u.x, u.y, u.z, v.x, v.y, v.z)
    pos.push(pu.x, pu.y, pu.z, pv.x, pv.y, pv.z)
    pos.push(eu.x, eu.y, eu.z, ev.x, ev.y, ev.z)
    pos.push(eu.x, eu.y, eu.z, u.x, u.y, u.z)
    pos.push(ev.x, ev.y, ev.z, v.x, v.y, v.z)
    pos.push(u.x, u.y, u.z, pu.x, pu.y, pu.z)
    pos.push(v.x, v.y, v.z, pv.x, pv.y, pv.z)
  }
  return new Float32Array(pos)
}

export function penCutoutCentroid(loop: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3()
  for (const p of loop) c.add(p)
  if (loop.length > 0) c.multiplyScalar(1 / loop.length)
  return c
}

export function newPenCutoutId(): string {
  return `pen_${Math.random().toString(36).slice(2, 9)}`
}
