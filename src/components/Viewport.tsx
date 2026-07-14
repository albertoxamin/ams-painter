import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../state'
import { selectionBoundaryEdges } from '../lib/extrude'
import { prepareParts } from '../lib/prepareParts'
import { facesNearPoint } from '../lib/brush'
import { splitContourSegments } from '../lib/splitContour'

const COLORS = {
  lower: '#9aa3b2',
  upper: '#c2c8d4',
  selected: '#ff8c42',
  dropIn: '#5ec8ff',
  dropInOutline: '#a8e4ff',
  outline: '#ffe08a',
  hover: '#7dd3fc',
  vertex: '#ffffff',
  insert: '#ff5a5a',
  recess: '#9aa3b2',
  plane: '#6ea8fe',
  cut: '#ffd166',
}

/** Nearest front-facing hit on `mesh`, or null. */
function pickHit(
  e: ThreeEvent<MouseEvent | PointerEvent>,
  mesh: THREE.Mesh,
  triCount: number,
): { idx: number; point: THREE.Vector3 } | null {
  const hits = e.intersections.filter((h) => h.object === mesh)
  const _n = new THREE.Vector3()
  const hit =
    hits.find((h) => {
      if (!h.face) return false
      _n.copy(h.face.normal).transformDirection(mesh.matrixWorld)
      return _n.dot(e.ray.direction) < 0
    }) ?? hits[0]

  if (!hit?.face) return null
  const idx = hit.faceIndex ?? Math.floor(hit.face.a / 3)
  if (idx < 0 || idx >= triCount) return null
  return { idx, point: hit.point.clone() }
}

function ModelMesh() {
  const model = useStore((s) => s.model)
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const mode = useStore((s) => s.mode)
  const brushRadius = useStore((s) => s.brushRadius)
  const splitHeight = useStore((s) => s.splitHeight)
  const preview = useStore((s) => s.preview)
  const setBusy = useStore((s) => s.setBusy)
  const setError = useStore((s) => s.setError)
  const beginStroke = useStore((s) => s.beginStroke)
  const paintFaces = useStore((s) => s.paintFaces)
  const busy = useStore((s) => s.busy)
  const meshRef = useRef<THREE.Mesh>(null)
  const painting = useRef(false)
  const lastPaintPoint = useRef<THREE.Vector3 | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const { controls, gl } = useThree()

  const paintAt = (e: ThreeEvent<PointerEvent>) => {
    if (!model || !meshRef.current) return
    const hit = pickHit(e, meshRef.current, model.count)
    if (!hit) return
    setHoverIdx(hit.idx)
    // Throttle by travel distance so we still cover new brush area
    if (
      lastPaintPoint.current &&
      lastPaintPoint.current.distanceToSquared(hit.point) <
        (brushRadius * 0.2) ** 2
    ) {
      return
    }
    lastPaintPoint.current = hit.point.clone()
    const faces =
      brushRadius <= 0.05
        ? [hit.idx]
        : facesNearPoint(model.geometry, hit.point, brushRadius)
    paintFaces(faces.length > 0 ? faces : [hit.idx], mode)
  }

  const endPaint = () => {
    if (!painting.current) return
    painting.current = false
    lastPaintPoint.current = null
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = true
    }
  }

  useEffect(() => {
    const up = () => endPaint()
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // endPaint closes over controls; rebind when controls change
  }, [controls])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!model || busy || e.button !== 0) return
    e.stopPropagation()
    painting.current = true
    lastPaintPoint.current = null
    beginStroke()
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = false
    }
    try {
      gl.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    paintAt(e)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!model || !meshRef.current || busy) return
    if (painting.current) {
      e.stopPropagation()
      paintAt(e)
      return
    }
    const hit = pickHit(e, meshRef.current, model.count)
    setHoverIdx(hit?.idx ?? null)
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    try {
      gl.domElement.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    endPaint()
  }

  const onPointerOut = () => {
    if (!painting.current) setHoverIdx(null)
  }

  if (!model) return null

  // Hide the source mesh while previewing so the exploded parts are clear
  const showSource = !preview

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={model.geometry}
        visible={showSource}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOut={onPointerOut}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={'#b8c0d0'}
          metalness={0.1}
          roughness={0.75}
          flatShading
          side={THREE.FrontSide}
        />
      </mesh>

      {showSource && (
        <>
          <HoverOutline
            geom={model.geometry}
            faceIndex={hoverIdx}
            brushRadius={brushRadius}
            hitPoint={null}
          />
          <BrushCursor
            geom={model.geometry}
            faceIndex={hoverIdx}
            brushRadius={brushRadius}
          />
          <SelectionOverlay
            geom={model.geometry}
            selection={structural}
            faceColor={COLORS.selected}
            outlineColor={COLORS.outline}
          />
          <SelectionOverlay
            geom={model.geometry}
            selection={dropIn}
            faceColor={COLORS.dropIn}
            outlineColor={COLORS.dropInOutline}
          />
          {!insertsOnly && (
            <SplitCutOutline geom={model.geometry} height={splitHeight} />
          )}
        </>
      )}
      <SplitPreview splitHeight={splitHeight} model={model} preview={preview} setBusy={setBusy} setError={setError} />
    </group>
  )
}

