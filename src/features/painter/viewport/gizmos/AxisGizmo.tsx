import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AXIS_COLORS, type CutAxis } from '../../../../lib/extrude'

/** Six clickable axis arrows for setting an island's cut direction. */
export function AxisGizmo({
  center,
  size,
  activeAxis,
  onPick,
}: {
  center: THREE.Vector3
  size: number
  activeAxis: CutAxis
  onPick: (axis: CutAxis) => void
}) {
  const { camera, gl } = useThree()
  const centerRef = useRef(center)
  centerRef.current = center
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const axes: { id: CutAxis; dir: THREE.Vector3; letter: 'x' | 'y' | 'z' }[] = [
    { id: '+x', dir: new THREE.Vector3(1, 0, 0), letter: 'x' },
    { id: '-x', dir: new THREE.Vector3(-1, 0, 0), letter: 'x' },
    { id: '+y', dir: new THREE.Vector3(0, 1, 0), letter: 'y' },
    { id: '-y', dir: new THREE.Vector3(0, -1, 0), letter: 'y' },
    { id: '+z', dir: new THREE.Vector3(0, 0, 1), letter: 'z' },
    { id: '-z', dir: new THREE.Vector3(0, 0, -1), letter: 'z' },
  ]

  const shaftLen = size * 0.72
  const coneLen = size * 0.28
  const shaftR = size * 0.04
  const coneR = size * 0.1

  // Screen-space picking — arrows sit inside the mesh so mesh raycasts win otherwise
  useEffect(() => {
    const el = gl.domElement
    const ndcThresh = 0.045
    const _tip = new THREE.Vector3()
    const _mid = new THREE.Vector3()
    const _proj = new THREE.Vector3()

    const screenDist = (clientX: number, clientY: number, world: THREE.Vector3) => {
      const rect = el.getBoundingClientRect()
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1
      _proj.copy(world).project(camera)
      if (_proj.z > 1) return Infinity
      return Math.hypot(nx - _proj.x, ny - _proj.y)
    }

    const pickAxis = (clientX: number, clientY: number): CutAxis | null => {
      const c = centerRef.current
      let best: { id: CutAxis; d: number } | null = null
      for (const { id, dir } of axes) {
        _tip.copy(c).addScaledVector(dir, shaftLen + coneLen)
        _mid.copy(c).addScaledVector(dir, shaftLen * 0.45)
        const d = Math.min(
          screenDist(clientX, clientY, _tip),
          screenDist(clientX, clientY, _mid),
          screenDist(clientX, clientY, c),
        )
        if (d <= ndcThresh && (!best || d < best.d)) best = { id, d }
      }
      return best?.id ?? null
    }

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      const axis = pickAxis(ev.clientX, ev.clientY)
      if (!axis) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      onPickRef.current(axis)
    }

    const onMove = (ev: PointerEvent) => {
      const over = pickAxis(ev.clientX, ev.clientY) !== null
      document.body.style.cursor = over ? 'pointer' : ''
    }

    const onUp = () => {
      document.body.style.cursor = ''
    }

    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
    }
    // axes dirs are stable module-level constants per instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, size, shaftLen, coneLen])

  return (
    <group position={center} renderOrder={30}>
      <mesh raycast={() => {}}>
        <sphereGeometry args={[size * 0.06, 12, 12]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
      {axes.map(({ id, dir, letter }) => {
        const active = activeAxis === id
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        )
        const mid = dir.clone().multiplyScalar(shaftLen / 2)
        const tip = dir.clone().multiplyScalar(shaftLen + coneLen / 2)
        const color = AXIS_COLORS[letter]
        return (
          <group key={id}>
            <mesh
              position={mid}
              quaternion={quat}
              raycast={() => {}}
            >
              <cylinderGeometry
                args={[shaftR * (active ? 1.4 : 1.1), shaftR * (active ? 1.4 : 1.1), shaftLen, 8]}
              />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 1 : 0.55}
                depthTest={false}
              />
            </mesh>
            <mesh position={tip} quaternion={quat} raycast={() => {}}>
              <coneGeometry args={[coneR * (active ? 1.25 : 1), coneLen, 10]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 1 : 0.75}
                depthTest={false}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
