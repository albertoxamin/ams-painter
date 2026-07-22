import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { colorSlug } from '../domain/palette'
import { downloadBlob } from '../platform/io/downloadBlob'
import type { SelectionSnapshot } from './selectionSnapshot'
import { materializeDrawRange } from './manifoldOps'

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

export function geometryToSTLBuffer(geom: THREE.BufferGeometry): Uint8Array {
  const clean = materializeDrawRange(geom)
  return toBinarySTLBytes(new THREE.Mesh(clean))
}

export function downloadSTL(geom: THREE.BufferGeometry, filename: string): void {
  // Materialize drawRange so STLExporter (which ignores it) doesn't write junk
  const clean = materializeDrawRange(geom)
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

/**
 * Build an uncompressed (STORE) ZIP from named binary files.
 * Enough for STL bundles; no external dependency.
 */
export function buildZip(
  files: { name: string; data: ArrayBuffer | ArrayBufferView }[],
): Blob {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

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
    lv.setUint16(10, 0, true) // time
    lv.setUint16(12, 0, true) // date
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
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
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
  return new Blob([out.buffer as ArrayBuffer], { type: 'application/zip' })
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
}): void {
  const files: { name: string; data: Uint8Array }[] = []
  const base = input.baseName.replace(/\.stl$/i, '')

  files.push({
    name: input.insertsOnly ? `${base}_body.stl` : `${base}_bottom.stl`,
    data: geometryToSTLBuffer(input.bottom),
  })

  if (input.upper) {
    files.push({
      name: `${base}_upper.stl`,
      data: geometryToSTLBuffer(input.upper),
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

  if (files.length === 0) return
  downloadBlob(buildZip(files), `${base}_all_parts.zip`)
}
