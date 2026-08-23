import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore, type ViewFace } from '../../../state'
import {
  getCameraPose,
  subscribeCameraPose,
} from './cameraPoseBridge'

const FACE_FROM_NORMAL: { axis: 0 | 1 | 2; sign: 1 | -1; face: ViewFace }[] = [
  { axis: 0, sign: 1, face: 'right' },
  { axis: 0, sign: -1, face: 'left' },
  { axis: 1, sign: 1, face: 'back' },
  { axis: 1, sign: -1, face: 'front' },
  { axis: 2, sign: 1, face: 'top' },
  { axis: 2, sign: -1, face: 'bottom' },
]

const FACE_COLORS: Record<ViewFace, string> = {
  top: '#d8dce6',
  bottom: '#6a6e78',
  front: '#6ea8fe',
  back: '#4a6a9a',
  right: '#e07a5a',
  left: '#e09a5a',
}

function faceFromNormal(n: THREE.Vector3): ViewFace {
  const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2
  const sign: 1 | -1 = (ax === 0 ? n.x : ax === 1 ? n.y : n.z) >= 0 ? 1 : -1
  return FACE_FROM_NORMAL.find((f) => f.axis === ax && f.sign === sign)!.face
}

function CubeMesh() {
  const snapViewFace = useStore((s) => s.snapViewFace)
  const meshRef = useRef<THREE.Mesh>(null)
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(box), [box])
  const materials = useMemo(
    () =>
      FACE_FROM_NORMAL.map(
        (f) =>
          new THREE.MeshLambertMaterial({
            color: FACE_COLORS[f.face],
          }),
      ),
    [],
  )

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={box}
        material={materials}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (!e.face) return
          const n = e.face.normal.clone()
          n.transformDirection(meshRef.current!.matrixWorld)
          snapViewFace(faceFromNormal(n))
        }}
      />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#1a1d24" />
      </lineSegments>
    </group>
  )
}

function GizmoCamera() {
  const { camera, invalidate } = useThree()
  const look = useRef(new THREE.Vector3())
  const up = useRef(new THREE.Vector3())
  const q = useRef(new THREE.Quaternion())

  useEffect(() => subscribeCameraPose(() => invalidate()), [invalidate])

  useFrame(() => {
    const p = getCameraPose()
    q.current.set(p.qx, p.qy, p.qz, p.qw)
    look.current.set(0, 0, -1).applyQuaternion(q.current)
    up.current.set(p.ux, p.uy, p.uz)
    camera.up.copy(up.current)
    camera.position.copy(look.current).multiplyScalar(-3.2)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  })

  return null
}

/** Independent mini-canvas — orientation only, never the split-line lock axis. */
export function ViewCube() {
  return (
    <div className="scene-view-cube" aria-label="View cube">
      <Canvas
        frameloop="demand"
        orthographic
        gl={{ alpha: true, antialias: true }}
        camera={{ zoom: 48, near: 0.1, far: 20, up: [0, 0, 1], position: [2, -2, 1.6] }}
        onCreated={({ gl, scene, camera }) => {
          gl.setClearColor(0x000000, 0)
          scene.background = null
          camera.up.set(0, 0, 1)
        }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[2, -3, 4]} intensity={1.1} />
        <GizmoCamera />
        <CubeMesh />
      </Canvas>
    </div>
  )
}
