import { useMemo } from 'react'
import * as THREE from 'three'
import { selectionBoundaryEdges } from '../../../../lib/extrude'
import { COLORS } from '../constants'

/** Renders selected triangles with face fill, edge outline, and vertex points. */
export function SelectionOverlay({
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
