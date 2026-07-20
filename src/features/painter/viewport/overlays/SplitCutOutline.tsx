import { useMemo } from 'react'
import * as THREE from 'three'
import { splitContourSegments } from '../../../../lib/splitContour'
import { COLORS } from '../constants'

/** Yellow contour where z=H cuts through the mesh surface. */
export function SplitCutOutline({
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
