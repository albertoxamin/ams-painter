import { describe, expect, it } from 'vitest'
import {
  buildSelectionSnapshot,
  parseSelectionSnapshot,
  validateSnapshotForModel,
} from '../selectionSnapshot'
import { loadSTL } from '../loadSTL'
import { readFileSync } from 'node:fs'

describe('selectionSnapshot', () => {
  it('round-trips markings JSON', () => {
    const fileBuf = readFileSync('public/test-box.stl')
    const buf = fileBuf.buffer.slice(
      fileBuf.byteOffset,
      fileBuf.byteOffset + fileBuf.byteLength,
    )
    const model = loadSTL(buf, 'test-box.stl')
    const snap = buildSelectionSnapshot({
      model,
      insertsOnly: false,
      splitHeight: 5,
      cutAxis: '-z',
      dropInFloorZ: 5,
      brushColorId: 'red',
      clearance: 0.15,
      palette: [{ id: 'red', name: 'Red', hex: '#f00' }],
      structural: new Set([1, 2]),
      dropIn: new Set([3]),
      dropInMeta: new Map([
        [3, { axis: '-z', floor: 5, colorId: 'red' }],
      ]),
      penCutouts: [],
      splitMode: 'spline',
      splitLockAxis: 'y',
      splitSpline: [
        { x: 0, y: 1, z: 2 },
        {
          x: 3,
          y: 1,
          z: 4,
          mode: 'mirrored',
          in: { x: -1, y: 0, z: 0 },
          out: { x: 1, y: 0, z: 0 },
        },
      ],
    })

    const parsed = parseSelectionSnapshot(JSON.parse(JSON.stringify(snap)))
    expect(parsed.name).toBe(model.name)
    expect(parsed.tris).toBe(model.count)
    expect(parsed.structural).toEqual([1, 2])
    expect(parsed.splitMode).toBe('spline')
    expect(parsed.splitLockAxis).toBe('y')
    expect(parsed.splitSpline?.[1]?.out).toEqual({ x: 1, y: 0, z: 0 })
    expect(validateSnapshotForModel(parsed, model)).toBeNull()
  })

  it('defaults spline fields on older markings JSON', () => {
    const parsed = parseSelectionSnapshot({
      name: 'box.stl',
      tris: 12,
      structural: [],
      dropIn: [],
      splitHeight: 1,
    })
    expect(parsed.splitMode).toBe('height')
    expect(parsed.splitLockAxis).toBe('y')
    expect(parsed.splitSpline).toEqual([])
  })
})
