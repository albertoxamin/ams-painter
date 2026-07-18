import * as THREE from 'three'

/** Axis of the curtain extrusion for inserts. */
export type CutAxis = '-z' | '+z' | '-x' | '+x' | '-y' | '+y'

/** Per-face / per-island cut settings for drop-in inserts. */
export interface InsertMeta {
  axis: CutAxis
  floor: number
  /** Entry safety plane (opposite side); omit = auto from selection + pad. */
  entry?: number
  /** Palette color id stamped when painting. */
  colorId: string
}

export interface PaletteColor {
  id: string
  name: string
  hex: string
}

export const CUT_AXES: { id: CutAxis; label: string; title: string }[] = [
  { id: '-z', label: '−Z', title: 'Extrude toward −Z (down / bed)' },
  { id: '+z', label: '+Z', title: 'Extrude toward +Z (up)' },
  { id: '-x', label: '−X', title: 'Extrude toward −X (e.g. headlights)' },
  { id: '+x', label: '+X', title: 'Extrude toward +X (e.g. headlights)' },
  { id: '-y', label: '−Y', title: 'Extrude toward −Y' },
  { id: '+y', label: '+Y', title: 'Extrude toward +Y' },
]

/** RGB axis tint (matches viewport gizmo). */
export const AXIS_COLORS: Record<'x' | 'y' | 'z', string> = {
  x: '#e74c3c',
  y: '#2ecc71',
  z: '#3498db',
}

export function axisLetter(axis: CutAxis): 'x' | 'y' | 'z' {
  return axis[1] as 'x' | 'y' | 'z'
}

export function flipAxis(axis: CutAxis): CutAxis {
  return (axis[0] === '-' ? `+${axis[1]}` : `-${axis[1]}`) as CutAxis
}

function getCoord(x: number, y: number, z: number, letter: 'x' | 'y' | 'z'): number {
  return letter === 'x' ? x : letter === 'y' ? y : z
}

/** Bounds of the model along the cut axis. */
export function axisBounds(
  model: { zMin: number; zMax: number; geometry: THREE.BufferGeometry },
  axis: CutAxis,
): { min: number; max: number } {
  const letter = axisLetter(axis)
  if (letter === 'z') return { min: model.zMin, max: model.zMax }
  model.geometry.computeBoundingBox()
  const b = model.geometry.boundingBox!
  if (letter === 'x') return { min: b.min.x, max: b.max.x }
  return { min: b.min.y, max: b.max.y }
}

/** Min/max/mean of selected face vertices along an axis letter. */
export function selectionSpan(
  geom: THREE.BufferGeometry,
  selected: Set<number>,
  letter: 'x' | 'y' | 'z',
): { min: number; max: number; mean: number } {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let n = 0
  for (const t of selected) {
    const a = t * 3
    for (let i = 0; i < 3; i++) {
      const c = getCoord(pos.getX(a + i), pos.getY(a + i), pos.getZ(a + i), letter)
      min = Math.min(min, c)
      max = Math.max(max, c)
      sum += c
      n++
    }
  }
  return { min, max, mean: n ? sum / n : 0 }
}

/**
 * Resolve printable-insert floor vs body-cutter floors.
 *
 * Extrusion follows `axis` (e.g. −X decreases X). The insert stops at `userFloor`
 * (clamped between the painted surface and the far side). The body cutter matches
 * that depth (`cutterFloor` = insert floor + small seating pad) and also opens a
 * short entry cut the opposite way past the painted surface (`entryFloor`).
 *
 * Pass `userEntry` to override the auto entry plane (from drag handles).
 */
