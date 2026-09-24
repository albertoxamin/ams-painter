import * as THREE from 'three'
import type { MeshBVH, HitPointInfo } from 'three-mesh-bvh'
import type { PaletteColor } from './extrude'
import { buildZipBytes } from './exportSTL'

export type BambuFilament = { name: string; hex: string }

/** Unpainted triangles use this slot (object extruder 1). */
export const BAMBU_BODY_FILAMENT: BambuFilament = {
  name: 'Body',
  hex: '#B0B0B0',
}

/**
 * Whole-triangle Bambu Studio / Orca `paint_color` for a 1-based filament slot.
 * Matches FacetsAnnotation::get_triangle_as_string for an unsplit triangle.
 * Slot 1 → "4", 2 → "8", 3 → "0C", 16 → "DC".
 */
export function bambuPaintCode(state: number): string {
  if (state <= 0) return ''
  const bits: number[] = [0, 0]
  if (state >= 3) {
    bits.push(1, 1)
    let n = state - 3
    while (n >= 15) {
      bits.push(1, 1, 1, 1)
      n -= 15
    }
    for (let bit = 0; bit < 4; bit++) bits.push((n >> bit) & 1)
  } else {
    bits.push(state & 1, (state >> 1) & 1)
  }
  let out = ''
  for (let offset = 0; offset < bits.length; offset += 4) {
    let next = 0
    for (let i = 3; i >= 0; i--) next = (next << 1) | (bits[offset + i] ?? 0)
    out =
      (next < 10 ? String(next) : String.fromCharCode(65 + next - 10)) + out
  }
  return out
}

export function normalizeFilamentHex(hex: string): string {
  let h = hex.trim()
  if (!h.startsWith('#')) h = `#${h}`
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  }
  return h.toUpperCase()
}

/**
 * Map painted face regions onto Bambu filament slots.
 * Slot 1 is the unpainted body. Later regions overwrite earlier ones.
 */
/**
 * Color each result triangle from the original face it still sits on.
 * Triangles farther than `maxDistance` (hole walls, new cuts) stay unpainted.
 */
export function colorIdsOnResultMesh(
  geom: THREE.BufferGeometry,
  bvh: MeshBVH,
  sourceFaceColor: Map<number, string>,
  maxDistance = 0.4,
): (string | undefined)[] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const index = geom.index
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3)
  const out: (string | undefined)[] = new Array(triCount)
  if (sourceFaceColor.size === 0 || !pos) return out
  const c = new THREE.Vector3()
  const hit: HitPointInfo = {
    point: new THREE.Vector3(),
    distance: 0,
    faceIndex: 0,
  }
  for (let t = 0; t < triCount; t++) {
    let x = 0
    let y = 0
    let z = 0
    for (let k = 0; k < 3; k++) {
      const vi = index ? index.getX(t * 3 + k) : t * 3 + k
      x += pos.getX(vi)
      y += pos.getY(vi)
      z += pos.getZ(vi)
    }
    c.set(x / 3, y / 3, z / 3)
    const found = bvh.closestPointToPoint(c, hit, 0, maxDistance)
    out[t] = found ? sourceFaceColor.get(found.faceIndex) : undefined
  }
  return out
}

