import * as THREE from 'three'
import { Brush, Evaluator, HOLLOW_SUBTRACTION } from 'three-bvh-csg'
import { materializeDrawRange } from './manifoldOps'

const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal']

function asBrush(geom: THREE.BufferGeometry): Brush {
  const g = geom.clone()
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const brush = new Brush(g, new THREE.MeshBasicMaterial())
  brush.updateMatrixWorld()
  return brush
}

/**
 * Subtract cutter from target without filling holes.
 * A can be an open shell (windows); B should be a solid (the bottom).
 * This is Tinkercad "hole" on a surface body, not a solid CAD difference.
 */
export function hollowSubtract(
  target: THREE.BufferGeometry,
  cutter: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const a = asBrush(target)
  const b = asBrush(cutter)
  const out = evaluator.evaluate(a, b, HOLLOW_SUBTRACTION)
  return materializeDrawRange(out.geometry)
}
