import * as THREE from 'three'
import { ShapeUtils } from 'three'
import { nestCutLoops } from './clipAtHeight'

export type SplitLockAxis = 'x' | 'y' | 'z'

const EPS = 1e-8

export function toUV(
  p: THREE.Vector3,
  lock: SplitLockAxis,
): { u: number; v: number; w: number } {
  if (lock === 'x') return { u: p.y, v: p.z, w: p.x }
  if (lock === 'y') return { u: p.x, v: p.z, w: p.y }
  return { u: p.x, v: p.y, w: p.z }
}

export function fromUV(
  u: number,
  v: number,
  w: number,
  lock: SplitLockAxis,
): THREE.Vector3 {
  if (lock === 'x') return new THREE.Vector3(w, u, v)
  if (lock === 'y') return new THREE.Vector3(u, w, v)
  return new THREE.Vector3(u, v, w)
}

function lockNormal(lock: SplitLockAxis): THREE.Vector3 {
  if (lock === 'x') return new THREE.Vector3(1, 0, 0)
  if (lock === 'y') return new THREE.Vector3(0, 1, 0)
  return new THREE.Vector3(0, 0, 1)
}

/** Drawing plane through `center`, normal = lock axis. */
export function splitDrawPlane(
  center: THREE.Vector3,
  lock: SplitLockAxis,
): THREE.Plane {
  return new THREE.Plane().setFromNormalAndCoplanarPoint(
    lockNormal(lock),
    center,
  )
}

/** Polyline densify (cut input is already a sampled Bézier). */
export function densifyPolyline(
  pts: THREE.Vector3[],
  samplesPerSeg = 1,
): THREE.Vector3[] {
  if (pts.length < 2) return pts.map((p) => p.clone())
  if (samplesPerSeg <= 1) return pts.map((p) => p.clone())
  const out: THREE.Vector3[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    for (let s = 0; s < samplesPerSeg; s++) {
      out.push(a.clone().lerp(b, s / samplesPerSeg))
    }
  }
  out.push(pts[pts.length - 1]!.clone())
  return out
}

type UV = { u: number; v: number }

export function curveVAt(u: number, curve: UV[]): number {
  if (curve.length === 0) return 0
  if (u <= curve[0]!.u) return curve[0]!.v
  const last = curve[curve.length - 1]!
  if (u >= last.u) return last.v
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!
    const b = curve[i + 1]!
    if (u >= a.u - EPS && u <= b.u + EPS) {
      const du = b.u - a.u
      if (Math.abs(du) < EPS) return a.v
      const t = (u - a.u) / du
      return a.v + (b.v - a.v) * t
    }
  }
  return last.v
}

/**
 * Build a u-monotone polyline in the drawing plane, extended to the bbox
 * so the cut goes all the way through.
 */
export function buildCurveUV(
  points: THREE.Vector3[],
  lock: SplitLockAxis,
  bbox: THREE.Box3,
  vOffset = 0,
): UV[] {
  const raw = densifyPolyline(points).map((p) => {
    const uv = toUV(p, lock)
    return { u: uv.u, v: uv.v + vOffset }
  })
  if (raw.length < 2) return raw
  if (raw[0]!.u > raw[raw.length - 1]!.u) raw.reverse()

  const c0 = toUV(bbox.min, lock)
  const c1 = toUV(bbox.max, lock)
  const umin = Math.min(c0.u, c1.u)
  const umax = Math.max(c0.u, c1.u)

  const first = raw[0]!
  const last = raw[raw.length - 1]!
  const d0 = raw[1]!.u - first.u
  const d1 = last.u - raw[raw.length - 2]!.u
  const extend = (p: UV, dirU: number, targetU: number): UV => {
    if (Math.abs(dirU) < EPS) return { u: targetU, v: p.v }
    return { u: targetU, v: p.v }
  }
  const out: UV[] = []
  if (first.u > umin + 1e-4) out.push(extend(first, d0, umin))
  out.push(...raw)
  if (last.u < umax - 1e-4) out.push(extend(last, d1, umax))
  return out
}

