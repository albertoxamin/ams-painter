import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { penCutoutCentroid } from '../../../../lib/penCutout'
import { COLORS } from '../constants'
import { lightenHex } from '../pick'

export function PenLoopOverlay({
  loop,
  cursor,
  color,
  closed,
}: {
  loop: THREE.Vector3[]
  cursor?: THREE.Vector3 | null
  color: string
  closed: boolean
}) {
  const geom = useMemo(() => {
    const pts = [...loop]
    if (!closed && cursor) pts.push(cursor)
    if (pts.length === 0) return null

    const linePos: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      linePos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    if (closed && pts.length >= 3) {
      const a = pts[pts.length - 1]!
      const b = pts[0]!
      linePos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }

    const lineGeom =
      linePos.length >= 6
        ? (() => {
            const g = new THREE.BufferGeometry()
            g.setAttribute(
              'position',
              new THREE.Float32BufferAttribute(linePos, 3),
            )
            return g
          })()
        : null

    const pointPos = pts.flatMap((p) => [p.x, p.y, p.z])
    const pointsGeom = new THREE.BufferGeometry()
    pointsGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(pointPos, 3),
    )

    let fillGeom: THREE.BufferGeometry | null = null
    if (closed && loop.length >= 3) {
      const c = penCutoutCentroid(loop)
      const verts: number[] = []
      const tris: number[] = []
      verts.push(c.x, c.y, c.z)
      for (const p of loop) verts.push(p.x, p.y, p.z)
      for (let i = 0; i < loop.length; i++) {
        tris.push(0, i + 1, ((i + 1) % loop.length) + 1)
      }
      fillGeom = new THREE.BufferGeometry()
      fillGeom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(verts, 3),
      )
      fillGeom.setIndex(tris)
    }

    return { lineGeom, fillGeom, pointsGeom }
  }, [loop, cursor, closed])

  useEffect(() => {
    return () => {
      geom?.lineGeom?.dispose()
      geom?.fillGeom?.dispose()
      geom?.pointsGeom?.dispose()
    }
  }, [geom])

  if (!geom) return null

  const lineColor = lightenHex(color, 0.2)

  return (
    <group raycast={() => {}} renderOrder={25}>
      {geom.fillGeom && (
        <mesh geometry={geom.fillGeom}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.4}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {geom.lineGeom && (
        <lineSegments geometry={geom.lineGeom}>
          <lineBasicMaterial
            color={lineColor}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </lineSegments>
      )}
      <points geometry={geom.pointsGeom}>
        <pointsMaterial
          color={COLORS.vertex}
          size={10}
          sizeAttenuation={false}
          depthTest={false}
          transparent
          opacity={1}
        />
      </points>
    </group>
  )
}
