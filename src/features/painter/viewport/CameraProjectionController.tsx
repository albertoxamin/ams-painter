import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../../state'
import { ISO_DIR, VIEW_FACE_PRESETS } from './viewPresets'
import { publishCameraPose } from './cameraPoseBridge'

function targetOf(controls: unknown): THREE.Vector3 {
  if (controls && typeof controls === 'object' && 'target' in controls) {
    return (controls as { target: THREE.Vector3 }).target
  }
  return new THREE.Vector3()
}

function bindControls(controls: unknown, cam: THREE.Camera) {
  if (!controls || typeof controls !== 'object') return
  const oc = controls as { object?: THREE.Camera; update?: () => void }
  if ('object' in oc) oc.object = cam
  oc.update?.()
}

function applyOrtho(cam: THREE.OrthographicCamera, aspect: number, dist: number) {
  const half = Math.max(8, dist * Math.tan(((45 * Math.PI) / 180) / 2))
  cam.left = -half * aspect
  cam.right = half * aspect
  cam.top = half
  cam.bottom = -half
  cam.updateProjectionMatrix()
}

function snapCamera(
  cam: THREE.Camera,
  controls: unknown,
  viewFace: ReturnType<typeof useStore.getState>['viewFace'],
) {
  const target = targetOf(controls)
  const dist = Math.max(20, cam.position.distanceTo(target) || 200)
  const preset = viewFace ? VIEW_FACE_PRESETS[viewFace] : null
  const dir = preset?.dir ?? ISO_DIR
  const up = preset?.up ?? new THREE.Vector3(0, 0, 1)
  cam.up.copy(up)
  cam.position.copy(target).addScaledVector(dir, dist)
  cam.lookAt(target)
  cam.updateProjectionMatrix()
  bindControls(controls, cam)
}

/** Perspective is the Canvas default. Iso mounts an ortho camera. Snaps move the active camera only. */
export function CameraProjectionController() {
  const projection = useStore((s) => s.cameraProjection)
  const viewFace = useStore((s) => s.viewFace)
  const viewTick = useStore((s) => s.viewTick)
  const { camera, size, controls } = useThree()
  const orthoRef = useRef<THREE.OrthographicCamera>(null)
  const lastTick = useRef(0)
  const perspHold = useRef<THREE.PerspectiveCamera | null>(
    camera instanceof THREE.PerspectiveCamera ? camera : null,
  )

  if (camera instanceof THREE.PerspectiveCamera) {
    perspHold.current = camera
  }

  useFrame(({ camera: cam }) => {
    publishCameraPose(cam)
  })

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }
    const ortho = orthoRef.current
    if (ortho) {
      const target = targetOf(controls)
      applyOrtho(ortho, aspect, camera.position.distanceTo(target) || 200)
      bindControls(controls, projection === 'isometric' ? ortho : camera)
    } else {
      bindControls(controls, camera)
    }
  }, [projection, size.width, size.height, controls, camera])

  useLayoutEffect(() => {
    if (!viewTick || viewTick === lastTick.current) return
    const dest =
      projection === 'isometric' && orthoRef.current
        ? orthoRef.current
        : camera
    lastTick.current = viewTick
    snapCamera(dest, controls, viewFace)
    const other =
      dest === camera ? orthoRef.current : perspHold.current
    if (other && other !== dest) {
      other.up.copy(dest.up)
      other.position.copy(dest.position)
      other.quaternion.copy(dest.quaternion)
      other.updateProjectionMatrix()
    }
  }, [viewTick, viewFace, projection, controls, camera])

  if (projection !== 'isometric') return null

  return (
    <OrthographicCamera
      ref={orthoRef}
      makeDefault
      near={0.1}
      far={5000}
      left={-200}
      right={200}
      top={200}
      bottom={-200}
      position={[200, -170, 120]}
      up={[0, 0, 1]}
    />
  )
}