function insideCurve(
  p: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
  keepBelow: boolean,
): boolean {
  const uv = toUV(p, lock)
  return keepBelow
    ? uv.v <= curveVAt(uv.u, curve) + EPS
    : uv.v >= curveVAt(uv.u, curve) - EPS
}

function curveF(
  p: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
): number {
  const uv = toUV(p, lock)
  return uv.v - curveVAt(uv.u, curve)
}

/** Root of v = curve(u) along edge ab, kept on the edge (Bezier-safe). */
function lerpOnCurve(
  a: THREE.Vector3,
  b: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
): THREE.Vector3 {
  const ka = vkey(a)
  const kb = vkey(b)
  let p0 = a
  let p1 = b
  if (ka > kb) {
    p0 = b
    p1 = a
  }
  let f0 = curveF(p0, lock, curve)
  let f1 = curveF(p1, lock, curve)
  if (Math.abs(f0) <= EPS) return p0.clone()
  if (Math.abs(f1) <= EPS) return p1.clone()
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 32; i++) {
    const t = 0.5 * (t0 + t1)
    const p = p0.clone().lerp(p1, t)
    const f = curveF(p, lock, curve)
    if (f0 * f <= 0) {
      t1 = t
      f1 = f
    } else {
      t0 = t
      f0 = f
    }
  }
  return p0.clone().lerp(p1, 0.5 * (t0 + t1))
}

function onSurface(
  p: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
): boolean {
  return Math.abs(curveF(p, lock, curve)) <= 2 * EPS
}

function cutVertex(
  a: THREE.Vector3,
  b: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
): THREE.Vector3 {
  return snapToCurve(lerpOnCurve(a, b, lock, curve), lock, curve)
}

function clipEdge(
  s: THREE.Vector3,
  e: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
  keepBelow: boolean,
): { p: THREE.Vector3; onCut: boolean }[] {
  const dist = s.distanceTo(e)
  const steps = Math.max(8, Math.min(40, Math.ceil(dist / 1.25)))
  const out: { p: THREE.Vector3; onCut: boolean }[] = []
  let prev = s
  let prevIn = insideCurve(s, lock, curve, keepBelow)
  if (prevIn) out.push({ p: s.clone(), onCut: onSurface(s, lock, curve) })
  for (let i = 1; i <= steps; i++) {
    const cur = s.clone().lerp(e, i / steps)
    const curIn = insideCurve(cur, lock, curve, keepBelow)
    if (curIn !== prevIn) {
      out.push({ p: cutVertex(prev, cur, lock, curve), onCut: true })
    }
    if (i === steps && curIn) {
      const last = e.clone()
      if (
        out.length === 0 ||
        out[out.length - 1]!.p.distanceToSquared(last) > 1e-16
      ) {
        out.push({ p: last, onCut: onSurface(e, lock, curve) })
      }
    }
    prev = cur
    prevIn = curIn
  }
  return out
}

function clipPolygonAgainstCurve(
  verts: THREE.Vector3[],
  lock: SplitLockAxis,
  curve: UV[],
  keepBelow: boolean,
): { p: THREE.Vector3; onCut: boolean }[] {
  const raw: { p: THREE.Vector3; onCut: boolean }[] = []
  const n = verts.length
  for (let i = 0; i < n; i++) {
    raw.push(
      ...clipEdge(verts[i]!, verts[(i + 1) % n]!, lock, curve, keepBelow),
    )
  }
  const out: { p: THREE.Vector3; onCut: boolean }[] = []
  for (const v of raw) {
    const prev = out[out.length - 1]
    if (prev && prev.p.distanceToSquared(v.p) < 1e-16) continue
    out.push(v)
  }
  if (
    out.length > 1 &&
    out[0]!.p.distanceToSquared(out[out.length - 1]!.p) < 1e-16
  ) {
    out.pop()
  }
  return out
}

