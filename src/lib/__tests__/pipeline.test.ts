import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { loadSTL } from '../loadSTL'
import { buildInsert } from '../extrude'
import { splitAlongSpline, splitAtHeight } from '../split'
import { clipToSplineSide, buildCurveUV, toUV, curveVAt } from '../clipAlongSpline'
import { clipToSide, inCutRegion, cutRegionsAtHeight } from '../clipAtHeight'
import { discardFloatingRegions, sitOnBed } from '../exportSTL'
import { prepareParts } from '../prepareParts'
import { resolveSpanInsertFloors } from '../insertDepth'
import { selectionSpan } from '../extrude'
import { facesInsideProjectedLoop, flattenLoopOnAxis, flattenPenLoopToMeshExtreme } from '../penCutout'

describe('geometry pipeline', () => {
  it('loads test-box, builds insert, and splits', async () => {
    const fileBuf = readFileSync('public/test-box.stl')
    const buf = fileBuf.buffer.slice(
      fileBuf.byteOffset,
      fileBuf.byteOffset + fileBuf.byteLength,
    )
    const model = loadSTL(buf, 'test-box.stl')
    expect(model.count).toBeGreaterThan(0)

    const pos = model.geometry.getAttribute('position')
    let startTri = 0
    for (let t = 0; t < pos.count / 3; t++) {
      const a = t * 3
      const x0 = pos.getX(a)
      const y0 = pos.getY(a)
      const x1 = pos.getX(a + 1)
      const y1 = pos.getY(a + 1)
      const x2 = pos.getX(a + 2)
      const y2 = pos.getY(a + 2)
      const nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
      if (nz > 0.99) {
        startTri = t
        break
      }
    }

    const sel = new Set([startTri])
    const H = (model.zMin + model.zMax) / 2
    const { lower, upper } = await splitAtHeight(model.geometry, H)
    expect(lower.getAttribute('position').count).toBeGreaterThan(0)
    expect(upper.getAttribute('position').count).toBeGreaterThan(0)

    const insert = buildInsert(model.geometry, sel, model.zMin)
    expect(insert).not.toBeNull()
    expect(insert!.getAttribute('position').count).toBeGreaterThan(0)

    const prepared = await prepareParts(
      model.geometry,
      H,
      new Set(),
      sel,
      model.zMin,
      0.15,
      { dropInFloorZ: H, adjacency: model.adjacency },
    )
    expect(prepared.dropIns.length).toBe(0)
    expect(prepared.upper).not.toBeNull()
  })

  it('plane-clips a box without remeshing', async () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    box.translate(0, 0, 5)
    const lower = clipToSide(box, 5, 'below')
    const upper = clipToSide(box, 5, 'above')
    expect(lower.getAttribute('position').count).toBeGreaterThan(0)
    expect(upper.getAttribute('position').count).toBeGreaterThan(0)
    lower.computeBoundingBox()
    upper.computeBoundingBox()
    expect(lower.boundingBox!.max.z).toBeLessThanOrEqual(5.01)
    expect(upper.boundingBox!.min.z).toBeGreaterThanOrEqual(4.99)

    const printable = sitOnBed(discardFloatingRegions(upper))
    printable.computeBoundingBox()
    expect(printable.boundingBox!.min.z).toBeCloseTo(0, 5)
  })

  it('caps the cut with holes empty and does not drop overhangs', () => {
    const outline = new THREE.Shape()
    outline.absellipse(0, 0, 6, 6, 0, Math.PI * 2, false)
    const hole = new THREE.Path()
    hole.absellipse(0, 0, 2, 2, 0, Math.PI * 2, true)
    outline.holes.push(hole)
    const body = new THREE.ExtrudeGeometry(outline, {
      depth: 10,
      bevelEnabled: false,
      curveSegments: 24,
    })
    const mirror = new THREE.BoxGeometry(1.5, 1.5, 1.5)
    mirror.translate(8, 0, 8)
    const geom = mergeGeometries(
      [
        body.index ? body.toNonIndexed() : body,
        mirror.index ? mirror.toNonIndexed() : mirror,
      ],
      false,
    )!
    const upper = clipToSide(geom, 5, 'above', { fillCavities: true })
    const regions = cutRegionsAtHeight(geom, 5)
    expect(inCutRegion(0, 0, regions)).toBe(false)
    expect(inCutRegion(4, 0, regions)).toBe(true)
    expect(inCutRegion(8, 0, regions)).toBe(false)

    const pos = upper.getAttribute('position') as THREE.BufferAttribute
    let holeCap = 0
    let mirrorKept = 0
    for (let t = 0; t < pos.count / 3; t++) {
      const a = t * 3
      const x = (pos.getX(a) + pos.getX(a + 1) + pos.getX(a + 2)) / 3
      const y = (pos.getY(a) + pos.getY(a + 1) + pos.getY(a + 2)) / 3
      const z = (pos.getZ(a) + pos.getZ(a + 1) + pos.getZ(a + 2)) / 3
      if (Math.abs(z - 5) < 0.05 && Math.hypot(x, y) < 1.5) holeCap++
      if (z > 7 && x > 7) mirrorKept++
    }
    expect(holeCap).toBe(0)
    expect(mirrorKept).toBeGreaterThan(0)

    const cavity = new THREE.Shape()
    cavity.absellipse(0, 0, 6, 6, 0, Math.PI * 2, false)
    const inner = new THREE.Path()
    inner.absellipse(0, 0, 5, 5, 0, Math.PI * 2, true)
    cavity.holes.push(inner)
    const hollow = new THREE.ExtrudeGeometry(cavity, {
      depth: 10,
      bevelEnabled: false,
      curveSegments: 24,
    })
    const filled = clipToSide(hollow, 5, 'above', { fillCavities: true })
    const fp = filled.getAttribute('position') as THREE.BufferAttribute
    let centerCap = 0
    for (let t = 0; t < fp.count / 3; t++) {
      const a = t * 3
      const x = (fp.getX(a) + fp.getX(a + 1) + fp.getX(a + 2)) / 3
      const y = (fp.getY(a) + fp.getY(a + 1) + fp.getY(a + 2)) / 3
      const z = (fp.getZ(a) + fp.getZ(a + 1) + fp.getZ(a + 2)) / 3
      if (Math.abs(z - 5) < 0.05 && Math.hypot(x, y) < 1) centerCap++
    }
    expect(centerCap).toBeGreaterThan(0)
  })

  it('boolean-cuts the upper as model minus bottom', async () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    box.translate(0, 0, 5)
    const { lower, upper } = await splitAtHeight(box, 5, 0.2)
    expect(lower.getAttribute('position').count).toBeGreaterThan(0)
    expect(upper.getAttribute('position').count).toBeGreaterThan(0)
    lower.computeBoundingBox()
    upper.computeBoundingBox()
    expect(upper.boundingBox!.min.z).toBeGreaterThanOrEqual(
      lower.boundingBox!.max.z - 0.05,
    )
    expect(upper.boundingBox!.max.z).toBeGreaterThan(8)
  })

  it(
    'splits a closed mesh with 4-face self-touching edges',
    async () => {
      const a = new THREE.BoxGeometry(10, 10, 10)
      a.translate(0, 0, 5)
      const geom = mergeVertices(mergeGeometries([a, a.clone()])!, 1e-4)
      const { lower, upper } = await splitAtHeight(geom, 5, 0.15)
      expect(lower.getAttribute('position').count).toBeGreaterThan(0)
      expect(upper.getAttribute('position').count).toBeGreaterThan(0)
    },
    30_000,
  )

  it('spline-clips a box like a mid-height cut when lock is Y', async () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    box.translate(0, 0, 5)
    const spline = [
      new THREE.Vector3(-20, 0, 5),
      new THREE.Vector3(20, 0, 5),
    ]
    const lower = clipToSplineSide(box, 'y', spline, 'below')
    lower.computeBoundingBox()
    expect(lower.getAttribute('position').count).toBeGreaterThan(0)
    expect(lower.boundingBox!.max.z).toBeLessThanOrEqual(5.15)

    const { upper } = await splitAlongSpline(box, 'y', spline, 0)
    upper.computeBoundingBox()
    expect(upper.boundingBox!.min.z).toBeGreaterThanOrEqual(4.85)
    expect(upper.boundingBox!.max.z).toBeGreaterThan(8)
  })

  it('spline-clips a slanted line so lower max-Z varies with X', () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    box.translate(0, 0, 5)
    const spline = [
      new THREE.Vector3(-20, 0, 2),
      new THREE.Vector3(20, 0, 8),
    ]
    const lower = clipToSplineSide(box, 'y', spline, 'below')
    const pos = lower.getAttribute('position') as THREE.BufferAttribute
    let maxZAtNegX = -Infinity
    let maxZAtPosX = -Infinity
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      if (x < -2) maxZAtNegX = Math.max(maxZAtNegX, z)
      if (x > 2) maxZAtPosX = Math.max(maxZAtPosX, z)
    }
    expect(maxZAtPosX).toBeGreaterThan(maxZAtNegX + 1)
  })

  it('caps both sides of a spline cut', async () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    box.translate(0, 0, 5)
    const spline = [
      new THREE.Vector3(-20, 0, 5),
      new THREE.Vector3(20, 0, 5),
    ]
    const { lower, upper } = await splitAlongSpline(box, 'y', spline, 0)
    const capArea = (geom: THREE.BufferGeometry) => {
      const p = geom.getAttribute('position') as THREE.BufferAttribute
      let area = 0
      for (let t = 0; t < p.count / 3; t++) {
        const a = t * 3
        const z0 = p.getZ(a)
        const z1 = p.getZ(a + 1)
        const z2 = p.getZ(a + 2)
        if (Math.abs(z0 - 5) > 0.05 || Math.abs(z1 - 5) > 0.05 || Math.abs(z2 - 5) > 0.05) {
          continue
        }
        const abx = p.getX(a + 1) - p.getX(a)
        const aby = p.getY(a + 1) - p.getY(a)
        const acx = p.getX(a + 2) - p.getX(a)
        const acy = p.getY(a + 2) - p.getY(a)
        area += 0.5 * Math.abs(abx * acy - aby * acx)
      }
      return area
    }
    expect(capArea(lower)).toBeGreaterThan(90)
    expect(capArea(upper)).toBeGreaterThan(90)
  })

  it('caps both sides of a curved spline cut', async () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    box.translate(0, 0, 5)
    const spline = [
      new THREE.Vector3(-20, 0, 5),
      new THREE.Vector3(0, 0, 7),
      new THREE.Vector3(20, 0, 5),
    ]
    const { lower, upper } = await splitAlongSpline(box, 'y', spline, 0)
    const onCutArea = (geom: THREE.BufferGeometry) => {
      box.computeBoundingBox()
      const bbox = box.boundingBox!.clone().expandByScalar(1)
      const curve = buildCurveUV(spline, 'y', bbox)
      const p = geom.getAttribute('position') as THREE.BufferAttribute
      let area = 0
      const va = new THREE.Vector3()
      const vb = new THREE.Vector3()
      const vc = new THREE.Vector3()
      for (let t = 0; t < p.count / 3; t++) {
        const i = t * 3
        va.set(p.getX(i), p.getY(i), p.getZ(i))
        vb.set(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1))
        vc.set(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2))
        const on = [va, vb, vc].every((q) => {
          const uv = toUV(q, 'y')
          return Math.abs(uv.v - curveVAt(uv.u, curve)) < 0.08
        })
        if (!on) continue
        const ab = vb.clone().sub(va)
        const ac = vc.clone().sub(va)
        area += 0.5 * ab.cross(ac).length()
      }
      return area
    }
    expect(onCutArea(lower)).toBeGreaterThan(80)
    expect(onCutArea(upper)).toBeGreaterThan(80)
  })

  it('does not cap original holes or a hollow interior', async () => {
    const outline = new THREE.Shape()
    outline.absellipse(0, 0, 6, 6, 0, Math.PI * 2, false)
    const hole = new THREE.Path()
    hole.absellipse(0, 0, 2, 2, 0, Math.PI * 2, true)
    outline.holes.push(hole)
    const body = new THREE.ExtrudeGeometry(outline, {
      depth: 10,
      bevelEnabled: false,
      curveSegments: 24,
    })
    const spline = [
      new THREE.Vector3(-20, 0, 5),
      new THREE.Vector3(20, 0, 5),
    ]
    const { lower, upper } = await splitAlongSpline(body, 'y', spline, 0)

    const countCap = (geom: THREE.BufferGeometry, pred: (x: number, y: number) => boolean) => {
      const p = geom.getAttribute('position') as THREE.BufferAttribute
      let n = 0
      for (let t = 0; t < p.count / 3; t++) {
        const a = t * 3
        const z0 = p.getZ(a)
        const z1 = p.getZ(a + 1)
        const z2 = p.getZ(a + 2)
        if (Math.abs(z0 - 5) > 0.05 || Math.abs(z1 - 5) > 0.05 || Math.abs(z2 - 5) > 0.05) {
          continue
        }
        const x = (p.getX(a) + p.getX(a + 1) + p.getX(a + 2)) / 3
        const y = (p.getY(a) + p.getY(a + 1) + p.getY(a + 2)) / 3
        if (pred(x, y)) n++
      }
      return n
    }

    expect(countCap(lower, (x, y) => Math.hypot(x, y) < 1.5)).toBe(0)
    expect(countCap(upper, (x, y) => Math.hypot(x, y) < 1.5)).toBe(0)
    expect(countCap(lower, (x, y) => {
      const r = Math.hypot(x, y)
      return r > 3 && r < 5.5
    })).toBeGreaterThan(0)
    expect(countCap(upper, (x, y) => {
      const r = Math.hypot(x, y)
      return r > 3 && r < 5.5
    })).toBeGreaterThan(0)

    const cavity = new THREE.Shape()
    cavity.absellipse(0, 0, 6, 6, 0, Math.PI * 2, false)
    const inner = new THREE.Path()
    inner.absellipse(0, 0, 5, 5, 0, Math.PI * 2, true)
    cavity.holes.push(inner)
    const hollow = new THREE.ExtrudeGeometry(cavity, {
      depth: 10,
      bevelEnabled: false,
      curveSegments: 24,
    })
    const hollowSplit = await splitAlongSpline(hollow, 'y', spline, 0)
    expect(countCap(hollowSplit.upper, (x, y) => Math.hypot(x, y) < 1)).toBe(0)
    expect(countCap(hollowSplit.lower, (x, y) => Math.hypot(x, y) < 1)).toBe(0)
  })

  it('caps both halves of an open-ended tube', async () => {
    const tube = new THREE.CylinderGeometry(4, 4, 12, 24, 1, true)
    tube.rotateX(Math.PI / 2)
    tube.translate(0, 0, 6)
    const spline = [
      new THREE.Vector3(-20, 0, 6),
      new THREE.Vector3(20, 0, 6),
    ]
    const { lower, upper } = await splitAlongSpline(tube, 'y', spline, 0)
    const capArea = (geom: THREE.BufferGeometry) => {
      const p = geom.getAttribute('position') as THREE.BufferAttribute
      let area = 0
      for (let t = 0; t < p.count / 3; t++) {
        const a = t * 3
        if (
          Math.abs(p.getZ(a) - 6) > 0.08 ||
          Math.abs(p.getZ(a + 1) - 6) > 0.08 ||
          Math.abs(p.getZ(a + 2) - 6) > 0.08
        ) {
          continue
        }
        const abx = p.getX(a + 1) - p.getX(a)
        const aby = p.getY(a + 1) - p.getY(a)
        const acx = p.getX(a + 2) - p.getX(a)
        const acy = p.getY(a + 2) - p.getY(a)
        area += 0.5 * Math.abs(abx * acy - aby * acx)
      }
      return area
    }
    expect(capArea(lower)).toBeGreaterThan(30)
    expect(capArea(upper)).toBeGreaterThan(30)
  })
})

