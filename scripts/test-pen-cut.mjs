import { readFileSync } from 'fs'
import { loadSTL } from '../src/lib/loadSTL.ts'
import { prepareParts } from '../src/lib/prepareParts.ts'
import { ensureManifoldSolid } from '../src/lib/manifoldOps.ts'

const triCount = (g) =>
  g.index ? g.index.count / 3 : g.getAttribute('position').count / 3

async function run(path, name, loop, opts) {
  const fileBuf = readFileSync(path)
  const buf = fileBuf.buffer.slice(
    fileBuf.byteOffset,
    fileBuf.byteOffset + fileBuf.byteLength,
  )
  const model = loadSTL(buf, name)
  const geom = model.geometry
  const warns = []
  const origWarn = console.warn
  console.warn = (...a) => {
    warns.push(a.join(' '))
    origWarn(...a)
  }

  const penCutouts = [{ id: 't', loop, meta: opts.meta }]
  const bodyBefore = await ensureManifoldSolid(geom)
  const parts = await prepareParts(
    geom,
    opts.splitH,
    new Set(),
    new Set(),
    model.zMin,
    0.15,
    {
      insertsOnly: opts.insertsOnly,
      penCutouts,
      cutAxis: opts.meta.axis,
      dropInFloorZ: opts.meta.floor,
    },
  )
  console.warn = origWarn

  const body = opts.insertsOnly ? parts.bottom : parts.upper
  console.log(
    name,
    'tris',
    triCount(bodyBefore),
    '->',
    triCount(body),
    'insert',
    parts.dropIns.length,
    triCount(parts.dropIns[0] ?? { index: null, getAttribute: () => ({ count: 0 }) }),
  )
  if (!opts.insertsOnly && parts.upper) {
    console.log(
      '  split lower',
      triCount(parts.bottom),
      'upper',
      triCount(parts.upper),
    )
  }
  const penWarns = warns.filter((w) => /pen|Pen|cut failed|skipping/i.test(w))
  if (penWarns.length) console.log('  warns', penWarns)
}

const boxBuf = readFileSync('public/test-box.stl')
const boxAb = boxBuf.buffer.slice(boxBuf.byteOffset, boxBuf.byteOffset + boxBuf.byteLength)
const box = loadSTL(boxAb, 'test-box.stl')
box.geometry.computeBoundingBox()
const b = box.geometry.boundingBox
const z = b.max.z - 0.5
const boxLoop = [
  [-10, -10, z],
  [10, -10, z],
  [10, 10, z],
  [-10, 10, z],
]
await run('public/test-box.stl', 'box-inserts', boxLoop, {
  insertsOnly: true,
  splitH: 15,
  meta: { axis: '-z', floor: 2, colorId: 'blue' },
})
await run('public/test-box.stl', 'box-split', boxLoop, {
  insertsOnly: false,
  splitH: 15,
  meta: { axis: '-z', floor: 2, colorId: 'blue' },
})

const viperBuf = readFileSync('public/dodge-viper-gen2.stl')
const viperAb = viperBuf.buffer.slice(viperBuf.byteOffset, viperBuf.byteOffset + viperBuf.byteLength)
const viper = loadSTL(viperAb, 'viper.stl')
viper.geometry.computeBoundingBox()
const vb = viper.geometry.boundingBox
const cx = (vb.min.x + vb.max.x) / 2
const cy = (vb.min.y + vb.max.y) / 2
const vz = vb.max.z - 2
const viperLoop = [
  [cx - 15, cy, vz],
  [cx, cy + 15, vz],
  [cx + 15, cy, vz],
  [cx, cy - 15, vz],
]
await run('public/dodge-viper-gen2.stl', 'viper-inserts', viperLoop, {
  insertsOnly: true,
  splitH: (viper.zMin + viper.zMax) / 2,
  meta: { axis: '-z', floor: viper.zMin + 5, colorId: 'blue' },
})