function triangulatePoly(verts: THREE.Vector3[]): THREE.Vector3[][] {
  if (verts.length < 3) return []
  if (verts.length === 3) return [[verts[0]!, verts[1]!, verts[2]!]]
  const o = verts[0]!
  const e1 = verts[1]!.clone().sub(o)
  let n = new THREE.Vector3()
  let e2 = new THREE.Vector3()
  for (let i = 2; i < verts.length; i++) {
    e2.copy(verts[i]!).sub(o)
    n.copy(e1).cross(e2)
    if (n.lengthSq() > 1e-16) break
  }
  if (n.lengthSq() < 1e-16) return []
  n.normalize()
  const x = e1.clone().normalize()
  const y = n.clone().cross(x)
  const contour = verts.map((v) => {
    const d = v.clone().sub(o)
    return new THREE.Vector2(d.dot(x), d.dot(y))
  })
  let tris: number[][] = []
  try {
    tris = ShapeUtils.triangulateShape(contour, [])
  } catch {
    tris = []
  }
  if (tris.length === 0) {
    for (let i = 1; i < verts.length - 1; i++) tris.push([0, i, i + 1])
  }
  const faces: THREE.Vector3[][] = []
  for (const [i0, i1, i2] of tris) {
    const a = verts[i0!]
    const b = verts[i1!]
    const c = verts[i2!]
    if (a && b && c) faces.push([a, b, c])
  }
  return faces
}

function pushTri(
  positions: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
) {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
}

function vkey(p: THREE.Vector3): string {
  return `${p.x.toFixed(5)}_${p.y.toFixed(5)}_${p.z.toFixed(5)}`
}

function snapToCurve(
  p: THREE.Vector3,
  lock: SplitLockAxis,
  curve: UV[],
): THREE.Vector3 {
  const uv = toUV(p, lock)
  return fromUV(uv.u, curveVAt(uv.u, curve), uv.w, lock)
}

function stitchLoops(
  segs: { a: THREE.Vector3; b: THREE.Vector3 }[],
  lock: SplitLockAxis,
  curve: UV[],
): THREE.Vector3[][] {
  const tab = curveArcTable(curve)
  const keyOf = (p: THREE.Vector3) => {
    const sw = toSW(p, lock, tab)
    return `${sw.x.toFixed(3)}_${sw.y.toFixed(3)}`
  }
  const adj = new Map<string, string[]>()
  const pos = new Map<string, THREE.Vector3>()
  const addNb = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka === kb) return
    if (!pos.has(ka)) pos.set(ka, a.clone())
    if (!pos.has(kb)) pos.set(kb, b.clone())
    let list = adj.get(ka)
    if (!list) {
      list = []
      adj.set(ka, list)
    }
    if (!list.includes(kb)) list.push(kb)
  }
  for (const s of segs) {
    addNb(s.a, s.b)
    addNb(s.b, s.a)
  }

  const ends = [...adj.entries()].filter(([, nbs]) => nbs.length === 1)
  const usedEnd = new Set<string>()
  for (let i = 0; i < ends.length; i++) {
    const ka = ends[i]![0]
    if (usedEnd.has(ka)) continue
    const pa = pos.get(ka)!
    const sa = toSW(pa, lock, tab)
    let best: { kb: string; d: number } | null = null
    for (let j = i + 1; j < ends.length; j++) {
      const kb = ends[j]![0]
      if (usedEnd.has(kb)) continue
      const pb = pos.get(kb)!
      const sb = toSW(pb, lock, tab)
      const d = Math.hypot(sa.x - sb.x, sa.y - sb.y)
      if (d > 0.5) continue
      if (!best || d < best.d) best = { kb, d }
    }
    if (!best) continue
    usedEnd.add(ka)
    usedEnd.add(best.kb)
    addNb(pa, pos.get(best.kb)!)
    addNb(pos.get(best.kb)!, pa)
  }

  const used = new Set<string>()
  const eid = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const loops: THREE.Vector3[][] = []
  for (const [start, nbs] of adj) {
    for (const nk of nbs) {
      if (used.has(eid(start, nk))) continue
      const loop: THREE.Vector3[] = [pos.get(start)!.clone()]
      let prev = start
      let cur = nk
      used.add(eid(prev, cur))
      let guard = 0
      while (cur !== start && guard++ < adj.size + 2) {
        loop.push(pos.get(cur)!.clone())
        const cnn = adj.get(cur) ?? []
        const next = cnn.find(
          (p) => p !== prev && !used.has(eid(cur, p)),
        )
        if (!next) break
        used.add(eid(cur, next))
        prev = cur
        cur = next
      }
      if (cur === start && loop.length >= 3) loops.push(loop)
    }
  }
  return loops
}

