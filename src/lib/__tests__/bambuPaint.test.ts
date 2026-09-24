import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import {
  assignBambuExtruders,
  bambuPaintCode,
  buildBambu3mf,
  colorIdsOnResultMesh,
} from '../bambuPaint'
import { insertExportRole } from '../extrude'

describe('insertExportRole', () => {
  it('keeps bottom fuse for split only', () => {
    expect(insertExportRole(undefined, false)).toBe('insert')
    expect(insertExportRole('paint', true)).toBe('paint')
    expect(insertExportRole('bottom', false)).toBe('insert')
    expect(insertExportRole('bottom', true)).toBe('bottom')
  })
})

describe('colorIdsOnResultMesh', () => {
  it('paints result triangles that still sit on a painted source face', () => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5],
        3,
      ),
    )
    const bvh = new MeshBVH(geom, { indirect: true })
    const colors = colorIdsOnResultMesh(
      geom,
      bvh,
      new Map([[0, 'red']]),
    )
    expect(colors[0]).toBe('red')
    expect(colors[1]).toBeUndefined()
  })
})

describe('bambuPaintCode', () => {
  it('matches Bambu Studio unsplit triangle codes', () => {
    expect(bambuPaintCode(1)).toBe('4')
    expect(bambuPaintCode(2)).toBe('8')
    expect(bambuPaintCode(3)).toBe('0C')
    expect(bambuPaintCode(4)).toBe('1C')
    expect(bambuPaintCode(5)).toBe('2C')
    expect(bambuPaintCode(16)).toBe('DC')
    expect(bambuPaintCode(18)).toBe('0FC')
  })
})

describe('assignBambuExtruders', () => {
  it('puts body on slot 1 and paints later regions over earlier ones', () => {
    const { filaments, faceExtruder } = assignBambuExtruders({
      triCount: 4,
      palette: [
        { id: 'red', name: 'Red', hex: '#e74c3c' },
        { id: 'blue', name: 'Blue', hex: '#5ec8ff' },
      ],
      regions: [
        { colorId: 'blue', faces: [1, 2] },
        { colorId: 'red', faces: [2, 3] },
      ],
    })
    expect(filaments.map((f) => f.name)).toEqual(['Body', 'Red', 'Blue'])
    expect(filaments[1]!.hex).toBe('#E74C3C')
    expect([...faceExtruder]).toEqual([0, 3, 2, 2])
  })
})

describe('buildBambu3mf', () => {
  it('writes paint_color on painted triangles only', () => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
        3,
      ),
    )
    const insert = new THREE.BufferGeometry()
    insert.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([2, 0, 0, 3, 0, 0, 2, 1, 0], 3),
    )
    const bytes = buildBambu3mf({
      filaments: [
        { name: 'Body', hex: '#B0B0B0' },
        { name: 'Red', hex: '#e74c3c' },
      ],
      objects: [
        {
          name: 'box.stl',
          geometry: geom,
          faceExtruder: [0, 2],
          plate: 1,
        },
        { name: 'Red', geometry: insert, extruder: 2, plate: 2 },
      ],
    })
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('paint_color="8"')
    expect(text).not.toContain('paint_color="4"')
    expect(text).toContain('#E74C3C')
    expect(text).toContain('3D/3dmodel.model')
    expect(text).toContain('1 0 0 0 1 0 0 0 1 127.5 127.5 0')
    expect(text).toContain('1 0 0 0 1 0 0 0 1 432.7 127.5 0')
    expect(text).toContain('BambuStudio-02.08.02.60')
    expect(text).toContain('Bambu Lab P1S')
    expect(text).toContain('plater_id" value="2"')
    expect(text).toContain('object_id" value="2"')
  })
})
