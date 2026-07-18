import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  CHECK_LABELS,
  type MeshCheckResult,
} from '../lib/meshAnalysis'
import { repairGLB, type RepairProgress, type RepairResult } from '../lib/repairMesh'
import { prepareForDisplay } from '../lib/stlRepair'
import { downloadSTL } from '../lib/exportSTL'

function PreviewMesh({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const displayGeom = useMemo(
    () => (geometry ? prepareForDisplay(geometry) : null),
    [geometry],
  )
  if (!displayGeom) return null
  return (
    <mesh geometry={displayGeom}>
      <meshStandardMaterial
        color="#6ea8fe"
        metalness={0.1}
        roughness={0.6}
        flatShading
      />
    </mesh>
  )
}

function CameraRig({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    camera.up.set(0, 0, 1)
    if (!geometry) return
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    b.getCenter(center)
    b.getSize(size)
    const dist = Math.max(size.x, size.y, size.z, 0.01) * 1.8
    camera.position.set(
      center.x + dist,
      center.y - dist * 0.85,
      center.z + dist * 0.55,
    )
    camera.lookAt(center)
    if (controls && 'target' in controls) {
      ;(controls as unknown as { target: THREE.Vector3; update: () => void }).target.copy(center)
      ;(controls as unknown as { update: () => void }).update()
    }
  }, [geometry, camera, controls])
  return null
}

function CheckTree({
  checks,
  indent = false,
}: {
  checks: MeshCheckResult
  indent?: boolean
}) {
  return (
    <div className={`check-tree${indent ? ' indent' : ''}`}>
      {CHECK_LABELS.map(({ key, label }) => {
        const count = checks[key]
        const cls =
          count === 0 ? 'check-ok' : count > 0 ? 'check-warn' : 'check-pending'
        return (
          <div key={key} className={`check-row ${cls}`}>
            <span className="check-bullet">{indent ? '→' : '→'}</span>
            <span className="check-label">{label}</span>
            <span className="check-value">{count}</span>
          </div>
        )
      })}
    </div>
  )
}