/** Yellow contour where z=H cuts through the mesh surface. */
function SplitCutOutline({
  geom,
  height,
}: {
  geom: THREE.BufferGeometry
  height: number
}) {
  const lineGeom = useMemo(() => {
    const segs = splitContourSegments(geom, height)
    if (segs.length < 6) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(segs, 3))
    return g
  }, [geom, height])

  if (!lineGeom) return null

  return (
    <lineSegments geometry={lineGeom} raycast={() => {}}>
      <lineBasicMaterial color={COLORS.cut} depthTest={false} />
    </lineSegments>
  )
}

/** Ring showing brush radius at the hovered face centroid. */
function BrushCursor({
  geom,
  faceIndex,
  brushRadius,
}: {
  geom: THREE.BufferGeometry
  faceIndex: number | null
  brushRadius: number
}) {
  if (faceIndex == null || brushRadius <= 0.05) return null
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const a = faceIndex * 3
  const c = new THREE.Vector3(
    (pos.getX(a) + pos.getX(a + 1) + pos.getX(a + 2)) / 3,
    (pos.getY(a) + pos.getY(a + 1) + pos.getY(a + 2)) / 3,
    (pos.getZ(a) + pos.getZ(a + 1) + pos.getZ(a + 2)) / 3,
  )
  // Orient ring using face normal so it sits on the surface
  const n = new THREE.Vector3()
  const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
  const v1 = new THREE.Vector3(pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1))
  const v2 = new THREE.Vector3(pos.getX(a + 2), pos.getY(a + 2), pos.getZ(a + 2))
  n.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize()
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    n,
  )

  return (
    <mesh position={c} quaternion={quat} raycast={() => {}}>
      <ringGeometry args={[brushRadius * 0.92, brushRadius, 48]} />
      <meshBasicMaterial
        color={COLORS.hover}
        transparent
        opacity={0.55}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  )
}

