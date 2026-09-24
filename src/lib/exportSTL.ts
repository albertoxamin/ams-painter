import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { colorSlug } from '../domain/palette'
import { downloadBlob } from '../platform/io/downloadBlob'
import type { SelectionSnapshot } from './selectionSnapshot'
import { materializeDrawRange } from './manifoldOps'
import { buildAdjacency, listSelectionIslands } from './select'
import { repairExportMesh } from './meshTopology'

export type StlExportOptions = {
  /** Drop shells that do not touch the lowest Z (slicer "floating regions"). */
  dropFloating?: boolean
}

/** Translate so min Z is 0 without shifting XY (keeps bottom/upper aligned). */
export function sitOnBed(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = materializeDrawRange(geom)
  g.computeBoundingBox()
  const z = g.boundingBox?.min.z ?? 0
  if (Math.abs(z) > 1e-8) g.translate(0, 0, -z)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/**
 * Keep only triangle islands whose lowest vertex is on the part's min Z.
 * Removes leftover chips from insert cuts that otherwise float in the slicer.
 */
export function discardFloatingRegions(
  geom: THREE.BufferGeometry,
  slop = 0.35,
): THREE.BufferGeometry {
  const src = materializeDrawRange(geom)
  const soup = src.index ? src.toNonIndexed() : src
  const pos = soup.getAttribute('position') as THREE.BufferAttribute
  if (!pos || pos.count < 3) return soup

  soup.computeBoundingBox()
  const bedZ = soup.boundingBox!.min.z
  const triCount = pos.count / 3
  const all = new Set<number>()
  for (let t = 0; t < triCount; t++) all.add(t)
  const islands = listSelectionIslands(all, buildAdjacency(soup))

  const areas = islands.map((island) => {
    let area = 0
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    for (const t of island) {
      const i = t * 3
      a.set(pos.getX(i), pos.getY(i), pos.getZ(i))
      b.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1))
      c.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2))
      area += 0.5 * b.sub(a).cross(c.sub(a)).length()
    }
    return area
  })
  const totalArea = areas.reduce((s, a) => s + a, 0)

  const keep = new Set<number>()
  islands.forEach((island, i) => {
    let zmin = Infinity
    for (const t of island) {
      const a = t * 3
      zmin = Math.min(zmin, pos.getZ(a), pos.getZ(a + 1), pos.getZ(a + 2))
    }
    const big = totalArea > 0 && areas[i]! >= totalArea * 0.05
    if (zmin <= bedZ + slop || big) {
      for (const t of island) keep.add(t)
    }
  })
  if (keep.size === 0 || keep.size === triCount) return soup

  const coords: number[] = []
  for (const t of keep) {
    const a = t * 3
    for (let i = 0; i < 3; i++) {
      coords.push(pos.getX(a + i), pos.getY(a + i), pos.getZ(a + i))
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

export function prepareForPrint(
  geom: THREE.BufferGeometry,
  opts?: StlExportOptions,
): THREE.BufferGeometry {
  const cleaned = opts?.dropFloating ? discardFloatingRegions(geom) : geom
  return sitOnBed(repairExportMesh(cleaned))
}

/** STLExporter binary mode returns a DataView, not an ArrayBuffer. */
function toBinarySTLBytes(root: THREE.Object3D): Uint8Array {
  const exporter = new STLExporter()
  const parsed: unknown = exporter.parse(root, { binary: true })
  if (parsed instanceof DataView) {
    return new Uint8Array(parsed.buffer, parsed.byteOffset, parsed.byteLength)
  }
  if (parsed instanceof ArrayBuffer) {
    return new Uint8Array(parsed)
  }
  if (ArrayBuffer.isView(parsed)) {
    return new Uint8Array(parsed.buffer, parsed.byteOffset, parsed.byteLength)
  }
  // ASCII fallback
  return new TextEncoder().encode(String(parsed))
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    // Copy so ZIP parts own a compact buffer (avoids sharing large slabs)
    return Uint8Array.from(data)
  }
  if (ArrayBuffer.isView(data)) {
    return Uint8Array.from(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  }
  return new Uint8Array(data)
}

function toBinarySTLBlob(root: THREE.Object3D): Blob {
  const bytes = toBinarySTLBytes(root)
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return new Blob([ab], { type: 'application/octet-stream' })
}

export function geometryToSTLBuffer(
  geom: THREE.BufferGeometry,
  opts?: StlExportOptions,
): Uint8Array {
  const clean = prepareForPrint(geom, opts)
  return toBinarySTLBytes(new THREE.Mesh(clean))
}

export function downloadSTL(
  geom: THREE.BufferGeometry,
  filename: string,
  opts?: StlExportOptions,
): void {
  const clean = prepareForPrint(geom, opts)
  downloadBlob(toBinarySTLBlob(new THREE.Mesh(clean)), filename)
}

/**
 * Export multiple geometries as one multi-body STL (separate shells in a
 * single file — slicers like Bambu can assign colors per object).
 */
export function downloadMultiSTL(
  geoms: THREE.BufferGeometry[],
  filename: string,
): void {
  const group = new THREE.Group()
  for (const g of geoms) {
    group.add(new THREE.Mesh(materializeDrawRange(g)))
  }
  downloadBlob(toBinarySTLBlob(group), filename)
}

/** CRC-32 (ISO 3309) for ZIP local headers. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function encName(name: string): Uint8Array {
  return new TextEncoder().encode(name)
}

/** MS-DOS date/time. All zeros is read as 30 Nov 1979. */
function dosDateTime(d = new Date()): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear())
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  return { date, time }
}

