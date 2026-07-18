import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { geometryToModel } from '../lib/geometryToModel'
import { ensureManifoldSolid } from '../lib/manifoldOps'
import { prepareForDisplay } from '../lib/stlRepair'
import { downloadSTL, downloadMultiSTL } from '../lib/exportSTL'
import {
  loadWheelAsset,
  mirrorPoint,
  axleDirection,
  unitCutterGeometry,
  prepareBody,
  buildAllPins,
  buildAllWheels,
  unionPinsIntoBody,
  type Axle,
  type MirrorAxis,
} from '../lib/wheelPrep'

const BASE = import.meta.env.BASE_URL
const PIN_URL = `${BASE}wheels/wheel-joint.stl`
const STD_URL = `${BASE}wheels/wheel-std.stl`
const WIDE_URL = `${BASE}wheels/wheel-wide.stl`

type PreviewWheel = 'none' | 'std' | 'wide'

function DisplayMesh({
  geometry,
  color,
  metalness = 0.1,
  roughness = 0.6,
  raycast = null,
}: {
  geometry: THREE.BufferGeometry | null
  color: string
  metalness?: number
  roughness?: number
  raycast?: null | undefined
}) {
  const disp = useMemo(
    () => (geometry ? prepareForDisplay(geometry) : null),
    [geometry],
  )
  if (!disp) return null
  return (
    <mesh geometry={disp} raycast={raycast ?? undefined}>
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        flatShading
      />
    </mesh>
  )
}

function RaycastMesh({
  geometry,
  onPick,
}: {
  geometry: THREE.BufferGeometry | null
  onPick: (p: THREE.Vector3) => void
}) {
  if (!geometry) return null
  return (
    <mesh
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation()
        onPick(e.point.clone())
      }}
    >
      <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
    </mesh>
  )
}

