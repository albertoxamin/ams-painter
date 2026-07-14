import { readFileSync } from 'fs'
import { loadSTL } from './src/lib/loadSTL.ts'
import { ensureManifoldSolid } from './src/lib/manifoldOps.ts'

function stats(g) {
  const p = g.getAttribute('position')
  const idx = g.index
  const key = (x, y, z) => `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`
  const counts = new Map()
  for (let t = 0; t < idx.count; t += 3) {
    const ids = [idx.getX(t), idx.getX(t+1), idx.getX(t+2)]
    const pts = ids.map(i => [p.getX(i), p.getY(i), p.getZ(i)])
    for (let e = 0; e < 3; e++) {
      const a = pts[e], b = pts[(e+1)%3]
      const ka = key(...a), kb = key(...b)
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      counts.set(ek, (counts.get(ek)||0)+1)
    }
  }
  let open=0, multi=0, hist={}
  for (const c of counts.values()) {
    if (c===1) open++
    else if (c!==2) { multi++; hist[c]=(hist[c]||0)+1 }
  }
  return { tris: idx.count/3, open, multi, hist }
}

const fileBuf = readFileSync('public/bmw.stl')
const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset+fileBuf.byteLength)
const model = loadSTL(buf, 'bmw.stl')
try {
  const m = await ensureManifoldSolid(model.geometry)
  console.log('source via manifold', stats(m))
} catch (e) {
  console.log('source not manifold:', e.message)
}