describe('resolveSpanInsertFloors', () => {
  it('returns aligned axis and clamped floors', () => {
    const fileBuf = readFileSync('public/test-box.stl')
    const buf = fileBuf.buffer.slice(
      fileBuf.byteOffset,
      fileBuf.byteOffset + fileBuf.byteLength,
    )
    const model = loadSTL(buf, 'test-box.stl')
    const sel = new Set([0])
    const span = selectionSpan(model.geometry, sel, 'z')
    const resolved = resolveSpanInsertFloors(
      model.geometry,
      span,
      '-z',
      model.zMin,
    )
    expect(resolved.axis).toMatch(/^[+-][xyz]$/)
    expect(Number.isFinite(resolved.insertFloor)).toBe(true)
    expect(Number.isFinite(resolved.entryFloor)).toBe(true)
    expect(Number.isFinite(resolved.cutterFloor)).toBe(true)
  })
})

describe('pen projected insert', () => {
  it('keeps interior mesh faces and skips faces outside the loop', () => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          // seat (inside loop, above floor)
          -0.5, -0.5, 4, 0.5, -0.5, 4, 0, 0.5, 4,
          // body panel outside the loop
          8, -0.5, 4, 9, -0.5, 4, 8.5, 0.5, 4,
          // underbody below floor
          -0.5, -0.5, -1, 0.5, -0.5, -1, 0, 0.5, -1,
        ],
        3,
      ),
    )
    const loop = [
      new THREE.Vector3(-2, -2, 6),
      new THREE.Vector3(2, -2, 6),
      new THREE.Vector3(2, 2, 6),
      new THREE.Vector3(-2, 2, 6),
    ]
    const faces = facesInsideProjectedLoop(geom, loop, '-z', 0, 6.75)
    expect([...faces]).toEqual([0])
  })

  it('intersection keeps bumpy interior height inside the loop', async () => {
    // Floor slab + raised seat bump (not a filled prism to the loop plane)
    const base = new THREE.BoxGeometry(12, 12, 1)
    base.translate(0, 0, 0.5)
    const bump = new THREE.BoxGeometry(3, 3, 4)
    bump.translate(0, 0, 3) // z 1..5
    const merged = mergeGeometries(
      [
        base.index ? base.toNonIndexed() : base,
        bump.index ? bump.toNonIndexed() : bump,
      ],
      false,
    )
    expect(merged).not.toBeNull()
    const geom = mergeVertices(merged!)

    const prepared = await prepareParts(
      geom,
      3,
      new Set(),
      new Set(),
      0,
      0.15,
      {
        insertsOnly: true,
        penCutouts: [
          {
            id: 'pen_bump',
            loop: [
              [-4, -4, 6],
              [4, -4, 6],
              [4, 4, 6],
              [-4, 4, 6],
            ],
            meta: { axis: '-z', floor: 0, colorId: 'blue' },
          },
        ],
      },
    )
    expect(prepared.dropIns.length).toBe(1)
    const fit = prepared.dropIns[0]!
    fit.computeBoundingBox()
    const bb = fit.boundingBox!
    // Real seat bump survives (~z=5), not flattened to the loop plane (~z=6)
    expect(bb.max.z).toBeGreaterThan(4)
    expect(bb.max.z).toBeLessThan(5.6)
    expect(bb.max.z - bb.min.z).toBeGreaterThan(3.5)
  })

  it('flattens a loop onto the furthermost mesh along the cut axis', () => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -0.5, -0.5, 4, 0.5, -0.5, 4, 0, 0.5, 4,
          -0.4, -0.4, 9, 0.4, -0.4, 9, 0, 0.4, 9,
        ],
        3,
      ),
    )
    const loop = [
      new THREE.Vector3(-2, -2, 1),
      new THREE.Vector3(2, -2, 3),
      new THREE.Vector3(2, 2, 5),
      new THREE.Vector3(-2, 2, 2),
    ]
    const flat = flattenPenLoopToMeshExtreme(geom, loop, '-z')
    expect(flat.every((p) => Math.abs(p.z - 10) < 1e-6)).toBe(true)
    expect(flat[0]!.x).toBe(-2)
    const meanFlat = flattenLoopOnAxis(loop, '-z', 3)
    expect(meanFlat.every((p) => Math.abs(p.z - 3) < 1e-9)).toBe(true)
  })
})