/** Outline-only preview of the triangle currently under the cursor. */
function HoverOutline({
  geom,
  faceIndex,
}: {
  geom: THREE.BufferGeometry
  faceIndex: number | null
  brushRadius?: number
  hitPoint?: THREE.Vector3 | null
}) {
  const edgeGeom = useMemo(() => {
    if (faceIndex == null) return null
    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const a = faceIndex * 3
    const corners = [0, 1, 2].map(
      (i) => new THREE.Vector3(pos.getX(a + i), pos.getY(a + i), pos.getZ(a + i)),
    )
    const edgePos: number[] = []
    for (let e = 0; e < 3; e++) {
      const u = corners[e]
      const v = corners[(e + 1) % 3]
      edgePos.push(u.x, u.y, u.z, v.x, v.y, v.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
    return g
  }, [geom, faceIndex])

  if (!edgeGeom) return null

  return (
    <lineSegments geometry={edgeGeom} raycast={() => {}}>
      <lineBasicMaterial color={COLORS.hover} depthTest={false} />
    </lineSegments>
  )
}

/** Renders selected triangles with face fill, edge outline, and vertex points. */
function SelectionOverlay({
  geom,
  selection,
  faceColor,
  outlineColor,
}: {
  geom: THREE.BufferGeometry
  selection: Set<number>
  faceColor: string
  outlineColor: string
}) {
  const { faceGeom, edgeGeom, boundaryGeom, vertexGeom } = useMemo(() => {
    if (selection.size === 0) {
      return {
        faceGeom: null as THREE.BufferGeometry | null,
        edgeGeom: null as THREE.BufferGeometry | null,
        boundaryGeom: null as THREE.BufferGeometry | null,
        vertexGeom: null as THREE.BufferGeometry | null,
      }
    }

    const pos = geom.getAttribute('position') as THREE.BufferAttribute
    const facePos: number[] = []
    const edgePos: number[] = []
    const vertKeys = new Map<string, THREE.Vector3>()

    for (const t of selection) {
      const a = t * 3
      const corners: THREE.Vector3[] = []
      for (let i = 0; i < 3; i++) {
        const vi = a + i
        const v = new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
        corners.push(v)
        facePos.push(v.x, v.y, v.z)
        const k = `${v.x.toFixed(5)}_${v.y.toFixed(5)}_${v.z.toFixed(5)}`
        vertKeys.set(k, v)
      }
      // all three edges of the triangle (wireframe)
      for (let e = 0; e < 3; e++) {
        const u = corners[e]
        const v = corners[(e + 1) % 3]
        edgePos.push(u.x, u.y, u.z, v.x, v.y, v.z)
      }
    }

    const faceG = new THREE.BufferGeometry()
    faceG.setAttribute('position', new THREE.Float32BufferAttribute(facePos, 3))
    faceG.computeVertexNormals()

    const edgeG = new THREE.BufferGeometry()
    edgeG.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))

    const boundary = selectionBoundaryEdges(geom, selection)
    const boundPos: number[] = []
    for (const v of boundary) boundPos.push(v.x, v.y, v.z)
    const boundG = new THREE.BufferGeometry()
    boundG.setAttribute('position', new THREE.Float32BufferAttribute(boundPos, 3))

    const vertPos: number[] = []
    for (const v of vertKeys.values()) vertPos.push(v.x, v.y, v.z)
    const vertG = new THREE.BufferGeometry()
    vertG.setAttribute('position', new THREE.Float32BufferAttribute(vertPos, 3))

    return {
      faceGeom: faceG,
      edgeGeom: edgeG,
      boundaryGeom: boundG,
      vertexGeom: vertG,
    }
  }, [geom, selection])

  if (!faceGeom || selection.size === 0) return null

  return (
    <group>
      {/* face fill — raycast disabled so overlays never steal picks */}
      <mesh geometry={faceGeom} raycast={() => {}}>
        <meshBasicMaterial
          color={faceColor}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          transparent
          opacity={0.75}
        />
      </mesh>

      {/* all selected triangle edges */}
      <lineSegments geometry={edgeGeom!} raycast={() => {}}>
        <lineBasicMaterial
          color={outlineColor}
          transparent
          opacity={0.55}
          depthTest
        />
      </lineSegments>

      {/* selection boundary silhouette */}
      <lineSegments geometry={boundaryGeom!} raycast={() => {}}>
        <lineBasicMaterial
          color={outlineColor}
          linewidth={2}
          depthTest={false}
        />
      </lineSegments>

      {/* vertex markers */}
      <points geometry={vertexGeom!} raycast={() => {}}>
        <pointsMaterial
          color={COLORS.vertex}
          size={3}
          sizeAttenuation={false}
          depthTest={false}
        />
      </points>
    </group>
  )
}