export function resolveInsertFloors(
  geom: THREE.BufferGeometry,
  selected: Set<number>,
  axis: CutAxis,
  userFloor: number,
  pad = 0.75,
  userEntry?: number,
): {
  insertFloor: number
  /** Pocket depth for the body cut (insert floor + seating pad, not through-model). */
  cutterFloor: number
  /** Entry safety plane past the painted surface (opposite direction). */
  entryFloor: number
  axis: CutAxis
} {
  const letter = axisLetter(axis)
  let sign = axis[0] === '-' ? -1 : 1
  const span = selectionSpan(geom, selected, letter)
  geom.computeBoundingBox()
  const b = geom.boundingBox!
  const bMin = letter === 'x' ? b.min.x : letter === 'y' ? b.min.y : b.min.z
  const bMax = letter === 'x' ? b.max.x : letter === 'y' ? b.max.y : b.max.z

  // Prefer cutting into the model. If the chosen sign only has a shallow
  // outward slab (e.g. +X on a +X headlight face), reverse so the pocket
  // goes through the body.
  const outwardFar = sign < 0 ? bMin - pad : bMax + pad
  const inwardFar = sign < 0 ? bMax + pad : bMin - pad
  const outwardDepth = Math.abs(span.mean - outwardFar)
  const inwardDepth = Math.abs(span.mean - inwardFar)
  if (outwardDepth < 2.5 || outwardDepth < inwardDepth * 0.3) {
    sign = -sign
  }
  const far = sign < 0 ? bMin - pad : bMax + pad
  const entryDefault = sign < 0 ? span.max + pad : span.min - pad
  // Entry stays on the outside of the selection (cannot cross into pocket)
  const entryFar = sign < 0 ? bMax + pad : bMin - pad
  let entryFloor = userEntry ?? entryDefault
  if (sign < 0) {
    // entry toward +axis: must be > face max
    const lo = span.max + 1e-3
    const hi = entryFar
    if (hi > lo) entryFloor = Math.min(hi, Math.max(lo, entryFloor))
    else entryFloor = entryDefault
  } else {
    // entry toward −axis: must be < face min
    const lo = entryFar
    const hi = span.min - 1e-3
    if (hi > lo) entryFloor = Math.min(hi, Math.max(lo, entryFloor))
    else entryFloor = entryDefault
  }

  const aligned: CutAxis = `${sign < 0 ? '-' : '+'}${letter}` as CutAxis

  // Insert floor: between the painted surface and the far side
  let insertFloor = userFloor
  if (sign < 0) {
    // toward −axis: floor must be < face min
    const lo = far + pad
    const hi = span.min - 1e-3
    if (hi > lo) insertFloor = Math.min(hi, Math.max(lo, userFloor))
    else insertFloor = (span.mean + far) / 2
  } else {
    const lo = span.max + 1e-3
    const hi = far - pad
    if (hi > lo) insertFloor = Math.min(hi, Math.max(lo, userFloor))
    else insertFloor = (span.mean + far) / 2
  }

  // Pocket is only slightly deeper than the insert so it seats fully —
  // never punches through to the opposite side of the model.
  const seat = 0.2
  let cutterFloor = insertFloor + sign * seat
  if (sign < 0) cutterFloor = Math.max(far + pad * 0.25, cutterFloor)
  else cutterFloor = Math.min(far - pad * 0.25, cutterFloor)

  return { insertFloor, cutterFloor, entryFloor, axis: aligned }
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
 * Build a closed solid (the "insert") from a set of selected triangles.
 *
 * Curtain-extrudes the selection onto a plane perpendicular to `axis` at
 * coordinate `floor` (e.g. axis='-z', floor=0 → old bed extrusion).
 */
export function buildInsert(
  geom: THREE.BufferGeometry,
  selected: Set<number>,
  floorOrBottomZ: number | { axis?: CutAxis; floor: number } = 0,
): THREE.BufferGeometry | null {
  if (selected.size === 0) return null

  const opts =
    typeof floorOrBottomZ === 'number'
      ? { axis: '-z' as CutAxis, floor: floorOrBottomZ }
      : { axis: floorOrBottomZ.axis ?? ('-z' as CutAxis), floor: floorOrBottomZ.floor }

  const letter = axisLetter(opts.axis)
  const floor = opts.floor
  const pos = geom.getAttribute('position') as THREE.BufferAttribute

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

  const towardFloor = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): boolean => {
    // Normal via (v1-v0)×(v2-v0)
    const nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0)
    const ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0)
    const nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    const nAxis = letter === 'x' ? nx : letter === 'y' ? ny : nz
    const cAxis =
      (getCoord(x0, y0, z0, letter) +
        getCoord(x1, y1, z1, letter) +
        getCoord(x2, y2, z2, letter)) /
      3
    // Flip when normal points toward the floor plane
    return nAxis * (floor - cAxis) > 0
  }

  // top cap
  for (const t of selected) {
    const a = t * 3
    const x0 = pos.getX(a),
      y0 = pos.getY(a),
      z0 = pos.getZ(a)
    const x1 = pos.getX(a + 1),
      y1 = pos.getY(a + 1),
      z1 = pos.getZ(a + 1)
    const x2 = pos.getX(a + 2),
      y2 = pos.getY(a + 2),
      z2 = pos.getZ(a + 2)
    const i0 = addVert(x0, y0, z0)
    const i1 = addVert(x1, y1, z1)
    const i2 = addVert(x2, y2, z2)
    if (towardFloor(x0, y0, z0, x1, y1, z1, x2, y2, z2)) addTri(i0, i2, i1)
    else addTri(i0, i1, i2)
  }

  // boundary edges with directed winding matching top
  const edgeOwners = new Map<
    string,
    { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number; count: number }
  >()
  for (const t of selected) {
    const a = t * 3
    const x0 = pos.getX(a),
      y0 = pos.getY(a),
      z0 = pos.getZ(a)
    const x1 = pos.getX(a + 1),
      y1 = pos.getY(a + 1),
      z1 = pos.getZ(a + 1)
    const x2 = pos.getX(a + 2),
      y2 = pos.getY(a + 2),
      z2 = pos.getZ(a + 2)
    const flip = towardFloor(x0, y0, z0, x1, y1, z1, x2, y2, z2)
    const corners = flip
      ? [
          [x0, y0, z0],
          [x2, y2, z2],
          [x1, y1, z1],
        ]
      : [
          [x0, y0, z0],
          [x1, y1, z1],
          [x2, y2, z2],
        ]
    for (let e = 0; e < 3; e++) {
      const [ux, uy, uz] = corners[e]
      const [vx, vy, vz] = corners[(e + 1) % 3]
      const ku = key(ux, uy, uz)
      const kv = key(vx, vy, vz)
      const ek = ku < kv ? `${ku}|${kv}` : `${kv}|${ku}`
      const prev = edgeOwners.get(ek)
      if (prev) prev.count++
      else edgeOwners.set(ek, { ux, uy, uz, vx, vy, vz, count: 1 })
    }
  }

  // side walls
  for (const { ux, uy, uz, vx, vy, vz, count } of edgeOwners.values()) {
    if (count !== 1) continue
    const u = addVert(ux, uy, uz)
    const v = addVert(vx, vy, vz)
    const [pux, puy, puz] = projectToFloor(ux, uy, uz, letter, floor)
    const [pvx, pvy, pvz] = projectToFloor(vx, vy, vz, letter, floor)
    const pu = addVert(pux, puy, puz)
    const pv = addVert(pvx, pvy, pvz)
    addTri(u, pv, v)
    addTri(u, pu, pv)
  }

  // floor cap (opposite winding)
  for (const t of selected) {
    const a = t * 3
    const x0 = pos.getX(a),
      y0 = pos.getY(a),
      z0 = pos.getZ(a)
    const x1 = pos.getX(a + 1),
      y1 = pos.getY(a + 1),
      z1 = pos.getZ(a + 1)
    const x2 = pos.getX(a + 2),
      y2 = pos.getY(a + 2),
      z2 = pos.getZ(a + 2)
    const [ax, ay, az] = projectToFloor(x0, y0, z0, letter, floor)
    const [bx, by, bz] = projectToFloor(x1, y1, z1, letter, floor)
    const [cx, cy, cz] = projectToFloor(x2, y2, z2, letter, floor)
    const i0 = addVert(ax, ay, az)
    const i1 = addVert(bx, by, bz)
    const i2 = addVert(cx, cy, cz)
    if (towardFloor(x0, y0, z0, x1, y1, z1, x2, y2, z2)) addTri(i0, i1, i2)
    else addTri(i0, i2, i1)
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  out.setIndex(tris)
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/** Return the boundary edges (as endpoint Vector3 pairs) of a selection. */
export function selectionBoundaryEdges(
  geom: THREE.BufferGeometry,
  selected: Set<number>,
): THREE.Vector3[] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const key = (i: number) =>
    `${pos.getX(i).toFixed(5)}_${pos.getY(i).toFixed(5)}_${pos.getZ(i).toFixed(5)}`
  const owners = new Map<string, { u: number; v: number; count: number }>()
  for (const t of selected) {
    const a = t * 3
    const verts = [a, a + 1, a + 2]
    for (let e = 0; e < 3; e++) {
      const u = verts[e]
      const v = verts[(e + 1) % 3]
      const ku = key(u)
      const kv = key(v)
      const ek = ku < kv ? `${ku}|${kv}` : `${kv}|${ku}`
      const prev = owners.get(ek)
      if (prev) prev.count++
      else owners.set(ek, { u, v, count: 1 })
    }
  }
  const segs: THREE.Vector3[] = []
  for (const { u, v, count } of owners.values()) {
    if (count !== 1) continue
    segs.push(
      new THREE.Vector3(pos.getX(u), pos.getY(u), pos.getZ(u)),
      new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)),
    )
  }
  return segs
}
