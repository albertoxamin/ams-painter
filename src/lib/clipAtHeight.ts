import * as THREE from 'three'
import { ShapeUtils } from 'three'

const EPS = 1e-8

function vkey(p: THREE.Vector3): string {
  return `${p.x.toFixed(5)}_${p.y.toFixed(5)}_${p.z.toFixed(5)}`
}

function lerpOnZ(
  a: THREE.Vector3,
  b: THREE.Vector3,
  H: number,
): THREE.Vector3 {
  const dz = b.z - a.z
  if (Math.abs(dz) < EPS) return new THREE.Vector3(a.x, a.y, H)
  const u = (H - a.z) / dz
  return new THREE.Vector3(
    a.x + (b.x - a.x) * u,
    a.y + (b.y - a.y) * u,
    H,
  )
}

function clipPolygonAgainstZ(
  verts: THREE.Vector3[],
  H: number,
  keepBelow: boolean,
): THREE.Vector3[] {
  const inside = (p: THREE.Vector3) =>
    keepBelow ? p.z <= H + EPS : p.z >= H - EPS
  const out: THREE.Vector3[] = []
  const n = verts.length
  for (let i = 0; i < n; i++) {
    const s = verts[i]!
    const e = verts[(i + 1) % n]!
    const sIn = inside(s)
    const eIn = inside(e)
    if (eIn) {
      if (!sIn) out.push(lerpOnZ(s, e, H))
      out.push(e.clone())
    } else if (sIn) {
      out.push(lerpOnZ(s, e, H))
    }
  }
  return out
}

function pushTri(
  positions: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
) {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
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

function stitchLoops(
  segs: { a: THREE.Vector3; b: THREE.Vector3 }[],
): THREE.Vector3[][] {
  const adj = new Map<string, THREE.Vector3[]>()
  const pos = new Map<string, THREE.Vector3>()
  const addNb = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ka = vkey(a)
    const kb = vkey(b)
    if (ka === kb) return
    pos.set(ka, a.clone())
    pos.set(kb, b.clone())
    let list = adj.get(ka)
    if (!list) {
      list = []
      adj.set(ka, list)
    }
    if (!list.some((p) => vkey(p) === kb)) list.push(b.clone())
  }
  for (const s of segs) {
    addNb(s.a, s.b)
    addNb(s.b, s.a)
  }

  const used = new Set<string>()
  const eid = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const loops: THREE.Vector3[][] = []

  for (const [start, nbs] of adj) {
    for (const nb of nbs) {
      const nk = vkey(nb)
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
          (p) => vkey(p) !== prev && !used.has(eid(cur, vkey(p))),
        )
        if (!next) break
        used.add(eid(cur, vkey(next)))
        prev = cur
        cur = vkey(next)
      }
      if (cur === start && loop.length >= 3) loops.push(loop)
    }
  }
  return loops
}

function pointInLoop(x: number, y: number, loop: THREE.Vector3[]): boolean {
  let inside = false
  const n = loop.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = loop[i]!
    const pj = loop[j]!
    const intersect =
      pi.y > y !== pj.y > y &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y + 1e-30) + pi.x
    if (intersect) inside = !inside
  }
  return inside
}

export type CutRegion = { outer: THREE.Vector3[]; holes: THREE.Vector3[][] }

/** True if (x,y) is in the cut solid: inside an outer loop, not in a hole. */
export function inCutRegion(x: number, y: number, regions: CutRegion[]): boolean {
  for (const r of regions) {
    if (!pointInLoop(x, y, r.outer)) continue
    if (r.holes.some((h) => pointInLoop(x, y, h))) continue
    return true
  }
  return false
}

export function nestCutLoops(loops: THREE.Vector3[][]): CutRegion[] {
  const items = loops
    .map((loop) => ({ loop, area: signedAreaXY(loop) }))
    .filter((l) => Math.abs(l.area) > 1e-10)
  items.sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
  const parent = items.map(() => -1)
  for (let i = 0; i < items.length; i++) {
    const probe = items[i]!.loop[0]!
    for (let j = i - 1; j >= 0; j--) {
      if (pointInLoop(probe.x, probe.y, items[j]!.loop)) {
        parent[i] = j
        break
      }
    }
  }
  const depthOf = (i: number) => {
    let d = 0
    let k = i
    while (parent[k]! >= 0) {
      k = parent[k]!
      d++
    }
    return d
  }
  const holesOf: THREE.Vector3[][][] = items.map(() => [])
  for (let i = 0; i < items.length; i++) {
    const p = parent[i]!
    if (p >= 0 && depthOf(i) % 2 === 1) holesOf[p]!.push(items[i]!.loop)
  }
  const regions: CutRegion[] = []
  for (let i = 0; i < items.length; i++) {
    if (depthOf(i) % 2 === 0) {
      regions.push({ outer: items[i]!.loop, holes: holesOf[i]! })
    }
  }
  return regions
}

function orientLoop(loop: THREE.Vector3[], wantCcw: boolean): THREE.Vector3[] {
  const ccw = signedAreaXY(loop) > 0
  return ccw === wantCcw ? loop : [...loop].reverse()
}

