import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  formwareAnalysisToChecks,
  formwareBaseUrl,
  geometryToRawStlBytes,
  parseStlGeometry,
  repairStlWithFormware,
} from '../formwareRepair'

function binaryStl(triCount = 1): Uint8Array {
  const buf = new ArrayBuffer(84 + triCount * 50)
  const view = new DataView(buf)
  view.setUint32(80, triCount, true)
  for (let t = 0; t < triCount; t++) {
    const o = 84 + t * 50
    view.setFloat32(o + 12, 0, true)
    view.setFloat32(o + 16, 0, true)
    view.setFloat32(o + 20, 0, true)
    view.setFloat32(o + 24, 1, true)
    view.setFloat32(o + 28, 0, true)
    view.setFloat32(o + 32, 0, true)
    view.setFloat32(o + 36, 0, true)
    view.setFloat32(o + 40, 1, true)
    view.setFloat32(o + 44, 0, true)
  }
  return new Uint8Array(buf)
}

describe('formwareRepair', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps Formware analysis fields onto local checks', () => {
    expect(
      formwareAnalysisToChecks({
        FaceCount: 10,
        VerticesCount: 12,
        NakedEdges: 1,
        PlanarHoles: 2,
        NonPlanarHoles: 3,
        NonManifoldEdges: 4,
        InvertedNormals: 5,
        DuplicateFaces: 6,
        DegenerateFaces: 7,
        DisjointShells: 8,
      }),
    ).toEqual({
      nakedEdges: 1,
      planarHoles: 2,
      nonPlanarHoles: 3,
      nonManifoldEdges: 4,
      invertedNormals: 5,
      duplicateFaces: 6,
      degenerateFaces: 7,
      disjointShells: 8,
    })
  })

  it('uses the public fixer origin outside the browser', () => {
    expect(formwareBaseUrl()).toBe('https://fixer.formware.co')
  })

  it('round-trips a raw STL buffer through the parser', () => {
    const box = new THREE.BoxGeometry(2, 2, 2)
    const bytes = geometryToRawStlBytes(box)
    const geom = parseStlGeometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(geom.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('uploads, polls, and downloads a repaired STL', async () => {
    const repaired = binaryStl(2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/Home/UploadStl')) {
          return new Response(
            JSON.stringify({
              Id: 'job-1',
              Status: 7,
              StatusMessage: null,
              IsValidMesh: true,
              TimeFix: 12,
              Progress: 1,
              Analyzed: true,
              Fixed: true,
              QueueCount: 0,
              Analysis: {
                FaceCount: 1,
                VerticesCount: 3,
                NakedEdges: 3,
                PlanarHoles: 1,
                NonPlanarHoles: 0,
                NonManifoldEdges: 0,
                InvertedNormals: 0,
                DuplicateFaces: 0,
                DegenerateFaces: 0,
                DisjointShells: 0,
              },
              Fix: { FaceCount_Fixed: 2, VerticesCount_Fixed: 4 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('/Home/CheckV2')) {
          return new Response(
            JSON.stringify({
              Id: 'job-1',
              Status: 7,
              StatusMessage: '',
              IsValidMesh: true,
              TimeFix: 12,
              Progress: 1,
              Analyzed: true,
              Fixed: true,
              QueueCount: 0,
              Analysis: {
                FaceCount: 1,
                VerticesCount: 3,
                NakedEdges: 3,
                PlanarHoles: 1,
                NonPlanarHoles: 0,
                NonManifoldEdges: 0,
                InvertedNormals: 0,
                DuplicateFaces: 0,
                DegenerateFaces: 0,
                DisjointShells: 0,
              },
              Fix: { FaceCount_Fixed: 2, VerticesCount_Fixed: 4 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.toLowerCase().includes('downloadstl')) {
          return new Response(repaired, { status: 200 })
        }
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    const { buffer, job } = await repairStlWithFormware(binaryStl(1), 'part.stl')
    expect(job.Id).toBe('job-1')
    expect(job.Fixed).toBe(true)
    expect(buffer.byteLength).toBe(repaired.byteLength)
  })
})
