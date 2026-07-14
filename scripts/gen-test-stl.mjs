// Generate a single clean box STL for the logic test (manifold, no overlaps),
// plus a multi-box "car" STL for the visual browser demo.
import * as THREE from 'three'
import { writeFileSync } from 'fs'

function geomToBinarySTL(geom) {
  const pos = geom.getAttribute('position')
  const normal = geom.getAttribute('normal')
  const triCount = pos.count / 3
  const buf = new ArrayBuffer(84 + triCount * 50)
  const dv = new DataView(buf)
  const header = new TextEncoder().encode('ams-painter')
  new Uint8Array(buf, 0, 80).set(header)
  dv.setUint32(80, triCount, true)
  let off = 84
  for (let t = 0; t < triCount; t++) {
    const a = t * 3
    dv.setFloat32(off + 0, normal.getX(a), true)
    dv.setFloat32(off + 4, normal.getY(a), true)
    dv.setFloat32(off + 8, normal.getZ(a), true)
    for (let i = 0; i < 3; i++) {
      const vi = a + i
      dv.setFloat32(off + 12 + i * 12, pos.getX(vi), true)
      dv.setFloat32(off + 16 + i * 12, pos.getY(vi), true)
      dv.setFloat32(off + 20 + i * 12, pos.getZ(vi), true)
    }
    dv.setUint16(off + 48, 0, true)
    off += 50
  }
  return Buffer.from(buf)
}

// --- Clean single box for logic test ---
const box = new THREE.BoxGeometry(80, 52, 30)
let boxGeom = box.clone()
if (boxGeom.index) boxGeom = boxGeom.toNonIndexed()
boxGeom.computeVertexNormals()
writeFileSync('public/test-box.stl', geomToBinarySTL(boxGeom))
console.log('wrote public/test-box.stl', boxGeom.getAttribute('position').count / 3, 'tris')

// --- Multi-box "car" for visual demo (overlaps are fine for display) ---
const group = new THREE.Group()
const body = new THREE.Mesh(new THREE.BoxGeometry(80, 36, 30))
body.position.set(0, 18, 0)
group.add(body)
const cabin = new THREE.Mesh(new THREE.BoxGeometry(40, 22, 26))
cabin.position.set(-5, 47, 0)
group.add(cabin)
for (const [x, z] of [[-26, -18], [26, -18], [-26, 18], [26, 18]]) {
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(8, 18, 16))
  wheel.position.set(x, 9, z)
  group.add(wheel)
}
const geoms = []
group.updateMatrixWorld(true)
group.traverse((o) => {
  if (o.isMesh) {
    let g = o.geometry.clone()
    g.applyMatrix4(o.matrixWorld)
    if (g.index) g = g.toNonIndexed()
    geoms.push(g)
  }
})
let total = 0
for (const g of geoms) total += g.getAttribute('position').count
const arr = new Float32Array(total * 3)
let off = 0
for (const g of geoms) {
  const p = g.getAttribute('position')
  arr.set(p.array, off)
  off += p.array.length
}
const merged = new THREE.BufferGeometry()
merged.setAttribute('position', new THREE.BufferAttribute(arr, 3))
merged.computeVertexNormals()
writeFileSync('public/test-car.stl', geomToBinarySTL(merged))
console.log('wrote public/test-car.stl', merged.getAttribute('position').count / 3, 'tris')