/** Cut outline at this curve, independent of which half we keep. */
function collectSplineCapSegs(
  geom: THREE.BufferGeometry,
  lock: SplitLockAxis,
  curve: UV[],
): { a: THREE.Vector3; b: THREE.Vector3 }[] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const idx = geom.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const corner = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c)
  const segs: { a: THREE.Vector3; b: THREE.Vector3 }[] = []
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  for (let t = 0; t < triCount; t++) {
    va.set(pos.getX(corner(t, 0)), pos.getY(corner(t, 0)), pos.getZ(corner(t, 0)))
    vb.set(pos.getX(corner(t, 1)), pos.getY(corner(t, 1)), pos.getZ(corner(t, 1)))
    vc.set(pos.getX(corner(t, 2)), pos.getY(corner(t, 2)), pos.getZ(corner(t, 2)))
    const poly = clipPolygonAgainstCurve([va, vb, vc], lock, curve, true)
    if (poly.length < 2) continue
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      if (a.onCut && b.onCut) {
        segs.push({
          a: snapToCurve(a.p, lock, curve),
          b: snapToCurve(b.p, lock, curve),
        })
      }
    }
  }
  return segs
}

function signedAreaXY(loop: THREE.Vector3[]): number {
  let a = 0
  const n = loop.length
  for (let i = 0; i < n; i++) {
    const p = loop[i]!
    const q = loop[(i + 1) % n]!
    a += p.x * q.y - q.x * p.y
  }
  return a * 0.5
}

function orientLoop(loop: THREE.Vector3[], wantCcw: boolean): THREE.Vector3[] {
  const ccw = signedAreaXY(loop) > 0
  return ccw === wantCcw ? loop : [...loop].reverse()
}

function cleanLoop2(loop: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (const p of loop) {
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(p) < 1e-12) continue
    out.push(p)
  }
  if (
    out.length > 1 &&
    out[0]!.distanceToSquared(out[out.length - 1]!) < 1e-12
  ) {
    out.pop()
  }
  return out
}

type ArcSample = { s: number; u: number; v: number }

function curveArcTable(curve: UV[]): ArcSample[] {
  const tab: ArcSample[] = [{ s: 0, u: curve[0]!.u, v: curve[0]!.v }]
  let s = 0
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!
    const b = curve[i]!
    s += Math.hypot(b.u - a.u, b.v - a.v)
    tab.push({ s, u: b.u, v: b.v })
  }
  return tab
}

function toSW(
  p: THREE.Vector3,
  lock: SplitLockAxis,
  tab: ArcSample[],
): THREE.Vector3 {
  const uv = toUV(p, lock)
  let bestS = 0
  let bestD = Infinity
  for (let i = 0; i < tab.length - 1; i++) {
    const a = tab[i]!
    const b = tab[i + 1]!
    const du = b.u - a.u
    const dv = b.v - a.v
    const len2 = du * du + dv * dv
    let t = 0
    if (len2 > EPS) {
      t = THREE.MathUtils.clamp(
        ((uv.u - a.u) * du + (uv.v - a.v) * dv) / len2,
        0,
        1,
      )
    }
    const pu = a.u + du * t
    const pv = a.v + dv * t
    const d = Math.hypot(uv.u - pu, uv.v - pv)
    if (d < bestD) {
      bestD = d
      bestS = a.s + Math.sqrt(len2) * t
    }
  }
  return new THREE.Vector3(bestS, uv.w, 0)
}

