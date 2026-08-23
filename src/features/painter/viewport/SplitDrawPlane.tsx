import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../../state'
import { splitDrawPlane } from '../../../lib/clipAlongSpline'
import {
  cloneNode,
  cornerAt,
  setMirroredOut,
  type SplitPathNode,
} from '../../../lib/splitBezier'
import { SplitSplineOverlay } from './overlays/SplitSplineOverlay'
import { SplitBezierEditor } from './overlays/SplitBezierEditor'
import { COLORS } from './constants'

const FINISH_EVENT = 'ams-painter-finish-split-line'
const RESUME_EVENT = 'ams-painter-resume-split-line'
const DRAG_PX = 5

export function requestFinishSplitLine() {
  window.dispatchEvent(new Event(FINISH_EVENT))
}

export function requestResumeSplitLine() {
  window.dispatchEvent(new Event(RESUME_EVENT))
}

export function SplitDrawPlane() {
  const model = useStore((s) => s.model)
  const paintTool = useStore((s) => s.paintTool)
  const splitMode = useStore((s) => s.splitMode)
  const lock = useStore((s) => s.splitLockAxis)
  const splitSpline = useStore((s) => s.splitSpline)
  const setSplitSpline = useStore((s) => s.setSplitSpline)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const busy = useStore((s) => s.busy)
  const preview = useStore((s) => s.preview)
  const { camera, gl, controls } = useThree()
  const [draft, setDraft] = useState<SplitPathNode[]>([])
  const [cursor, setCursor] = useState<THREE.Vector3 | null>(null)
  const [drawing, setDrawing] = useState(true)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const drawingRef = useRef(drawing)
  drawingRef.current = drawing
  const placing = useRef<{
    i: number
    sx: number
    sy: number
    dragged: boolean
  } | null>(null)

  const active =
    !preview &&
    !insertsOnly &&
    splitMode === 'spline' &&
    paintTool === 'splitLine' &&
    !!model

  const center = useMemo(() => {
    if (!model) return new THREE.Vector3()
    model.geometry.computeBoundingBox()
    return model.geometry.boundingBox!.getCenter(new THREE.Vector3())
  }, [model])

  const bbox = useMemo(() => {
    if (!model) return new THREE.Box3()
    model.geometry.computeBoundingBox()
    return model.geometry.boundingBox!.clone()
  }, [model])

  const planeSize = useMemo(() => {
    const s = bbox.getSize(new THREE.Vector3())
    return Math.max(s.x, s.y, s.z, 40) * 2.4
  }, [bbox])

  const handleSize = useMemo(() => {
    const s = bbox.getSize(new THREE.Vector3())
    return Math.max(s.x, s.y, s.z, 20)
  }, [bbox])

  const plane = useMemo(() => splitDrawPlane(center, lock), [center, lock])

  const quat = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal)
    return q
  }, [plane])

  const setOrbit = (on: boolean) => {
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = on
    }
  }

  useEffect(() => {
    if (!active) {
      setDraft([])
      setCursor(null)
      setDrawing(true)
      placing.current = null
      return
    }
    setDraft(splitSpline.map(cloneNode))
    setDrawing(splitSpline.length < 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active || drawing) return
    setDraft(splitSpline.map(cloneNode))
  }, [active, drawing, splitSpline])

  const hitClient = useCallback(
    (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, camera)
      const out = new THREE.Vector3()
      return raycaster.ray.intersectPlane(plane, out) ? out : null
    },
    [camera, gl, plane],
  )

  const commit = useCallback(
    (pts: SplitPathNode[]) => {
      if (pts.length >= 2) setSplitSpline(pts.map(cloneNode))
      else setSplitSpline([])
    },
    [setSplitSpline],
  )

  const finish = useCallback(() => {
    const pts = draftRef.current
    if (pts.length >= 2) commit(pts)
    setDrawing(false)
    setCursor(null)
    placing.current = null
    setOrbit(true)
    return pts.length >= 2
  }, [commit])

  useEffect(() => {
    if (!active) return

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        finish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setDraft([])
        setCursor(null)
        setDrawing(true)
        setSplitSpline([])
      } else if (e.key === 'Backspace' && drawingRef.current) {
        e.preventDefault()
        setDraft((d) => d.slice(0, -1))
      }
    }

    const onFinish = () => finish()
    const onResume = () => {
      setDrawing(true)
      setCursor(null)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(FINISH_EVENT, onFinish)
    window.addEventListener(RESUME_EVENT, onResume)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(FINISH_EVENT, onFinish)
      window.removeEventListener(RESUME_EVENT, onResume)
    }
  }, [active, finish, setSplitSpline])

  useEffect(() => {
    if (!active || busy) return
    const viewport = document.querySelector('.viewport')
    if (!viewport) return

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!viewport.contains(e.target as Node)) return
      if (
        (e.target as HTMLElement).closest(
          'button, input, a, .painter-proj-toggle, .scene-view-cube, .split-face-pad',
        )
      ) {
        return
      }
      if (!drawingRef.current) return
      ;(document.activeElement as HTMLElement | null)?.blur()

      if (e.detail >= 2) {
        e.preventDefault()
        e.stopPropagation()
        const pts = draftRef.current
        if (pts.length >= 2) {
          const a = pts[pts.length - 1]!
          const b = pts[pts.length - 2]!
          const dup =
            (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 < 1e-4
          if (dup) {
            const cleaned = pts.slice(0, -1)
            draftRef.current = cleaned
            setDraft(cleaned)
          }
        }
        finish()
        return
      }

      const p = hitClient(e.clientX, e.clientY)
      if (!p) return
      e.preventDefault()
      e.stopPropagation()
      setCursor(null)
      setDraft((d) => {
        const next = [...d, cornerAt(p)]
        placing.current = {
          i: next.length - 1,
          sx: e.clientX,
          sy: e.clientY,
          dragged: false,
        }
        setOrbit(false)
        return next
      })
    }

    const onPointerMove = (e: PointerEvent) => {
      const pl = placing.current
      if (pl) {
        const p = hitClient(e.clientX, e.clientY)
        if (!p) return
        const dist = Math.hypot(e.clientX - pl.sx, e.clientY - pl.sy)
        if (dist > DRAG_PX) pl.dragged = true
        if (!pl.dragged) return
        setDraft((d) => {
          const i = pl.i
          const n = d[i]
          if (!n) return d
          const next = d.map(cloneNode)
          next[i] = setMirroredOut(n, p)
          return next
        })
        return
      }
      if (!drawingRef.current) {
        setCursor(null)
        return
      }
      setCursor(hitClient(e.clientX, e.clientY))
    }

    const onPointerUp = () => {
      if (!placing.current) return
      placing.current = null
      setOrbit(true)
    }

    viewport.addEventListener('pointerdown', onPointerDown, true)
    viewport.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      viewport.removeEventListener('pointerdown', onPointerDown, true)
      viewport.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [active, busy, finish, hitClient])

  const overlayPts = active ? draft : splitSpline
  const show =
    !preview &&
    !insertsOnly &&
    splitMode === 'spline' &&
    (overlayPts.length > 0 || active)

  if (!model || !show) return null

  return (
    <group>
      {active && drawing && (
        <mesh position={center} quaternion={quat} raycast={() => {}}>
          <planeGeometry args={[planeSize, planeSize]} />
          <meshBasicMaterial
            color={COLORS.plane}
            transparent
            opacity={0.08}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      <SplitSplineOverlay
        nodes={overlayPts}
        cursor={active && drawing && !placing.current ? cursor : null}
        lock={lock}
        bbox={bbox}
        showAnchors={drawing}
        showHandles={drawing}
      />
      {active && !drawing && draft.length >= 2 && (
        <SplitBezierEditor
          nodes={draft}
          plane={plane}
          size={handleSize}
          onChange={setDraft}
          onCommit={() => commit(draftRef.current)}
        />
      )}
    </group>
  )
}