export function concatGeometries(
  geoms: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const positions: number[] = []
  for (const geom of geoms) {
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const index = geom.index
    const n = index ? index.count : pos.count
    for (let i = 0; i < n; i++) {
      const vi = index ? index.getX(i) : i
      positions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return out
}

export function assignBambuExtruders(input: {
  triCount: number
  regions: { faces: Iterable<number>; colorId: string }[]
  palette: PaletteColor[]
}): { filaments: BambuFilament[]; faceExtruder: Uint16Array } {
  const used = new Set<string>()
  for (const region of input.regions) {
    for (const _face of region.faces) {
      used.add(region.colorId)
      break
    }
  }
  const ordered: string[] = []
  for (const color of input.palette) {
    if (used.has(color.id)) ordered.push(color.id)
  }
  for (const id of used) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  const slot = new Map<string, number>()
  ordered.forEach((id, i) => slot.set(id, i + 2))

  const faceExtruder = new Uint16Array(input.triCount)
  for (const region of input.regions) {
    const extruder = slot.get(region.colorId)
    if (!extruder) continue
    for (const face of region.faces) {
      if (face >= 0 && face < input.triCount) faceExtruder[face] = extruder
    }
  }

  const filaments: BambuFilament[] = [BAMBU_BODY_FILAMENT]
  for (const id of ordered) {
    const color = input.palette.find((c) => c.id === id)
    filaments.push({
      name: color?.name || id,
      hex: normalizeFilamentHex(color?.hex || '#888888'),
    })
  }
  return { filaments, faceExtruder }
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmt(n: number): string {
  const r = Math.round(n * 1e5) / 1e5
  return Object.is(r, -0) ? '0' : String(r)
}

function triangleCorner(
  geom: THREE.BufferGeometry,
  tri: number,
  corner: number,
): [number, number, number] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const i = geom.index ? geom.index.getX(tri * 3 + corner) : tri * 3 + corner
  return [pos.getX(i), pos.getY(i), pos.getZ(i)]
}

/** P1S bed. Build-item origin is the front-left corner, so the middle is 128, 128. */
const P1S_BED = { width: 256, depth: 256 }

/** Same gap Bambu Studio uses between plates (1/5 of the bed). */
const PLATE_GAP = 0.2

/** Studio lays plates in a square grid. Two plates sit side by side. */
function plateColumnCount(count: number): number {
  const value = Math.sqrt(count)
  const rounded = Math.round(value)
  return value > rounded ? rounded + 1 : rounded
}

function plateOrigin(
  plate: number,
  plateCount: number,
  bed = P1S_BED,
): { x: number; y: number } {
  const index = Math.max(0, plate - 1)
  const cols = plateColumnCount(Math.max(plateCount, 1))
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: col * bed.width * (1 + PLATE_GAP),
    y: -row * bed.depth * (1 + PLATE_GAP),
  }
}

function geometryBounds(geom: THREE.BufferGeometry): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const index = geom.index
  const n = index ? index.count : pos.count
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const vi = index ? index.getX(i) : i
    const x = pos.getX(vi)
    const y = pos.getY(vi)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

/** Shift that puts the combined XY center on the middle of the bed. */
export function plateCenterShift(
  bounds: { minX: number; minY: number; maxX: number; maxY: number }[],
  bed = P1S_BED,
): { x: number; y: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of bounds) {
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }
  return {
    x: bed.width / 2 - (minX + maxX) / 2,
    y: bed.depth / 2 - (minY + maxY) / 2,
  }
}

function geometryTriangleCount(geom: THREE.BufferGeometry): number {
  if (geom.index) return Math.floor(geom.index.count / 3)
  const pos = geom.getAttribute('position')
  return pos ? Math.floor(pos.count / 3) : 0
}

export type BambuObject = {
  name: string
  geometry: THREE.BufferGeometry
  /** 1-based filament for triangles without paint_color. */
  extruder?: number
  /** Per-triangle filament. 0 or omit = object extruder. */
  faceExtruder?: ArrayLike<number>
  /** 1-based Bambu plate. */
  plate: number
}