function SplitPreview({
  splitHeight,
  model,
  preview,
  setBusy,
  setError,
}: {
  splitHeight: number
  model: NonNullable<ReturnType<typeof useStore.getState>['model']>
  preview: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
}) {
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
  const explode = useStore((s) => s.explode)
  const clearance = useStore((s) => s.clearance)
  const dropInFloorZ = useStore((s) => s.dropInFloorZ)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const cutAxis = useStore((s) => s.cutAxis)
  const [parts, setParts] = useState<{
    lower: THREE.BufferGeometry
    upper: THREE.BufferGeometry | null
    dropIns: THREE.BufferGeometry[]
    insertsOnly: boolean
  } | null>(null)

  useEffect(() => {
    if (!preview) {
      setParts(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    ;(async () => {
      try {
        const prepared = await prepareParts(
          model.geometry,
          splitHeight,
          structural,
          dropIn,
          model.zMin,
          clearance,
          {
            dropInFloorZ,
            insertsOnly,
            cutAxis,
            dropInMeta,
            adjacency: model.adjacency,
          },
        )
        if (cancelled) return
        setParts({
          lower: prepared.bottom,
          upper: prepared.upper,
          dropIns: prepared.dropIns,
          insertsOnly: prepared.insertsOnly,
        })
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setError((err as Error).message || 'CSG failed')
          setParts(null)
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    preview,
    model,
    splitHeight,
    structural,
    dropIn,
    dropInMeta,
    clearance,
    dropInFloorZ,
    insertsOnly,
    cutAxis,
    setBusy,
    setError,
  ])

  const box = model.geometry.boundingBox!
  const size = new THREE.Vector3()
  box.getSize(size)
  const planeW = Math.max(size.x, size.y) * 1.4
  const planeH = planeW
  // Explode gap along Z (up): scales with model height
  const gap = size.z * 0.85 * explode

  return (
    <group>
      {/* split plane — hide in inserts-only or when exploded */}
      {!insertsOnly && explode < 0.05 && (
        <>
          <mesh position={[0, 0, splitHeight]} raycast={() => {}}>
            <planeGeometry args={[planeW, planeH]} />
            <meshBasicMaterial
              color={COLORS.plane}
              transparent
              opacity={0.18}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments position={[0, 0, splitHeight]} raycast={() => {}}>
            <edgesGeometry args={[new THREE.PlaneGeometry(planeW, planeH)]} />
            <lineBasicMaterial color={COLORS.plane} />
          </lineSegments>
        </>
      )}

      {preview && parts && (
        <group>
          <mesh
            geometry={parts.lower}
            position={[0, 0, parts.insertsOnly ? 0 : -gap]}
            raycast={() => {}}
          >
            <meshStandardMaterial color={COLORS.lower} flatShading side={THREE.FrontSide} />
          </mesh>
          {parts.upper && (
            <mesh geometry={parts.upper} position={[0, 0, gap]} raycast={() => {}}>
              <meshStandardMaterial
                color={COLORS.upper}
                flatShading
                side={THREE.DoubleSide}
                transparent
                opacity={0.7}
              />
            </mesh>
          )}
          {parts.dropIns.map((g, i) => (
            <mesh
              key={i}
              geometry={g}
              position={[0, 0, gap * (parts.insertsOnly ? 1.1 : 1.35)]}
              raycast={() => {}}
            >
              <meshStandardMaterial
                color={COLORS.dropIn}
                flatShading
                side={THREE.FrontSide}
              />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}

function Grid() {
  // Three.js GridHelper lies in XZ with Y-up; rotate so it sits on the Z-up bed (XY).
  return (
    <gridHelper
      args={[400, 80, '#2a2f3a', '#1a1d24']}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
    />
  )
}

function CameraRig() {
  const model = useStore((s) => s.model)
  const { camera, controls } = useThree()
  useEffect(() => {
    // STL convention: Z is up
    camera.up.set(0, 0, 1)
    if (!model) return
    model.geometry.computeBoundingBox()
    const b = model.geometry.boundingBox!
    const size = new THREE.Vector3()
    b.getSize(size)
    const dist = Math.max(size.x, size.y, size.z) * 1.8
    const midZ = size.z / 2
    camera.position.set(dist, -dist * 0.85, dist * 0.55)
    camera.lookAt(0, 0, midZ)
    if (controls && 'target' in controls) {
      ;(controls as unknown as { target: THREE.Vector3; update: () => void }).target.set(0, 0, midZ)
      ;(controls as unknown as { update: () => void }).update()
    }
  }, [model, camera, controls])
  return null
}

export default function Viewport() {
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const setError = useStore((s) => s.setError)
  const [dropActive, setDropActive] = useState(false)

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer()
      const { loadSTL } = await import('../lib/loadSTL')
      const m = loadSTL(buf, file.name)
      setModel(m)
    } catch (e) {
      setError((e as Error).message || 'Failed to load STL')
    }
  }

  return (
    <div
      className="viewport"
      onDragOver={(e) => {
        e.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
    >
      <Canvas
        shadows
        camera={{ fov: 45, near: 0.1, far: 5000, position: [200, -170, 120], up: [0, 0, 1] }}
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
        <Grid />
        <ModelMesh />
        <CameraRig />
        <OrbitControls makeDefault target={[0, 0, 10]} maxPolarAngle={Math.PI * 0.95} />
      </Canvas>

      <div className="overlay">
        {model && (
          <>
            <div className="badge">
              {model.name} · {model.count.toLocaleString()} tris · z{' '}
              {model.zMin.toFixed(1)}–{model.zMax.toFixed(1)}
            </div>
          </>
        )}
      </div>

      {!model && (
        <div className={`dropzone ${dropActive ? 'active' : ''}`}>
          <div className="card">
            <h2>Drop an STL here</h2>
            <p>or use “Load STL” in the panel</p>
          </div>
        </div>
      )}
    </div>
  )
}
