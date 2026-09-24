/**
 * Clean-room decoder for Meshy's encrypted `.meshy` 3D model container.
 *
 * Reverse-engineered file layout (see references: Amal-David/meshy2glb):
 *   bytes  0..7   magic "MESHY.AI"
 *   bytes  8..9   little-endian version (observed: 1)
 *   bytes 10..21  12-byte AES nonce
 *   bytes 22..31  reserved
 *   bytes 32..end body
 *
 * Body layout:
 *   body[0..8192]      AES-256-CTR ciphertext  → decrypts to GLB[0..8192]
 *   body[8192..8208]   16-byte AES-GCM auth tag (skipped)
 *   body[8208..end]    plaintext (textures + meshopt streams) → GLB[8192..end]
 *
 * Cipher: AES-256-CTR
 *   key  = 32-byte ASCII literal `JSON{"accessors":[{"bufferView":`
 *   ctr  = nonce || uint32be(2)  (AES-GCM keystream layout)
 *
 * The first 8 KB of every file is encrypted (the GLB header, glTF JSON, BIN
 * chunk header, and the start of the first buffer view). Everything after the
 * 16-byte tag is stored verbatim — WebP textures and meshopt-compressed
 * vertex/index streams.
 *
 * After decryption the GLB uses `EXT_meshopt_compression`; we decompress every
 * compressed bufferView with the meshoptimizer decoder so the output is a plain
 * GLB any viewer can load.
 */

// The meshoptimizer decoder ships as an untyped ESM module; declare the
// small surface we use so the rest of the file stays strictly typed.
import * as MeshoptDecoderNS from 'three/examples/jsm/libs/meshopt_decoder.module.js'

interface MeshoptDecoder {
  ready: Promise<void>
  decodeGltfBuffer: (
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: number,
    filter: string,
  ) => void
}
const MeshoptDecoder = MeshoptDecoderNS as unknown as MeshoptDecoder

const KEY_ASCII = 'JSON{"accessors":[{"bufferView":'
const ENCRYPTED_LEN = 8192
const TAG_LEN = 16
const GLB_MAGIC = 0x46546c67 // "glTF"

let cachedKey: CryptoKey | null = null

async function importKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  cachedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(KEY_ASCII),
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  )
  return cachedKey
}

/** True if `buffer` starts with the `MESHY.AI` magic header. */
export function isMeshyFile(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 32) return false
  return new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) === 'MESHY.AI'
}

/** True if `buffer` starts with the `glTF` magic (little-endian 0x46546c67). */
export function isGlbFile(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 4) return false
  return new DataView(buffer).getUint32(0, true) === GLB_MAGIC
}

interface BufferView {
  buffer?: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: number
  extensions?: {
    EXT_meshopt_compression?: {
      buffer?: number
      byteOffset: number
      byteLength: number
      count: number
      byteStride: number
      mode: number
      filter?: string
    }
  }
}

interface GltfJson {
  bufferViews?: BufferView[]
  buffers?: { byteLength: number }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

/**
 * Decrypt a `.meshy` ArrayBuffer into a GLB that still uses
 * EXT_meshopt_compression. If the input is already a GLB it is returned as-is.
 */
export async function meshyToGlb(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (isGlbFile(buffer)) return buffer
  if (!isMeshyFile(buffer)) throw new Error('Input is neither a .meshy nor a .glb file')

  const bytes = new Uint8Array(buffer)
  const nonce = bytes.subarray(10, 22)
  const body = bytes.subarray(32)

  if (body.length < ENCRYPTED_LEN + TAG_LEN) {
    throw new Error('.meshy body too small')
  }

  const counter = new Uint8Array(16)
  counter.set(nonce, 0)
  counter[15] = 0x02

  const key = await importKey()
  const prefix = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter, length: 32 },
      key,
      body.subarray(0, ENCRYPTED_LEN),
    ),
  )

  if (new DataView(prefix.buffer).getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Decrypted prefix is not a GLB (wrong magic) — key may have changed')
  }

  const plaintext = body.subarray(ENCRYPTED_LEN + TAG_LEN)
  const glbLen = ENCRYPTED_LEN + plaintext.length
  const out = new Uint8Array(glbLen)
  out.set(prefix, 0)
  out.set(plaintext, ENCRYPTED_LEN)

  // Fix the total GLB length field (byte offset 8) to the real output size.
  new DataView(out.buffer).setUint32(8, glbLen, true)
  return out.buffer
}