function AxleMarkers({
  axles,
  selected,
  onSelect,
  markerScale,
}: {
  axles: Axle[]
  selected: number
  onSelect: (i: number) => void
  markerScale: number
}) {
  return (
    <>
      {axles.map((a, i) => {
        const isSel = i === selected
        const color = isSel ? '#ffb84d' : '#51cf66'
        const r = markerScale * (isSel ? 1.4 : 1)
        return (
          <group key={i}>
            <mesh
              position={a.center}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(i)
              }}
            >
              <sphereGeometry args={[r, 16, 16]} />
              <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
            <mesh position={a.mirrored}>
              <sphereGeometry args={[r * 0.8, 16, 16]} />
              <meshBasicMaterial color={color} opacity={0.7} transparent />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

/** Translucent cylinder at each wheel center so the cut is visible before applying. */
function CutterPreviews({
  axles,
  axis,
  radius,
  length,
  exclude,
}: {
  axles: Axle[]
  axis: MirrorAxis
  radius: number
  length: number
  exclude?: number
}) {
  const dir = axleDirection(axis)
  const geom = useMemo(() => unitCutterGeometry(dir), [dir])
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <>
      {axles.map((a, i) => {
        if (i === exclude) return null
        return (
          <group key={i}>
            <mesh
              geometry={geom}
              position={a.center}
              scale={[radius, length, radius]}
            >
              <meshBasicMaterial
                color="#ff6b6b"
                transparent
                opacity={0.18}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              geometry={geom}
              position={a.mirrored}
              scale={[radius, length, radius]}
            >
              <meshBasicMaterial
                color="#ff6b6b"
                transparent
                opacity={0.18}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

/** Scale gizmo attached to the selected axle's primary cutter — drag the
 *  x/z handle to change radius, the y handle to change length. */
function CutterResizeGizmo({
  center,
  axleDir,
  radius,
  length,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  center: THREE.Vector3
  axleDir: THREE.Vector3
  radius: number
  length: number
  onChange: (radius: number, length: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const [obj, setObj] = useState<THREE.Mesh | null>(null)
  const geom = useMemo(() => unitCutterGeometry(axleDir), [axleDir])
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <>
      <mesh
        ref={setObj}
        geometry={geom}
        position={center}
        scale={[radius, length, radius]}
      >
        <meshBasicMaterial
          color="#ffb84d"
          transparent
          opacity={0.25}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {obj && (
        <TransformControls
          object={obj}
          mode="scale"
          size={0.9}
          onObjectChange={() => {
            const s = obj.scale
            onChange(Math.max(0.1, s.x), Math.max(0.1, s.y))
          }}
          onMouseDown={onDragStart}
          onMouseUp={onDragEnd}
        />
      )}
    </>
  )
}

/** Translate gizmo attached to the selected axle's primary marker. */
function AxleGizmo({
  position,
  size,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  position: THREE.Vector3
  size: number
  onChange: (p: THREE.Vector3) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null)
  return (
    <>
      <object3D ref={setObj} position={position} />
      {obj && (
        <TransformControls
          object={obj}
          mode="translate"
          size={size}
          onObjectChange={() => onChange(obj.position.clone())}
          onMouseDown={onDragStart}
          onMouseUp={onDragEnd}
        />
      )}
    </>
  )
}

/** Round `raw` to a clean 1/2/5 × 10^n step for grid lines. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const base = Math.pow(10, exp)
  const f = raw / base
  const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  return nice * base
}

/** Bed grid in the XY plane (Z up), sized to the loaded car. */
function BedGrid({ geom }: { geom: THREE.BufferGeometry | null }) {
  const cfg = useMemo<{ args: [number, number]; cell: number; section: number; fade: number }>(() => {
    if (!geom) return { args: [20, 20], cell: 1, section: 5, fade: 60 }
    geom.computeBoundingBox()
    const b = geom.boundingBox!
    const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 1.4
    const cell = niceStep(span / 20)
    const section = cell * 5
    return { args: [span, span], cell, section, fade: span * 2 }
  }, [geom])
  return (
    <Grid
      args={cfg.args}
      cellSize={cfg.cell}
      cellThickness={0.5}
      cellColor="#2a2f3a"
      sectionSize={cfg.section}
      sectionThickness={1.2}
      sectionColor="#4a5160"
      fadeDistance={cfg.fade}
      fadeStrength={1}
      infiniteGrid={false}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
    />
  )
}

function CameraRig({
  geometry,
  token,
}: {
  geometry: THREE.BufferGeometry | null
  token: number
}) {
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
    const frame = () => {
      // Adaptive near/far so models of any scale (tiny or 10k+ units) render
      // instead of being clipped by a fixed far plane.
      camera.near = Math.max(dist / 1000, 1e-4)
      camera.far = dist * 100
      camera.updateProjectionMatrix()
      camera.position.set(center.x + dist, center.y - dist * 0.85, center.z + dist * 0.55)
      camera.lookAt(center)
      if (controls && 'target' in controls) {
        const c = controls as unknown as { target: THREE.Vector3; update: () => void }
        c.target.copy(center)
        c.update()
      }
    }
    frame()
    const raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [geometry, camera, controls, token])
  return null
}

export default function WheelTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [carGeom, setCarGeom] = useState<THREE.BufferGeometry | null>(null)
  const [carName, setCarName] = useState<string>('')
  const [axles, setAxles] = useState<Axle[]>([])
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>('x')
  const [cutterRadius, setCutterRadius] = useState(5)
  const [cutterLength, setCutterLength] = useState(20)
  const [pinRot, setPinRot] = useState<[number, number, number]>([0, 0, 0])
  const [previewWheel, setPreviewWheel] = useState<PreviewWheel>('std')
  const [unionPins, setUnionPins] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [frameToken, setFrameToken] = useState(0)
  const [selected, setSelected] = useState(-1)
  const [dragging, setDragging] = useState(false)
  const [gizmoMode, setGizmoMode] = useState<'move' | 'resize'>('move')
  const [addMode, setAddMode] = useState(false)

  const [pinAsset, setPinAsset] = useState<THREE.BufferGeometry | null>(null)
  const [wheelStd, setWheelStd] = useState<THREE.BufferGeometry | null>(null)
  const [wheelWide, setWheelWide] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pin, std, wide] = await Promise.all([
          loadWheelAsset(PIN_URL),
          loadWheelAsset(STD_URL),
          loadWheelAsset(WIDE_URL),
        ])
        if (cancelled) return
        setPinAsset(pin)
        setWheelStd(std)
        setWheelWide(wide)
      } catch (e) {
        if (!cancelled) setError(`Asset load: ${(e as Error).message}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.stl$/i)) {
      setError('Please upload a .stl file')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const loader = new STLLoader()
      const geom = loader.parse(buf)
      if (!geom.getAttribute('position')) throw new Error('STL has no geometry')
      // Toy-car STLs from generators are often non-manifold; weld + repair
      // through Manifold so subsequent boolean cuts don't fail.
      let clean = geom
      try {
        clean = await ensureManifoldSolid(geom)
      } catch {
        // Fall back to the raw geometry if repair fails — cuts may then fail
        // with a clear error, but the model still renders.
        clean = geom
      }
      const model = geometryToModel(clean, file.name)
      const g = model.geometry
      g.computeBoundingBox()
      const b = g.boundingBox!
      const sx = b.max.x - b.min.x
      const sy = b.max.y - b.min.y
      const sz = b.max.z - b.min.z
      setMirrorAxis(sx <= sy ? 'x' : 'y')
      setCutterRadius(Math.round(Math.max(sx, sy) * 0.05 * 10) / 10)
      setCutterLength(Math.round(sz * 1.5 * 10) / 10)
      setCarGeom(g)
      setCarName(file.name)
      setAxles([])
    } catch (e) {
      setError((e as Error).message || 'Load failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const [preparedBody, setPreparedBody] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    if (!carGeom) {
      setPreparedBody(null)
      return
    }
    let cancelled = false
    setBusy(true)
    // Debounce so dragging the axle gizmo doesn't thrash the boolean op.
    const handle = setTimeout(() => {
      ;(async () => {
        try {
          const body = await prepareBody(carGeom, axles, cutterRadius, cutterLength, mirrorAxis)
          if (!cancelled) {
            setPreparedBody(body)
            setError(null)
          }
        } catch (e) {
          if (!cancelled) setError(`Cut failed: ${(e as Error).message}`)
        } finally {
          if (!cancelled) setBusy(false)
        }
      })()
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [carGeom, axles, cutterRadius, cutterLength, mirrorAxis])

  const pins = useMemo(
    () => (pinAsset ? buildAllPins(pinAsset, axles, mirrorAxis, pinRot) : []),
    [pinAsset, axles, mirrorAxis, pinRot],
  )

  // Half of the pin's natural length along its local Y (the axle-aligned axis),
  // used to offset the preview wheel to the outer end of the pin. The pin
  // itself is never stretched.
  const pinHalfLength = useMemo(() => {
    if (!pinAsset) return 0
    pinAsset.computeBoundingBox()
    const b = pinAsset.boundingBox!
    return (b.max.y - b.min.y) / 2
  }, [pinAsset])

  const previewWheels = useMemo(() => {
    if (previewWheel === 'none') return []
    const asset = previewWheel === 'std' ? wheelStd : wheelWide
    if (!asset) return []
    return buildAllWheels(asset, axles, mirrorAxis, pinRot, pinHalfLength)
  }, [previewWheel, wheelStd, wheelWide, axles, mirrorAxis, pinRot, pinHalfLength])

  const displayGeom = axles.length > 0 ? preparedBody : carGeom

  // Marker / gizmo scale relative to the car so they're visible at any model size.
  const markerScale = useMemo(() => {
    if (!carGeom) return 1
    carGeom.computeBoundingBox()
    const b = carGeom.boundingBox!
    return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * 0.01
  }, [carGeom])

  const addAxle = useCallback(
    (p: THREE.Vector3) => {
      setAxles((prev) => {
        const next = [...prev, { center: p, mirrored: mirrorPoint(p, mirrorAxis) }]
        queueMicrotask(() => setSelected(next.length - 1))
        return next
      })
    },
    [mirrorAxis],
  )

  const moveAxle = useCallback(
    (i: number, p: THREE.Vector3) => {
      setAxles((prev) =>
        prev.map((a, idx) =>
          idx === i ? { center: p, mirrored: mirrorPoint(p, mirrorAxis) } : a,
        ),
      )
    },
    [mirrorAxis],
  )

  const removeAxle = (i: number) => {
    setAxles((prev) => prev.filter((_, idx) => idx !== i))
    setSelected((s) => (s === i ? -1 : s > i ? s - 1 : s))
  }
  const clearAxles = () => {
    setAxles([])
    setSelected(-1)
  }

  // Keyboard: Delete/Backspace removes the selected axle; Esc cancels add mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddMode(false)
        return
      }
      if (selected < 0) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeAxle(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const download = useCallback(async () => {
    if (!preparedBody) return
    setBusy(true)
    setError(null)
    try {
      const base = carName.replace(/\.stl$/i, '') || 'car'
      if (unionPins) {
        const merged = await unionPinsIntoBody(preparedBody, pins)
        downloadSTL(merged, `${base}_wheels.stl`)
      } else {
        downloadMultiSTL([preparedBody, ...pins], `${base}_wheels.stl`)
      }
    } catch (e) {
      setError((e as Error).message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [preparedBody, pins, unionPins, carName])

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
          <BedGrid geom={carGeom} />
          <DisplayMesh geometry={displayGeom} color="#6ea8fe" raycast={null} />
          {pins.map((g, i) => (
            <DisplayMesh key={`pin-${i}`} geometry={g} color="#ffb84d" metalness={0.2} roughness={0.4} raycast={null} />
          ))}
          {previewWheels.map((g, i) => (
            <DisplayMesh key={`pw-${i}`} geometry={g} color="#8a90a0" metalness={0.3} roughness={0.5} raycast={null} />
          ))}
          <CutterPreviews
            axles={axles}
            axis={mirrorAxis}
            radius={cutterRadius}
            length={cutterLength}
            exclude={gizmoMode === 'resize' ? selected : -1}
          />
          <AxleMarkers
            axles={axles}
            selected={selected}
            onSelect={setSelected}
            markerScale={markerScale}
          />
          {selected >= 0 && axles[selected] && !addMode && gizmoMode === 'move' && (
            <AxleGizmo
              position={axles[selected].center}
              size={markerScale * 1.5}
              onChange={(p) => moveAxle(selected, p)}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
            />
          )}
          {selected >= 0 && axles[selected] && !addMode && gizmoMode === 'resize' && (
            <CutterResizeGizmo
              center={axles[selected].center}
              axleDir={axleDirection(mirrorAxis)}
              radius={cutterRadius}
              length={cutterLength}
              onChange={(r, l) => {
                setCutterRadius(r)
                setCutterLength(l)
              }}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
            />
          )}
          <RaycastMesh
            geometry={carGeom}
            onPick={(p) => {
              if (addMode) {
                addAxle(p)
                setAddMode(false)
              } else {
                setSelected(-1)
              }
            }}
          />
          <CameraRig geometry={carGeom} token={frameToken} />
          <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.95} />
          <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
            <GizmoViewport
              axisColors={['#ff6b6b', '#51cf66', '#6ea8fe']}
              labelColor="#0b0d12"
            />
          </GizmoHelper>
        </Canvas>

        {carGeom && (
          <div className="viewport-toolbar">
            <button
              className={`viewport-btn primary ${addMode ? 'active' : ''}`}
              onClick={() => setAddMode((m) => !m)}
              title="Click, then click a wheel on the car to place an axle"
            >
              {addMode ? 'Add axle…' : 'Add axle'}
            </button>
            <div className="modes gizmo-modes">
              <button
                className={gizmoMode === 'move' ? 'active' : ''}
                onClick={() => setGizmoMode('move')}
                disabled={selected < 0 || addMode}
                title="Drag the axle to reposition it"
              >
                Move
              </button>
              <button
                className={gizmoMode === 'resize' ? 'active' : ''}
                onClick={() => setGizmoMode('resize')}
                disabled={selected < 0 || addMode}
                title="Drag the gizmo handles to resize the cutter"
              >
                Resize
              </button>
            </div>
            <button
              className="viewport-btn"
              onClick={() => setFrameToken((t) => t + 1)}
              title="Zoom to fit the car"
            >
              Recenter
            </button>
            <button
              className="viewport-btn"
              onClick={() => selected >= 0 && removeAxle(selected)}
              disabled={selected < 0}
              title="Delete the selected axle"
            >
              Delete axle
            </button>
            <button
              className="viewport-btn"
              onClick={() => {
                setAxles([])
                setSelected(-1)
              }}
              disabled={axles.length === 0}
              title="Remove every axle"
            >
              Clear all
            </button>
          </div>
        )}

        {carGeom && (
          <div className="viewport-hint">
            {addMode
              ? 'Click a wheel on the car to place the axle · Esc to cancel'
              : dragging
                ? gizmoMode === 'resize'
                  ? 'Resizing cutter…'
                  : 'Dragging axle…'
                : selected >= 0
                  ? gizmoMode === 'resize'
                    ? 'Drag the orange handles: x/z = radius, y = length · Del to remove'
                    : 'Drag the gizmo to move · Del to remove · click car to deselect'
                  : 'Click "Add axle" to place one · click a marker to select'}
          </div>
        )}

        {!carGeom && !busy && (
          <div className={`dropzone ${dropActive ? 'active' : ''}`}>
            <div className="card">
              <h2>Drop a toy car STL here</h2>
              <p>or use "Upload car STL" in the panel</p>
            </div>
          </div>
        )}
      </div>

      <aside className="panel repair-panel">
        <section>
          <h3>Toy car wheels</h3>
          <input
            ref={fileRef}
            type="file"
            accept=".stl"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) processFile(f)
              e.target.value = ''
            }}
          />
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload car STL
          </button>
          {carName && (
            <div className="help">
              <strong>{carName}</strong>
              <br />
              {axles.length} axle{axles.length === 1 ? '' : 's'} ({axles.length * 2} wheels)
            </div>
          )}
          <div className="help">
            Click a wheel on the car to add an axle. The opposite wheel is auto-mirrored across the symmetry plane.
          </div>
        </section>

        {carGeom && (
          <section>
            <h3>Axles</h3>
            {axles.length === 0 && <div className="help">No axles yet — click a wheel.</div>}
            {axles.map((a, i) => (
              <div className="row" key={i} style={{ fontSize: 11 }}>
                <span className="label">
                  Axle {i + 1}: ({a.center.x.toFixed(1)}, {a.center.y.toFixed(1)}, {a.center.z.toFixed(1)})
                </span>
                <button onClick={() => removeAxle(i)}>Remove</button>
              </div>
            ))}
            {axles.length > 0 && (
              <button className="danger" onClick={clearAxles}>
                Clear all
              </button>
            )}
          </section>
        )}

        {carGeom && (
          <section>
            <h3>Cutter</h3>
            <div className="row">
              <span className="label">Mirror axis</span>
              <div className="modes">
                <button className={mirrorAxis === 'x' ? 'active' : ''} onClick={() => setMirrorAxis('x')}>
                  X
                </button>
                <button className={mirrorAxis === 'y' ? 'active' : ''} onClick={() => setMirrorAxis('y')}>
                  Y
                </button>
              </div>
            </div>
            <label className="row">
              <span className="label">Radius</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={cutterRadius}
                onChange={(e) => setCutterRadius(Math.max(0.1, +e.target.value))}
              />
            </label>
            <label className="row">
              <span className="label">Length</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={cutterLength}
                onChange={(e) => setCutterLength(Math.max(0.1, +e.target.value))}
              />
            </label>
          </section>
        )}

        {carGeom && pinAsset && (
          <section>
            <h3>Pin rotation (deg)</h3>
            {(['x', 'y', 'z'] as const).map((ax, i) => (
              <label className="row" key={ax}>
                <span className="label">{ax.toUpperCase()}</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={pinRot[i]}
                  onChange={(e) => {
                    const v = [...pinRot] as [number, number, number]
                    v[i] = +e.target.value
                    setPinRot(v)
                  }}
                />
              </label>
            ))}
            <button onClick={() => setPinRot([0, 0, 0])}>Reset</button>
          </section>
        )}

        {carGeom && (
          <section>
            <h3>Preview wheel</h3>
            <div className="modes">
              <button className={previewWheel === 'none' ? 'active' : ''} onClick={() => setPreviewWheel('none')}>
                None
              </button>
              <button className={previewWheel === 'std' ? 'active' : ''} onClick={() => setPreviewWheel('std')}>
                Std
              </button>
              <button className={previewWheel === 'wide' ? 'active' : ''} onClick={() => setPreviewWheel('wide')}>
                Wide
              </button>
            </div>
          </section>
        )}

        {carGeom && (
          <section>
            <h3>Export</h3>
            <label className="row">
              <span className="label">Union pins into body</span>
              <input
                type="checkbox"
                checked={unionPins}
                onChange={(e) => setUnionPins(e.target.checked)}
              />
            </label>
            <button className="primary" onClick={download} disabled={busy || axles.length === 0}>
              Download body + pins STL
            </button>
            <div className="help">
              Exports the car body with wheel holes plus the pin joints. Preview wheels are not included.
            </div>
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
