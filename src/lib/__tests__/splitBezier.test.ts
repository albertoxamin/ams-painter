import { describe, expect, it } from 'vitest'
import {
  insertNodeAt,
  parseSplitPathNode,
  sampleSplitPath,
  serializeNode,
} from '../splitBezier'

describe('splitBezier', () => {
  it('samples a straight corner path as a polyline', () => {
    const pts = sampleSplitPath([
      { x: 0, y: 0, z: 0, mode: 'corner' },
      { x: 10, y: 0, z: 0, mode: 'corner' },
    ])
    expect(pts).toHaveLength(2)
    expect(pts[0]!.x).toBeCloseTo(0)
    expect(pts[1]!.x).toBeCloseTo(10)
  })

  it('samples a cubic at t=0.5', () => {
    const pts = sampleSplitPath(
      [
        { x: 0, y: 0, z: 0, mode: 'mirrored', out: { x: 0, y: 0, z: 3 } },
        { x: 3, y: 0, z: 0, mode: 'mirrored', in: { x: 0, y: 0, z: 3 } },
      ],
      2,
    )
    expect(pts).toHaveLength(3)
    expect(pts[1]!.x).toBeCloseTo(1.5)
    expect(pts[1]!.z).toBeCloseTo(2.25)
  })

  it('inserts a node that stays on the curve', () => {
    const nodes = [
      { x: 0, y: 0, z: 0, mode: 'mirrored' as const, out: { x: 0, y: 0, z: 3 } },
      { x: 3, y: 0, z: 0, mode: 'mirrored' as const, in: { x: 0, y: 0, z: 3 } },
    ]
    const next = insertNodeAt(nodes, 0, 0.5)
    expect(next).toHaveLength(3)
    expect(next[1]!.x).toBeCloseTo(1.5)
    expect(next[1]!.z).toBeCloseTo(2.25)
  })

  it('parses legacy xyz points and handle payloads', () => {
    expect(parseSplitPathNode({ x: 1, y: 2, z: 3 })).toEqual({
      x: 1,
      y: 2,
      z: 3,
    })
    const n = parseSplitPathNode({
      x: 0,
      y: 0,
      z: 0,
      mode: 'mirrored',
      out: { x: 1, y: 0, z: 0 },
      in: { x: -1, y: 0, z: 0 },
    })
    expect(n?.out).toEqual({ x: 1, y: 0, z: 0 })
    expect(serializeNode(n!).out).toEqual({ x: 1, y: 0, z: 0 })
  })
})
