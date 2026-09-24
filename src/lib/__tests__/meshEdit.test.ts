import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyCapturedMove,
  applyMeshBoolean,
  capturePositions,
  draftCutterGeometry,
  primitiveGeometry,
  weldedVertexIndices,
} from '../meshEdit'

describe('meshEdit', () => {
  it('moves welded corners and keeps the triangle count', () => {
    const geom = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
    const before = geom.getAttribute('position').count
    const indices = weldedVertexIndices(geom, [0])
    expect(indices.length).toBeGreaterThanOrEqual(3)
    const base = capturePositions(geom, indices)
    const x0 = base[0]!
    applyCapturedMove(geom, indices, base, new THREE.Vector3(1, 0, 0))
    expect(geom.getAttribute('position').count).toBe(before)
    expect(geom.getAttribute('position').getX(indices[0]!)).toBeCloseTo(x0 + 1)
  })

  it('places the cutter at the draft position', () => {
    const cutter = draftCutterGeometry({
      op: 'subtract',
      kind: 'box',
      size: 4,
      position: [10, 0, 2],
      stl: null,
    })
    cutter.computeBoundingBox()
    const box = cutter.boundingBox!
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(10)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(2)
  })

  it('subtracts a box from a box', async () => {
    const target = new THREE.BoxGeometry(4, 4, 4).toNonIndexed()
    const cutter = primitiveGeometry('box', new THREE.Vector3(2, 0, 0), 4)
    const out = await applyMeshBoolean(target, cutter, 'subtract')
    expect(out.getAttribute('position').count).toBeGreaterThan(0)
    expect(out.getAttribute('position').count).not.toBe(
      target.getAttribute('position').count,
    )
  })
})