function filterCavityHoles(regions: CutRegion[], maxHoleRatio: number): CutRegion[] {
  return regions.map((r) => {
    const outerA = Math.abs(signedAreaXY(r.outer))
    if (outerA < 1e-10) return r
    return {
      outer: r.outer,
      holes: r.holes.filter(
        (h) => Math.abs(signedAreaXY(h)) / outerA < maxHoleRatio,
      ),
    }
  })
}

function capTriangles(
  regions: CutRegion[],
  H: number,
  keepBelow: boolean,
): number[] {
  const positions: number[] = []
  const wantCcw = keepBelow
  for (const region of regions) {
    const outer = orientLoop(region.outer, wantCcw)
    const holeLoops = region.holes.map((h) => orientLoop(h, !wantCcw))
    const contour = outer.map((p) => new THREE.Vector2(p.x, p.y))
    const holes = holeLoops.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)))
    let tris: number[][] = []
    try {
      tris = ShapeUtils.triangulateShape(contour, holes)
    } catch {
      for (let i = 1; i < contour.length - 1; i++) tris.push([0, i, i + 1])
    }
    const verts = [...contour, ...holes.flat()]
    for (const [i0, i1, i2] of tris) {
      const a = verts[i0!]
      const b = verts[i1!]
      const c = verts[i2!]
      if (!a || !b || !c) continue
      pushTri(
        positions,
        new THREE.Vector3(a.x, a.y, H),
        new THREE.Vector3(b.x, b.y, H),
        new THREE.Vector3(c.x, c.y, H),
      )
    }
  }
  return positions
}

function collectCutSegs(
  geom: THREE.BufferGeometry,
  H: number,
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
    const poly = clipPolygonAgainstZ([va, vb, vc], H, true)
    if (poly.length < 2) continue
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      if (Math.abs(a.z - H) <= 2 * EPS && Math.abs(b.z - H) <= 2 * EPS) {
        segs.push({ a: a.clone(), b: b.clone() })
      }
    }
  }
  return segs
}

/** Cut-plane solid (outers minus holes) of `geom` at z=H. */
export function cutRegionsAtHeight(
  geom: THREE.BufferGeometry,
  H: number,
): CutRegion[] {
  return nestCutLoops(stitchLoops(collectCutSegs(geom, H)))
}

/**
 * Keep the portion of `geom` on one side of plane z=H and cap the cut.
 * Caps use the cut outline. Small holes stay empty (inserts). On the upper,
 * large interior loops (hollow body cavity) are filled so the part has a
 * solid first layer; overhangs outside the outline (mirrors) are not capped.
 */
export function clipToSide(
  geom: THREE.BufferGeometry,
  H: number,
  side: 'below' | 'above',
  opts?: { fillCavities?: boolean; cap?: boolean },
): THREE.BufferGeometry {
  const keepBelow = side === 'below'
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const idx = geom.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const corner = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c)

  const positions: number[] = []
  const capSegs: { a: THREE.Vector3; b: THREE.Vector3 }[] = []
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    va.set(pos.getX(corner(t, 0)), pos.getY(corner(t, 0)), pos.getZ(corner(t, 0)))
    vb.set(pos.getX(corner(t, 1)), pos.getY(corner(t, 1)), pos.getZ(corner(t, 1)))
    vc.set(pos.getX(corner(t, 2)), pos.getY(corner(t, 2)), pos.getZ(corner(t, 2)))
    const poly = clipPolygonAgainstZ([va, vb, vc], H, keepBelow)
    if (poly.length < 3) continue

    for (let i = 1; i < poly.length - 1; i++) {
      pushTri(positions, poly[0]!, poly[i]!, poly[i + 1]!)
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      if (Math.abs(a.z - H) <= 2 * EPS && Math.abs(b.z - H) <= 2 * EPS) {
        capSegs.push({ a: a.clone(), b: b.clone() })
      }
    }
  }

  const regions = nestCutLoops(stitchLoops(capSegs))
  if (opts?.cap !== false) {
    const capped = opts?.fillCavities
      ? filterCavityHoles(regions, 0.25)
      : regions
    positions.push(...capTriangles(capped, H, keepBelow))
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/**
 * Flatten `geom`'s triangles onto z=`planeZ` (skip walls that collapse to a line).
 * Used to copy the bottom split's XY onto the upper cut so the upper can sit
 * on the bottom without projecting mirrors or filling window openings in the skin.
 */
export function projectSilhouetteOntoPlane(
  geom: THREE.BufferGeometry,
  planeZ: number,
  facing: 'up' | 'down' = 'down',
): THREE.BufferGeometry {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const idx = geom.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const corner = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c)
  const positions: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    a.set(pos.getX(corner(t, 0)), pos.getY(corner(t, 0)), planeZ)
    b.set(pos.getX(corner(t, 1)), pos.getY(corner(t, 1)), planeZ)
    c.set(pos.getX(corner(t, 2)), pos.getY(corner(t, 2)), planeZ)
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(area) < 1e-10) continue
    const ccw = area > 0
    const wantCcw = facing === 'up'
    if (ccw === wantCcw) pushTri(positions, a, b, c)
    else pushTri(positions, a, c, b)
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}