/**
 * Build an uncompressed (STORE) ZIP from named binary files.
 * Enough for STL bundles; no external dependency.
 */
export function buildZipBytes(
  files: { name: string; data: ArrayBuffer | ArrayBufferView }[],
): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const stamp = dosDateTime()

  for (const file of files) {
    const name = encName(file.name)
    const data = toBytes(file.data)
    const crc = crc32(data)
    const size = data.byteLength

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0, true) // flags
    lv.setUint16(8, 0, true) // STORE
    lv.setUint16(10, stamp.time, true)
    lv.setUint16(12, stamp.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true) // extra
    local.set(name, 30)

    parts.push(local, data)

    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true) // central directory
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true) // STORE
    cv.setUint16(12, stamp.time, true)
    cv.setUint16(14, stamp.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    central.push(cen)

    offset += local.length + data.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  // Concatenate into one ArrayBuffer so Blob typing stays clean across TS lib versions
  const total =
    parts.reduce((n, p) => n + p.length, 0) +
    central.reduce((n, c) => n + c.length, 0) +
    end.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  for (const c of central) {
    out.set(c, o)
    o += c.length
  }
  out.set(end, o)
  return out
}

/** Read a STORE zip (the kind this app writes). Deflate entries are rejected. */
export function readStoredZip(
  bytes: Uint8Array,
): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files: { name: string; data: Uint8Array }[] = []
  let offset = 0
  const decoder = new TextDecoder()
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true)
    if (sig === 0x02014b50 || sig === 0x06054b50) break
    if (sig !== 0x04034b50) {
      throw new Error('Not a zip file')
    }
    const method = view.getUint16(offset + 8, true)
    const compSize = view.getUint32(offset + 18, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLen + extraLen
    const dataEnd = dataStart + compSize
    if (dataEnd > bytes.length) throw new Error('Zip entry is truncated')
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen))
    if (method !== 0) {
      throw new Error(`Zip entry ${name} is compressed`)
    }
    if (!name.endsWith('/')) {
      files.push({ name, data: bytes.slice(dataStart, dataEnd) })
    }
    offset = dataEnd
  }
  return files
}

export function buildZip(
  files: { name: string; data: ArrayBuffer | ArrayBufferView }[],
): Blob {
  const out = buildZipBytes(files)
  const ab = out.buffer.slice(
    out.byteOffset,
    out.byteOffset + out.byteLength,
  ) as ArrayBuffer
  return new Blob([ab], { type: 'application/zip' })
}

/** Download insert geometries as a ZIP of binary STL files. */
export function downloadInsertsZip(
  geoms: THREE.BufferGeometry[],
  baseName: string,
  colorNames?: (string | undefined)[],
): void {
  if (geoms.length === 0) return
  const files = geoms.map((g, i) => {
    const raw = colorNames?.[i]?.trim()
    const slug = raw ? colorSlug(raw) : ''
    const colorPart = slug ? `_${slug}` : ''
    const name =
      geoms.length === 1
        ? `${baseName}_insert${colorPart}.stl`
        : `${baseName}_insert_${i + 1}${colorPart}.stl`
    return { name, data: geometryToSTLBuffer(g) }
  })
  downloadBlob(buildZip(files), `${baseName}_inserts.zip`)
}

/** Export body, optional upper shell, all inserts, and project markings in one ZIP. */
export function downloadAllPartsZip(input: {
  baseName: string
  bottom: THREE.BufferGeometry
  upper: THREE.BufferGeometry | null
  dropIns: THREE.BufferGeometry[]
  dropInNames?: (string | undefined)[]
  insertsOnly: boolean
  snapshot?: SelectionSnapshot
  /** Bambu Studio 3MF (zip) with painted filament colors. */
  bambu3mf?: Uint8Array
  /** Original STL bytes so the zip can be dropped back into the editor. */
  originalStl?: Uint8Array
}): void {
  const files: { name: string; data: Uint8Array }[] = []
  const base = input.baseName.replace(/\.stl$/i, '')

  if (input.originalStl) {
    const originalName = input.baseName.toLowerCase().endsWith('.stl')
      ? input.baseName
      : `${base}.stl`
    files.push({ name: originalName, data: input.originalStl })
  }

  files.push({
    name: input.insertsOnly ? `${base}_body.stl` : `${base}_bottom.stl`,
    data: geometryToSTLBuffer(input.bottom),
  })

  if (input.upper) {
    files.push({
      name: `${base}_upper.stl`,
      data: geometryToSTLBuffer(input.upper, { dropFloating: true }),
    })
  }

  input.dropIns.forEach((g, i) => {
    const raw = input.dropInNames?.[i]?.trim()
    const slug = raw ? colorSlug(raw) : ''
    const colorPart = slug ? `_${slug}` : ''
    const name =
      input.dropIns.length === 1
        ? `${base}_insert${colorPart}.stl`
        : `${base}_insert_${i + 1}${colorPart}.stl`
    files.push({ name, data: geometryToSTLBuffer(g) })
  })

  if (input.snapshot) {
    files.push({
      name: `${base}.amspaint.json`,
      data: new TextEncoder().encode(JSON.stringify(input.snapshot, null, 2)),
    })
  }

  if (input.bambu3mf) {
    files.push({
      name: `${base}_bambu.3mf`,
      data: input.bambu3mf,
    })
  }

  if (files.length === 0) return
  downloadBlob(buildZip(files), `${base}_all_parts.zip`)
}
