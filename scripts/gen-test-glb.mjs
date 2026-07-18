import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync } from 'fs'

const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 10))
const exporter = new GLTFExporter()
exporter.parse(
  mesh,
  (gltf) => {
    writeFileSync('public/test-box.glb', Buffer.from(gltf))
    console.log('wrote public/test-box.glb', gltf.byteLength, 'bytes')
  },
  (e) => console.error(e),
  { binary: true },
)
