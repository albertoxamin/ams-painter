import { readFileSync } from 'fs'
import { loadGLBGeometry } from '../src/lib/loadGLB.ts'
import { toIndexedMesh, buildEdges } from '../src/lib/meshTopology.ts'
import * as THREE from 'three'

const buf = readFileSync('/Users/alberto/Downloads/meshy_1784390222161.glb')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const mesh = toIndexedMesh(await loadGLBGeometry(ab))
const edges = buildEdges(mesh)
let bad = 0
const normal = (t: number, out: THREE.Vector3) => {
  const i0 = mesh.idx.getX(t * 3)
  const i1 = mesh.idx.getX(t * 3 + 1)
  const i2 = mesh.idx.getX(t * 3 + 2)
  const v0 = new THREE.Vector3(mesh.pos.getX(i0), mesh.pos.getY(i0), mesh.pos.getZ(i0))
  const v1 = new THREE.Vector3(mesh.pos.getX(i1), mesh.pos.getY(i1), mesh.pos.getZ(i1))
  const v2 = new THREE.Vector3(mesh.pos.getX(i2), mesh.pos.getY(i2), mesh.pos.getZ(i2))
  return out.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
}
const nA = new THREE.Vector3()
const nB = new THREE.Vector3()
for (const info of edges.values()) {
  if (info.faces.length !== 2) continue
  normal(info.faces[0]!.tri, nA)
  normal(info.faces[1]!.tri, nB)
  if (nA.dot(nB) > 0.15) bad++
}
console.log('bad manifold edges', bad)