function meshXml(
  geom: THREE.BufferGeometry,
  faceExtruder?: ArrayLike<number>,
): { vertices: string; triangles: string } {
  const triCount = geometryTriangleCount(geom)
  const vertices: string[] = []
  const triangles: string[] = []
  const indexOf = new Map<string, number>()
  const addVertex = (x: number, y: number, z: number) => {
    const key = `${fmt(x)}_${fmt(y)}_${fmt(z)}`
    const existing = indexOf.get(key)
    if (existing !== undefined) return existing
    const id = vertices.length
    vertices.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`)
    indexOf.set(key, id)
    return id
  }
  for (let t = 0; t < triCount; t++) {
    const [x0, y0, z0] = triangleCorner(geom, t, 0)
    const [x1, y1, z1] = triangleCorner(geom, t, 1)
    const [x2, y2, z2] = triangleCorner(geom, t, 2)
    const v0 = addVertex(x0, y0, z0)
    const v1 = addVertex(x1, y1, z1)
    const v2 = addVertex(x2, y2, z2)
    // A welded corner that collapses is not a face. Emitting it closes openings.
    if (v0 === v1 || v1 === v2 || v0 === v2) continue
    const slot = faceExtruder?.[t] ?? 0
    const paint = slot > 0 ? ` paint_color="${bambuPaintCode(slot)}"` : ''
    triangles.push(`<triangle v1="${v0}" v2="${v1}" v3="${v2}"${paint}/>`)
  }
  return {
    vertices: vertices.join('\n     '),
    triangles: triangles.join('\n     '),
  }
}

/** 3MF project Bambu Studio opens with per-triangle filament paint. */
export function buildBambu3mf(input: {
  filaments: BambuFilament[]
  objects: BambuObject[]
}): Uint8Array {
  const filaments =
    input.filaments.length > 0 ? input.filaments : [BAMBU_BODY_FILAMENT]
  const objects = input.objects.filter(
    (obj) => geometryTriangleCount(obj.geometry) > 0,
  )

  const objectXml = objects
    .map((obj, index) => {
      const id = index + 1
      const mesh = meshXml(obj.geometry, obj.faceExtruder)
      return `  <object id="${id}" type="model">
   <mesh>
    <vertices>
     ${mesh.vertices}
    </vertices>
    <triangles>
     ${mesh.triangles}
    </triangles>
   </mesh>
  </object>`
    })
    .join('\n')

  const bounds = objects.map((obj) => geometryBounds(obj.geometry))
  const shiftByPlate = new Map<number, { x: number; y: number }>()
  const indexesByPlate = new Map<number, number[]>()
  objects.forEach((obj, index) => {
    const plate = obj.plate > 0 ? obj.plate : 1
    const list = indexesByPlate.get(plate) ?? []
    list.push(index)
    indexesByPlate.set(plate, list)
  })
  const plateCount = indexesByPlate.size
  for (const [plate, indexes] of indexesByPlate) {
    const local = plateCenterShift(indexes.map((index) => bounds[index]!))
    const origin = plateOrigin(plate, plateCount)
    shiftByPlate.set(plate, { x: origin.x + local.x, y: origin.y + local.y })
  }

  const buildItems = objects
    .map((obj, index) => {
      const plate = obj.plate > 0 ? obj.plate : 1
      const shift = shiftByPlate.get(plate) ?? { x: 0, y: 0 }
      return `  <item objectid="${index + 1}" transform="1 0 0 0 1 0 0 0 1 ${fmt(shift.x)} ${fmt(shift.y)} 0" printable="1"/>`
    })
    .join('\n')

  // Application must start with "BambuStudio-" or Studio drops model_settings
  // and loads geometry only.
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-02.08.02.60</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${objectXml}
 </resources>
 <build>
${buildItems}
 </build>
</model>
`

  const colours = filaments.map((f) => normalizeFilamentHex(f.hex))
  const n = colours.length
  const repeat = (value: string) => Array.from({ length: n }, () => value)
  // Names must be real system presets. Empty names make Studio show
  // "Customized Preset". print_settings_id is omitted so layer height
  // stays on the profile already open in Studio.
  const projectSettings = JSON.stringify({
    version: '02.08.02.60',
    name: 'project_settings',
    from: 'project',
    printer_model: 'Bambu Lab P1S',
    printer_variant: '0.4',
    printer_settings_id: 'Bambu Lab P1S 0.4 nozzle',
    nozzle_diameter: ['0.4'],
    extruder_type: ['Direct Drive'],
    filament_diameter: repeat('1.75'),
    filament_colour: colours,
    filament_settings_id: repeat('Generic PLA'),
    filament_ids: repeat('GFL99'),
  })

  const byPlate = new Map<number, number[]>()
  const objectConfigs = objects.map((obj, index) => {
    const id = index + 1
    const plate = obj.plate > 0 ? obj.plate : 1
    const list = byPlate.get(plate) ?? []
    list.push(id)
    byPlate.set(plate, list)
    const label = xmlEscape(obj.name.replace(/\.stl$/i, '') || `object_${id}`)
    const extruder = obj.extruder && obj.extruder > 0 ? obj.extruder : 1
    return ` <object id="${id}">
  <metadata key="name" value="${label}"/>
  <metadata key="extruder" value="${extruder}"/>
  <part id="${id}" subtype="normal_part">
   <metadata key="name" value="${label}"/>
   <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
  </part>
 </object>`
  })
  const plateConfigs = [...byPlate.keys()]
    .sort((a, b) => a - b)
    .map((plate) => {
      const instances = (byPlate.get(plate) ?? [])
        .map(
          (id) => `  <model_instance>
   <metadata key="object_id" value="${id}"/>
   <metadata key="instance_id" value="0"/>
   <metadata key="identify_id" value="${id}"/>
  </model_instance>`,
        )
        .join('\n')
      const plateName = plate === 1 ? 'Body' : 'Inserts'
      return ` <plate>
  <metadata key="plater_id" value="${plate}"/>
  <metadata key="plater_name" value="${plateName}"/>
  <metadata key="locked" value="false"/>
${instances}
 </plate>`
    })
  const assemble = objects
    .map(
      (_, index) =>
        `  <assemble_item object_id="${index + 1}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0"/>`,
    )
    .join('\n')

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectConfigs.join('\n')}
${plateConfigs.join('\n')}
 <assemble>
${assemble}
 </assemble>
</config>
`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="application/octet-stream"/>
</Types>
`

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

  const enc = new TextEncoder()
  return buildZipBytes([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
    {
      name: 'Metadata/project_settings.config',
      data: enc.encode(projectSettings),
    },
    { name: 'Metadata/model_settings.config', data: enc.encode(modelSettings) },
  ])
}
