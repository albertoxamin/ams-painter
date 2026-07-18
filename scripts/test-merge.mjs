import { readFileSync } from 'fs'
import { loadGLBGeometry } from '../src/lib/loadGLB.ts'
import { analyzeMesh } from '../src/lib/meshAnalysis.ts'
import { repairWithManifoldMerge } from '../src/lib/manifoldOps.ts'

const buf = readFileSync('/Users/alberto/Downloads/meshy_1784390222161.glb')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const geom = await loadGLBGeometry(ab)
console.log('before', analyzeMesh(geom).checks)
const out = await repairWithManifoldMerge(geom)
if (out) {
  console.log('after merge', analyzeMesh(out).checks)
  console.log('verts', out.getAttribute('position').count, 'tris', out.index.count / 3)
} else {
  console.log('merge failed')
}
