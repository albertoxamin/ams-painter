import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Model } from '../../domain/model'

/** Frame camera on a loaded model's bounding box. */
export default function CameraRig({ model }: { model: Model | null }) {
  const { camera, controls } = useThree()

  useEffect(() => {
    if (!model) return
    model.geometry.computeBoundingBox()
    const box = model.geometry.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 2.2
    const midZ = (model.zMin + model.zMax) / 2
    camera.position.set(center.x + dist * 0.7, center.y - dist * 0.6, midZ + dist * 0.5)
    camera.near = Math.max(0.01, maxDim / 500)
    camera.far = Math.max(5000, maxDim * 20)
    camera.updateProjectionMatrix()
    if (controls && 'target' in controls) {
      ;(controls as unknown as { target: THREE.Vector3; update: () => void }).target.set(0, 0, midZ)
      ;(controls as unknown as { update: () => void }).update()
    }
  }, [model, camera, controls])

  return null
}
