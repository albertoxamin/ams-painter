import * as THREE from 'three'
import { axisLetter, type CutAxis } from './extrude'

export interface AxisSpan {
  min: number
  max: number
  mean: number
}

export interface ResolvedInsertFloors {
  insertFloor: number
  cutterFloor: number
  entryFloor: number
  axis: CutAxis
}

/**
 * Shared floor resolution for face selections and pen loops.
 * Span is min/max/mean of vertices along the cut axis.
 */
export function resolveSpanInsertFloors(
  geom: THREE.BufferGeometry,
  span: AxisSpan,
  axis: CutAxis,
  userFloor: number,
  pad = 0.75,
  userEntry?: number,
): ResolvedInsertFloors {
  const letter = axisLetter(axis)
  let sign = axis[0] === '-' ? -1 : 1
  geom.computeBoundingBox()
  const b = geom.boundingBox!
  const bMin = letter === 'x' ? b.min.x : letter === 'y' ? b.min.y : b.min.z
  const bMax = letter === 'x' ? b.max.x : letter === 'y' ? b.max.y : b.max.z

  const outwardFar = sign < 0 ? bMin - pad : bMax + pad
  const inwardFar = sign < 0 ? bMax + pad : bMin - pad
  const outwardDepth = Math.abs(span.mean - outwardFar)
  const inwardDepth = Math.abs(span.mean - inwardFar)
  if (outwardDepth < 2.5 || outwardDepth < inwardDepth * 0.3) {
    sign = -sign
  }
  const far = sign < 0 ? bMin - pad : bMax + pad
  const entryDefault = sign < 0 ? span.max + pad : span.min - pad
  const entryFar = sign < 0 ? bMax + pad : bMin - pad
  let entryFloor = userEntry ?? entryDefault
  if (sign < 0) {
    const lo = span.max + 1e-3
    const hi = entryFar
    if (hi > lo) entryFloor = Math.min(hi, Math.max(lo, entryFloor))
    else entryFloor = entryDefault
  } else {
    const lo = entryFar
    const hi = span.min - 1e-3
    if (hi > lo) entryFloor = Math.min(hi, Math.max(lo, entryFloor))
    else entryFloor = entryDefault
  }

  const aligned: CutAxis = `${sign < 0 ? '-' : '+'}${letter}` as CutAxis

  let insertFloor = userFloor
  if (sign < 0) {
    const lo = far + pad
    const hi = span.min - 1e-3
    if (hi > lo) insertFloor = Math.min(hi, Math.max(lo, userFloor))
    else insertFloor = (span.mean + far) / 2
  } else {
    const lo = span.max + 1e-3
    const hi = far - pad
    if (hi > lo) insertFloor = Math.min(hi, Math.max(lo, userFloor))
    else insertFloor = (span.mean + far) / 2
  }

  const seat = 0.2
  let cutterFloor = insertFloor + sign * seat
  if (sign < 0) cutterFloor = Math.max(far + pad * 0.25, cutterFloor)
  else cutterFloor = Math.min(far - pad * 0.25, cutterFloor)

  return { insertFloor, cutterFloor, entryFloor, axis: aligned }
}