function fromSW(
  s: number,
  w: number,
  lock: SplitLockAxis,
  tab: ArcSample[],
): THREE.Vector3 {
  const last = tab[tab.length - 1]!
  if (s <= tab[0]!.s) return fromUV(tab[0]!.u, tab[0]!.v, w, lock)
  if (s >= last.s) return fromUV(last.u, last.v, w, lock)
  for (let i = 0; i < tab.length - 1; i++) {
    const a = tab[i]!
    const b = tab[i + 1]!
    if (s >= a.s - EPS && s <= b.s + EPS) {
      const ds = b.s - a.s
      const t = ds < EPS ? 0 : (s - a.s) / ds
      return fromUV(a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t, w, lock)
    }
  }
  return fromUV(last.u, last.v, w, lock)
}

function capOnCurve(
  loops: THREE.Vector3[][],
  lock: SplitLockAxis,
  curve: UV[],
  keepBelow: boolean,
): number[] {
  const tab = curveArcTable(curve)
  const swLoops = loops
    .map((loop) => cleanLoop2(loop.map((p) => toSW(p, lock, tab))))
    .filter((loop) => loop.length >= 3)
  const regions = nestCutLoops(swLoops)
  const positions: number[] = []
  const wantCcw = keepBelow
  const lift = (s: number, w: number) => fromSW(s, w, lock, tab)
  for (const region of regions) {
    const outer = cleanLoop2(orientLoop(region.outer, wantCcw))
    const holeLoops = region.holes.map((h) =>
      cleanLoop2(orientLoop(h, !wantCcw)),
    )
    if (outer.length < 3) continue
    const contour = outer.map((p) => new THREE.Vector2(p.x, p.y))
    const holes = holeLoops
      .filter((h) => h.length >= 3)
      .map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)))
    let tris: number[][] = []
    try {
      tris = ShapeUtils.triangulateShape(contour, holes)
    } catch {
      tris = []
    }
    let pool = [...contour, ...holes.flat()]
    if (tris.length === 0) {
      try {
        tris = ShapeUtils.triangulateShape(contour, [])
      } catch {
        tris = []
      }
      pool = contour
    }
    if (tris.length === 0) {
      for (let i = 1; i < contour.length - 1; i++) tris.push([0, i, i + 1])
      pool = contour
    }
    for (const [i0, i1, i2] of tris) {
      const a = pool[i0!]
      const b = pool[i1!]
      const c = pool[i2!]
      if (!a || !b || !c) continue
      pushTri(positions, lift(a.x, a.y), lift(b.x, b.y), lift(c.x, c.y))
    }
  }
  return positions
}

/**
 * Keep the portion of `geom` on one side of an extruded spline.
 * Classification ignores the lock-axis coordinate (band-saw cut).
 */
export function clipToSplineSide(
  geom: THREE.BufferGeometry,
  lock: SplitLockAxis,
  spline: THREE.Vector3[],
  side: 'below' | 'above',
  opts?: { cap?: boolean; vOffset?: number },
): THREE.BufferGeometry {
  geom.computeBoundingBox()
  const bbox = geom.boundingBox!.clone()
  bbox.expandByScalar(1)
  const curve = buildCurveUV(spline, lock, bbox, opts?.vOffset ?? 0)
  if (curve.length < 2) {
    const empty = new THREE.BufferGeometry()
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    return empty
  }

  const keepBelow = side === 'below'
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const idx = geom.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const corner = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c)

  const positions: number[] = []
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    va.set(pos.getX(corner(t, 0)), pos.getY(corner(t, 0)), pos.getZ(corner(t, 0)))
    vb.set(pos.getX(corner(t, 1)), pos.getY(corner(t, 1)), pos.getZ(corner(t, 1)))
    vc.set(pos.getX(corner(t, 2)), pos.getY(corner(t, 2)), pos.getZ(corner(t, 2)))
    const poly = clipPolygonAgainstCurve([va, vb, vc], lock, curve, keepBelow)
    if (poly.length < 3) continue
    const pts = poly.map((x) => x.p)
    for (const [a, b, c] of triangulatePoly(pts)) {
      pushTri(positions, a, b, c)
    }
  }

  if (opts?.cap !== false) {
    const capSegs = collectSplineCapSegs(geom, lock, curve)
    positions.push(
      ...capOnCurve(stitchLoops(capSegs, lock, curve), lock, curve, keepBelow),
    )
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}
