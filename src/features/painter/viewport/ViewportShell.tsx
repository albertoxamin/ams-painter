import { useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../../state'
import ViewportToolbar, { ViewportHint } from '../../../components/ViewportToolbar'
import { InteractionProvider } from '../interaction/InteractionContext'
import { useFileDrop } from '../../../platform/io/useFileDrop'
import CameraRig from '../../../platform/scene/CameraRig'
import ZUpGrid from '../../../platform/scene/ZUpGrid'
import { ModelMesh } from './ModelMesh'

export default function Viewport() {
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const setError = useStore((s) => s.setError)

  const onFile = useCallback(
    async (file: File) => {
      try {
        const buf = await file.arrayBuffer()
        const { loadSTL } = await import('../../../lib/loadSTL')
        const m = loadSTL(buf, file.name)
        setModel(m)
      } catch (e) {
        setError((e as Error).message || 'Failed to load STL')
      }
    },
    [setModel, setError],
  )

  const { dropActive, bind } = useFileDrop(onFile)

  return (
    <InteractionProvider>
      <div className="viewport" {...bind()}>
        <Canvas
          shadows
          camera={{
            fov: 45,
            near: 0.1,
            far: 5000,
            position: [200, -170, 120],
            up: [0, 0, 1],
          }}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          onCreated={({ camera, scene }) => {
            camera.up.set(0, 0, 1)
            scene.background = new THREE.Color('#0a0c10')
          }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[200, -150, 300]}
            intensity={1.2}
            castShadow
          />
          <directionalLight position={[-150, 100, 200]} intensity={0.4} />
          <ZUpGrid />
          <ModelMesh />
          <CameraRig model={model} />
          <OrbitControls
            makeDefault
            target={[0, 0, 10]}
            maxPolarAngle={Math.PI * 0.95}
          />
        </Canvas>

        <div className="overlay">
          {model && (
            <div className="badge">
              {model.name} · {model.count.toLocaleString()} tris · z{' '}
              {model.zMin.toFixed(1)}–{model.zMax.toFixed(1)}
            </div>
          )}
        </div>

        <ViewportToolbar />
        <ViewportHint />

        {!model && (
          <div className={`dropzone ${dropActive ? 'active' : ''}`}>
            <div className="card">
              <h2>Drop an STL here</h2>
              <p>or use "Load STL" in the panel</p>
            </div>
          </div>
        )}
      </div>
    </InteractionProvider>
  )
}
