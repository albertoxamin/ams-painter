import { useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../../state'
import { MESH_TRI_WARN } from '../../../lib/selectionSnapshot'
import { tryRestoreAutosave } from '../../../lib/restoreAutosave'
import { InteractionProvider } from '../interaction/InteractionContext'
import { useFileDrop } from '../../../platform/io/useFileDrop'
import CameraRig from '../../../platform/scene/CameraRig'
import ZUpGrid from '../../../platform/scene/ZUpGrid'
import { ModelMesh } from './ModelMesh'
import { BoxSelectOverlay } from '../../../components/BoxSelectOverlay'
import BoxSelectLayer from '../../../components/BoxSelectLayer'
import { ViewportPickBridge } from './ViewportPickBridge'
import { OrbitControlsConfig } from './OrbitControlsConfig'

export default function Viewport() {
  const model = useStore((s) => s.model)
  const paintTool = useStore((s) => s.paintTool)
  const setModel = useStore((s) => s.setModel)
  const setError = useStore((s) => s.setError)

  const restoreSelectionSnapshot = useStore((s) => s.restoreSelectionSnapshot)

  const onFile = useCallback(
    async (file: File) => {
      try {
        const buf = await file.arrayBuffer()
        const { loadSTL } = await import('../../../lib/loadSTL')
        const m = loadSTL(buf, file.name)
        setModel(m)
        if (m.count > MESH_TRI_WARN) {
          setError(
            `Large mesh (${m.count.toLocaleString()} tris). Painting may be slow — consider Repair tab to simplify first.`,
          )
        } else {
          setError(null)
        }
        const restored = await tryRestoreAutosave(m, restoreSelectionSnapshot)
        if (restored) {
          setError(null)
        }
      } catch (e) {
        setError((e as Error).message || 'Failed to load STL')
      }
    },
    [setModel, setError, restoreSelectionSnapshot],
  )

  const { dropActive, bind } = useFileDrop(onFile)

  return (
    <InteractionProvider>
      <div
        className={`viewport${paintTool === 'box' && model ? ' tool-box' : ''}`}
        {...bind()}
      >
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
            scene.background = new THREE.Color('#1d1d1d')
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
          <ViewportPickBridge />
          <OrbitControlsConfig />
          <OrbitControls
            makeDefault
            target={[0, 0, 10]}
            maxPolarAngle={Math.PI * 0.95}
          />
        </Canvas>

        <BoxSelectLayer />
        <BoxSelectOverlay />

        {!model && (
          <div className={`dropzone ${dropActive ? 'active' : ''}`}>
            <div className="card">
              <h2>Drop an STL here</h2>
              <p>or use Open STL in the properties panel</p>
            </div>
          </div>
        )}
      </div>
    </InteractionProvider>
  )
}
