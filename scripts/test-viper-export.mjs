import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { loadSTL } from '../src/lib/loadSTL.ts'
import { prepareParts } from '../src/lib/prepareParts.ts'
import { listSelectionIslands } from '../src/lib/select.ts'
import selection from '../selections/dodge-viper-gen2.json'

function metaForIsland(faces, meta, fallback) {
  const votes = new Map()
  for (const f of faces) {
    const m = meta.get(f) ?? fallback
    const key = `${m.axis}|${Number(m.floor).toFixed(3)}|${m.colorId ?? ''}`
    const cur = votes.get(key)
    if (cur) cur.n++
    else votes.set(key, { m, n: 1 })
  }
  let best = fallback
  let bestN = -1
  for (const v of votes.values()) {
    if (v.n > bestN) {
      bestN = v.n
      best = v.m
    }
  }
  return best
}

const fileBuf = readFileSync('public/dodge-viper-gen2.stl')
const buf = fileBuf.buffer.slice(
  fileBuf.byteOffset,
  fileBuf.byteOffset + fileBuf.byteLength,
)
const model = loadSTL(buf, selection.name)
console.log('loaded', model.name, 'tris', model.count, 'expected', selection.tris)

const dropIn = new Set(selection.dropIn.filter((f) => f < model.count))
const dropInMeta = new Map()
for (const [k, v] of Object.entries(selection.dropInMeta)) {
  const f = Number(k)
  if (dropIn.has(f)) dropInMeta.set(f, v)
}

const islands = listSelectionIslands(dropIn, model.adjacency)
const fallback = {
  axis: selection.cutAxis,
  floor: selection.dropInFloorZ,
  colorId: selection.brushColorId,
}
console.log(
  'islands',
  islands.length,
  islands.map((isl, i) => {
    const m = metaForIsland(isl, dropInMeta, fallback)
    return `#${i + 1} faces=${isl.size} ${m.axis} @ ${m.floor} ${m.colorId}`
  }),
)

const parts = await prepareParts(
  model.geometry,
  selection.splitHeight,
  new Set(),
  dropIn,
  model.zMin,
  0.15,
  {
    insertsOnly: true,
    dropInMeta,
    adjacency: model.adjacency,
    dropInFloorZ: selection.dropInFloorZ,
    cutAxis: selection.cutAxis,
  },
)

console.log(
  'result inserts',
  parts.dropIns.length,
  'axes',
  parts.dropInAxes,
  'body tris',
  parts.bottom.index ? parts.bottom.index.count / 3 : '?',
)

const hasX = parts.dropInAxes.some((a) => a === '-x' || a === '+x')
const hasZ = parts.dropInAxes.some((a) => a === '-z' || a === '+z')
console.log('hasX', hasX, 'hasZ', hasZ)

mkdirSync('tmp', { recursive: true })
writeFileSync(
  'tmp/viper-export-report.json',
  JSON.stringify(
    {
      islands: islands.length,
      inserts: parts.dropIns.length,
      axes: parts.dropInAxes,
      hasX,
      hasZ,
    },
    null,
    2,
  ),
)

if (!hasX || !hasZ) {
  console.error('FAIL: expected both X and Z inserts in export')
  process.exit(1)
}
console.log('OK')
