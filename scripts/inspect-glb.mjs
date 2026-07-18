import { readFileSync } from 'fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

function toFloatGeometry(geom) {
  const pos = geom.getAttribute('position')
  const out = new THREE.BufferGeometry()
  const arr = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    arr[i * 3] = pos.getX(i)
    arr[i * 3 + 1] = pos.getY(i)
    arr[i * 3 + 2] = pos.getZ(i)
  }
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  if (geom.index) out.setIndex(geom.index.clone())
  return out
}

const buf = readFileSync('/Users/alberto/Downloads/meshy_1784390222161.glb')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const loader = new GLTFLoader()
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej))
gltf.scene.updateMatrixWorld(true)

const geoms = []
gltf.scene.traverse((o) => {
  if (o.isMesh) {
    let g = toFloatGeometry(o.geometry)
    g.applyMatrix4(o.matrixWorld)
    geoms.push(g)
    g.computeBoundingBox()
    console.log('after float+matrix', g.boundingBox)
  }
})

const merged = mergeGeometries(geoms, false)
merged.computeBoundingBox()
console.log('merged bbox', merged.boundingBox)
const p = merged.getAttribute('position')
console.log('sample', p.getX(0), p.getY(0), p.getZ(0))