/**
 * Decompose a GLB that uses EXT_meshopt_compression into a standard GLB with
 * raw vertex/index data, so any glTF viewer can render it without MeshoptDecoder.
 * If the GLB does not use meshopt compression, it is returned unchanged.
 */
export async function decompressGlb(glbBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  await MeshoptDecoder.ready

  const src = new Uint8Array(glbBuffer)
  const dv = new DataView(glbBuffer)

  const jsonLen = dv.getUint32(12, true)
  const json = JSON.parse(
    new TextDecoder().decode(src.slice(20, 20 + jsonLen)),
  ) as GltfJson

  const bvs = json.bufferViews ?? []
  const hasMeshopt = bvs.some((bv) => bv.extensions?.EXT_meshopt_compression)
  if (!hasMeshopt) return glbBuffer

  const binStart = 20 + ((jsonLen + 3) & ~3) + 8
  const binData = src.slice(binStart)

  const decodedChunks: Uint8Array[] = []
  let decodedTotal = 0
  const newBufferViews: BufferView[] = []

  for (const bv of bvs) {
    const ext = bv.extensions?.EXT_meshopt_compression
    if (ext && (ext.buffer ?? 0) === 0) {
      const compSrc = binData.slice(ext.byteOffset, ext.byteOffset + ext.byteLength)
      const outSize = ext.count * ext.byteStride
      const target = new Uint8Array(outSize)
      MeshoptDecoder.decodeGltfBuffer(
        target,
        ext.count,
        ext.byteStride,
        compSrc,
        ext.mode,
        ext.filter || '',
      )

      const aligned = (decodedTotal + 3) & ~3
      while (decodedTotal < aligned) {
        decodedChunks.push(new Uint8Array([0]))
        decodedTotal++
      }

      newBufferViews.push({
        buffer: 0,
        byteOffset: decodedTotal,
        byteLength: bv.byteLength,
        ...(bv.byteStride ? { byteStride: bv.byteStride } : {}),
        ...(bv.target ? { target: bv.target } : {}),
      })
      decodedChunks.push(target)
      decodedTotal += outSize
    } else {
      const off = bv.byteOffset ?? 0
      const raw = binData.slice(off, off + bv.byteLength)

      const aligned = (decodedTotal + 3) & ~3
      while (decodedTotal < aligned) {
        decodedChunks.push(new Uint8Array([0]))
        decodedTotal++
      }

      newBufferViews.push({
        buffer: 0,
        byteOffset: decodedTotal,
        byteLength: bv.byteLength,
        ...(bv.byteStride ? { byteStride: bv.byteStride } : {}),
        ...(bv.target ? { target: bv.target } : {}),
      })
      decodedChunks.push(raw)
      decodedTotal += raw.length
    }
  }

  const newJson: GltfJson = { ...json }
  newJson.bufferViews = newBufferViews
  newJson.buffers = [{ byteLength: decodedTotal }]
  newJson.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (e) => e !== 'EXT_meshopt_compression',
  )
  newJson.extensionsRequired = (json.extensionsRequired ?? []).filter(
    (e) => e !== 'EXT_meshopt_compression',
  )
  if (newJson.extensionsUsed.length === 0) delete newJson.extensionsUsed
  if (newJson.extensionsRequired?.length === 0) delete newJson.extensionsRequired

  const jsonBytes = new TextEncoder().encode(JSON.stringify(newJson))
  const jsonPadded = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4)

  const totalLen = 12 + 8 + jsonPadded + 8 + decodedTotal
  const out = new Uint8Array(totalLen)
  const odv = new DataView(out.buffer)

  odv.setUint32(0, GLB_MAGIC, true)
  odv.setUint32(4, 2, true)
  odv.setUint32(8, totalLen, true)

  odv.setUint32(12, jsonPadded, true)
  odv.setUint32(16, 0x4e4f534a, true) // "JSON"
  out.set(jsonBytes, 20)
  for (let i = jsonBytes.length; i < jsonPadded; i++) out[20 + i] = 0x20

  const binOff = 20 + jsonPadded
  odv.setUint32(binOff, decodedTotal, true)
  odv.setUint32(binOff + 4, 0x004e4942, true) // "BIN\0"

  let pos = binOff + 8
  for (const chunk of decodedChunks) {
    out.set(chunk, pos)
    pos += chunk.length
  }

  return out.buffer
}

/**
 * Full pipeline: `.meshy` (or already-GLB) → decrypted → meshopt-decompressed
 * standard GLB. Returns the raw GLB bytes.
 */
export async function decodeMeshyToStandardGlb(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const glb = await meshyToGlb(buffer)
  return decompressGlb(glb)
}