function CompareChecks({
  before,
  after,
}: {
  before: MeshCheckResult
  after: MeshCheckResult
}) {
  return (
    <div className="check-tree indent">
      {CHECK_LABELS.map(({ key, label }) => {
        const b = before[key]
        const a = after[key]
        const fixed = b > 0 && a === 0
        const stillBad = a > 0
        const cls = fixed ? 'check-ok' : stillBad ? 'check-warn' : 'check-ok'
        return (
          <div key={key} className={`check-row ${cls}`}>
            <span className="check-bullet">→</span>
            <span className="check-label">{label}</span>
            <span className="check-value">
              {fixed && <span className="check-fixed">{b} → 0</span>}
              {!fixed && b === 0 && a === 0 && '0'}
              {!fixed && b > 0 && a > 0 && `${b} → ${a}`}
              {!fixed && b === 0 && a > 0 && a}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function RepairTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<RepairProgress | null>(null)
  const [result, setResult] = useState<RepairResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [showRepaired, setShowRepaired] = useState(true)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.glb$/i)) {
      setError('Please upload a .glb file')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress({ stage: 'loading', message: 'Starting…' })

    try {
      const buf = await file.arrayBuffer()
      const res = await repairGLB(buf, file.name, setProgress)
      setResult(res)
      setShowRepaired(true)
    } catch (e) {
      setError((e as Error).message || 'Repair failed')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [])

  const previewGeom =
    result && showRepaired ? result.repairedGeometry : result?.rawGeometry ?? null

  const download = () => {
    if (!result) return
    const base = result.sourceName.replace(/\.glb$/i, '')
    downloadSTL(result.repairedGeometry, `${base}_repaired.stl`)
  }

  const done = progress?.stage === 'done'

  return (
    <div className="repair-tab">
      <div
        className="repair-viewport"
        onDragOver={(e) => {
          e.preventDefault()
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDropActive(false)
          const f = e.dataTransfer.files?.[0]
          if (f) processFile(f)
        }}
      >
        <Canvas
          camera={{ fov: 45, near: 0.1, far: 5000, position: [200, -170, 120], up: [0, 0, 1] }}
          gl={{ antialias: true }}
          onCreated={({ camera, scene }) => {
            camera.up.set(0, 0, 1)
            scene.background = new THREE.Color('#0a0c10')
          }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[200, -150, 300]} intensity={1.2} />
          <directionalLight position={[-150, 100, 200]} intensity={0.4} />
          <PreviewMesh geometry={previewGeom} />
          <CameraRig geometry={previewGeom} />
          <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.95} />
        </Canvas>

        {!result && !busy && (
          <div className={`dropzone ${dropActive ? 'active' : ''}`}>
            <div className="card">
              <h2>Drop a GLB here</h2>
              <p>or use "Upload GLB" in the panel</p>
            </div>
          </div>
        )}
      </div>

      <aside className="panel repair-panel">
        <section>
          <h3>GLB → STL Repair</h3>
          <input
            ref={fileRef}
            type="file"
            accept=".glb"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) processFile(f)
              e.target.value = ''
            }}
          />
          <button
            className="primary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Upload GLB
          </button>
          {result && (
            <div className="help">
              <strong>{result.sourceName}</strong>
              <br />
              {result.after.triangleCount.toLocaleString()} triangles
              {done && (
                <>
                  <br />
                  Vertices: {result.vertexCountBefore.toLocaleString()} →{' '}
                  {result.vertexCountAfter.toLocaleString()}
                  <br />
                  Triangles: {result.triangleCountBefore.toLocaleString()} →{' '}
                  {result.triangleCountAfter.toLocaleString()}
                </>
              )}
            </div>
          )}
        </section>

        {(busy || result) && (
          <section>
            <h3>Repair log</h3>
            <div className="repair-log">
              {progress && progress.stage === 'loading' && (
                <div className="log-step">Loading GLB…</div>
              )}
              {progress && progress.stage === 'converting' && (
                <div className="log-step">Converting to STL mesh…</div>
              )}
              {(progress?.beforeChecks || result) && (
                <>
                  <div className="log-step">Analyzing file</div>
                  <CheckTree
                    checks={
                      progress?.beforeChecks ?? result!.before.checks
                    }
                    indent
                  />
                </>
              )}
              {progress && (progress.stage === 'repairing' || progress.afterChecks) && (
                <div className="log-step" style={{ marginTop: 10 }}>
                  {progress.repairPct !== undefined
                    ? `Repairing: ${progress.repairPct.toFixed(0)}%`
                    : 'Repairing mesh…'}
                </div>
              )}
              {(progress?.afterChecks || (result && done)) && (
                <>
                  <div className="log-step" style={{ marginTop: 10 }}>
                    Re-analyzing
                  </div>
                  <CompareChecks
                    before={
                      progress?.beforeChecks ?? result!.before.checks
                    }
                    after={
                      progress?.afterChecks ?? result!.after.checks
                    }
                  />
                </>
              )}
              {busy && !progress?.beforeChecks && (
                <div className="progress-spinner" />
              )}
            </div>
          </section>
        )}

        {result && done && (
          <section>
            <h3>Result</h3>
            <div className="help">
              {result.repaired && result.after.ok
                ? 'Mesh is watertight and ready for slicing.'
                : result.repaired
                  ? 'Repair ran but some issues remain — the mesh may need manual cleanup.'
                  : 'Auto-repair could not fix this mesh. Download the converted STL and repair in a dedicated tool, or simplify the model.'}
            </div>
            {result.repairWarning && (
              <div className="help" style={{ color: 'var(--warn)', marginTop: 6 }}>
                {result.repairWarning}
              </div>
            )}
          </section>
        )}

        {result && (
          <section>
            <h3>Preview</h3>
            <div className="modes">
              <button
                className={!showRepaired ? 'active' : ''}
                onClick={() => setShowRepaired(false)}
              >
                Original
              </button>
              <button
                className={showRepaired ? 'active' : ''}
                onClick={() => setShowRepaired(true)}
              >
                Repaired
              </button>
            </div>
          </section>
        )}

        {result && (
          <section>
            <h3>Export</h3>
            <button className="primary" onClick={download} disabled={busy}>
              Download {result.repaired ? 'repaired' : 'converted'} STL
            </button>
          </section>
        )}

        {error && (
          <section>
            <div className="help" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          </section>
        )}
      </aside>
    </div>
  )
}
