import { useMemo, useState } from 'react'
import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../../state'
import { draftLocalGeometry } from '../../../lib/meshEdit'

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
  const { controls } = useThree()
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
          object={group}
          mode="translate"
          size={0.75}
          onObjectChange={() => {
            const p = group.position
            setBooleanPosition(p.x, p.y, p.z)
          }}
          onMouseDown={() => setOrbitEnabled(controls, false)}
          onMouseUp={() => setOrbitEnabled(controls, true)}
        />
      )}
    </>
  )
}
