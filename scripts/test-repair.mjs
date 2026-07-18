import { readFileSync } from 'fs'
import { loadGLBGeometry } from '../src/lib/loadGLB.ts'
import { analyzeMesh } from '../src/lib/meshAnalysis.ts'
import { repairGLB } from '../src/lib/repairMesh.ts'

const file = process.argv[2] || '/Users/alberto/Downloads/meshy_1784390222161.glb'
const buf = readFileSync(file)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const geom = await loadGLBGeometry(ab)
console.log('BEFORE:', analyzeMesh(geom))

const result = await repairGLB(ab, 'meshy.glb', (p) => {
  if (p.repairPct !== undefined) console.log(`Repairing: ${p.repairPct.toFixed(0)}%`)
})
console.log('AFTER:', result.after)
console.log(
  `Vertex count changed from ${result.vertexCountBefore} to ${result.vertexCountAfter} (${result.vertexCountAfter - result.vertexCountBefore >= 0 ? '+' : ''}${result.vertexCountAfter - result.vertexCountBefore})`,
)
console.log(
  `Triangle count changed from ${result.triangleCountBefore} to ${result.triangleCountAfter} (${result.triangleCountAfter - result.triangleCountBefore >= 0 ? '+' : ''}${result.triangleCountAfter - result.triangleCountBefore})`,
)
console.log('repaired:', result.repaired)
