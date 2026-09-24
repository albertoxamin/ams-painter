import { useEffect, useMemo, useRef, useState } from 'react'
import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import { useStore } from '../../../state'
import { draftLocalGeometry } from '../../../lib/meshEdit'

let cutterDragging = false

/** True from pointer-down on the cutter arrows until pointer-up. */
export function isCutterGizmoDragging(): boolean {
  return cutterDragging
}

function setCutterGizmoDragging(v: boolean) {
  cutterDragging = v
}

function setOrbitEnabled(controls: unknown, enabled: boolean) {
  if (controls && typeof controls === 'object' && 'enabled' in controls) {
    ;(controls as { enabled: boolean }).enabled = enabled
  }
}

/** Transparent cutter. Drag the arrows, then Apply in the side panel. */
export function BooleanCutterGhost() {
  const draft = useStore((s) => s.booleanDraft)
  const preview = useStore((s) => s.preview)
  const setBooleanPosition = useStore((s) => s.setBooleanPosition)
  const [group, setGroup] = useState<THREE.Group | null>(null)
  const tcRef = useRef<TransformControlsImpl>(null)
  const { controls, gl } = useThree()

  useEffect(() => {
    const el = gl.domElement
    const ndc = new THREE.Vector2()
    const down = (e: PointerEvent) => {
      const tc = tcRef.current as unknown as {
        axis: string | null
        pointerHover: (p: { x: number; y: number; button: number }) => void
      } | null
      if (!tc || e.button !== 0) return
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      tc.pointerHover({ x: ndc.x, y: ndc.y, button: e.button })
      if (tc.axis != null) setCutterGizmoDragging(true)
    }
    const up = () => setCutterGizmoDragging(false)
    el.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      setCutterGizmoDragging(false)
    }
  }, [gl])
  const kind = draft?.kind
  const size = draft?.size
  const stl = draft?.stl ?? null

  const geom = useMemo(() => {
    if (!kind || size == null) return null
    return draftLocalGeometry({
      op: 'subtract',
      kind,
      size,
      position: [0, 0, 0],
      stl,
    })
  }, [kind, size, stl])

  const edges = useMemo(() => (geom ? new THREE.EdgesGeometry(geom) : null), [geom])

  if (!draft || !geom || !edges || preview) return null

  return (
    <>
      <group ref={setGroup} position={draft.position}>
        <mesh geometry={geom} renderOrder={2}>
          <meshBasicMaterial
            color="#b4b8c0"
            transparent
            opacity={0.35}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <lineSegments geometry={edges} renderOrder={3}>
          <lineBasicMaterial color="#e6e8ee" transparent opacity={0.9} />
        </lineSegments>
      </group>
      {group && (
        <TransformControls
          ref={tcRef}
          object={group}
          mode="translate"
          size={0.75}
          onObjectChange={() => {
            const p = group.position
            setBooleanPosition(p.x, p.y, p.z)
          }}
          onMouseDown={() => {
            setCutterGizmoDragging(true)
            setOrbitEnabled(controls, false)
          }}
          onMouseUp={() => {
            setCutterGizmoDragging(false)
            setOrbitEnabled(controls, true)
          }}
        />
      )}
    </>
  )
}
