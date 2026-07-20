import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadSTL } from '../loadSTL'
import { buildInsert } from '../extrude'
import { splitAtHeight } from '../split'
import { resolveSpanInsertFloors } from '../insertDepth'
import { selectionSpan } from '../extrude'

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
