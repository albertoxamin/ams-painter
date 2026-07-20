import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import {
  axisLetter,
  resolveInsertFloors,
  selectionBoundaryEdges,
  type CutAxis,
} from '../../../../lib/extrude'

export function InsertEspOutline({
  geom,
  selection,
  axis,
  floor,
  entry,
  color,
}: {
  geom: THREE.BufferGeometry
  selection: Set<number>
  axis: CutAxis
  floor: number
  entry?: number
  color: string
}) {
  const edgeGeom = useMemo(() => {
    if (selection.size === 0) return null
    const resolved = resolveInsertFloors(
      geom,
      selection,
      axis,
      floor,
      0.75,
      entry,
    )
    const letter = axisLetter(resolved.axis)
    const f = resolved.insertFloor
    const entryPlane = resolved.entryFloor
    const boundary = selectionBoundaryEdges(geom, selection)
    if (boundary.length < 2) return null

    const pos: number[] = []
    const project = (v: THREE.Vector3, plane: number): THREE.Vector3 => {
      if (letter === 'x') return new THREE.Vector3(plane, v.y, v.z)
      if (letter === 'y') return new THREE.Vector3(v.x, plane, v.z)
      return new THREE.Vector3(v.x, v.y, plane)
    }

    for (let i = 0; i + 1 < boundary.length; i += 2) {
      const u = boundary[i]!
      const v = boundary[i + 1]!
      const pu = project(u, f)
      const pv = project(v, f)
      const eu = project(u, entryPlane)
      const ev = project(v, entryPlane)
      // surface boundary
      pos.push(u.x, u.y, u.z, v.x, v.y, v.z)
      // insert floor boundary
      pos.push(pu.x, pu.y, pu.z, pv.x, pv.y, pv.z)
      // entry safety boundary (opposite direction)
      pos.push(eu.x, eu.y, eu.z, ev.x, ev.y, ev.z)
      // side posts: entry → surface → floor
      pos.push(eu.x, eu.y, eu.z, u.x, u.y, u.z)
      pos.push(ev.x, ev.y, ev.z, v.x, v.y, v.z)
      pos.push(u.x, u.y, u.z, pu.x, pu.y, pu.z)
      pos.push(v.x, v.y, v.z, pv.x, pv.y, pv.z)
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [geom, selection, axis, floor, entry])

  useEffect(() => {
    return () => {
      edgeGeom?.dispose()
    }
  }, [edgeGeom])

  if (!edgeGeom) return null

  return (
    <lineSegments geometry={edgeGeom} raycast={() => {}} renderOrder={20}>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        transparent
        opacity={0.9}
      />
    </lineSegments>
  )
}
