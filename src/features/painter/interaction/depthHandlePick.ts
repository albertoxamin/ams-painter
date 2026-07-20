import * as THREE from 'three'

export interface DepthHandleTarget {
  pocket: THREE.Vector3
  entry: THREE.Vector3
  /** Outer ring radius in world units. */
  ringRadius: number
  axis: 'x' | 'y' | 'z'
}

let active: DepthHandleTarget | null = null
let dragging = false

const _proj = new THREE.Vector3()
const _ringPt = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _bitangent = new THREE.Vector3()

export function setDepthHandleTarget(target: DepthHandleTarget | null): void {
  active = target
}

export function setDepthHandleDragging(value: boolean): void {
  dragging = value
}

export function isDepthHandleDragging(): boolean {
  return dragging
}

function screenDist(
  clientX: number,
  clientY: number,
  world: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLElement,
): number {
  const rect = canvas.getBoundingClientRect()
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1
  _proj.copy(world).project(camera)
  if (_proj.z > 1) return Infinity
  return Math.hypot(nx - _proj.x, ny - _proj.y)
}

/** Screen-space proximity test for pocket disc + entry ring handles. */
export function pointerNearDepthHandle(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  canvas: HTMLElement,
  pocketThresh = 0.1,
  entryThresh = 0.12,
): boolean {
  return (
    pointerNearPocketHandle(clientX, clientY, camera, canvas, pocketThresh) ||
    pointerNearEntryRing(clientX, clientY, camera, canvas, entryThresh)
  )
}

export function pointerNearPocketHandle(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  canvas: HTMLElement,
  pocketThresh = 0.1,
): boolean {
  if (!active) return false
  return (
    screenDist(clientX, clientY, active.pocket, camera, canvas) <= pocketThresh
  )
}

export function pointerNearEntryRing(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  canvas: HTMLElement,
  entryThresh = 0.12,
): boolean {
  if (!active) return false
  const { entry, ringRadius, axis } = active

  if (axis === 'x') {
    _tangent.set(0, 1, 0)
    _bitangent.set(0, 0, 1)
  } else if (axis === 'y') {
    _tangent.set(1, 0, 0)
    _bitangent.set(0, 0, 1)
  } else {
    _tangent.set(1, 0, 0)
    _bitangent.set(0, 1, 0)
  }

  const innerR = ringRadius * 0.55
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    _ringPt
      .copy(entry)
      .addScaledVector(_tangent, Math.cos(a) * ringRadius)
      .addScaledVector(_bitangent, Math.sin(a) * ringRadius)
    if (screenDist(clientX, clientY, _ringPt, camera, canvas) <= entryThresh) {
      return true
    }
    _ringPt
      .copy(entry)
      .addScaledVector(_tangent, Math.cos(a) * innerR)
      .addScaledVector(_bitangent, Math.sin(a) * innerR)
    if (screenDist(clientX, clientY, _ringPt, camera, canvas) <= entryThresh) {
      return true
    }
  }

  return screenDist(clientX, clientY, entry, camera, canvas) <= entryThresh
}
