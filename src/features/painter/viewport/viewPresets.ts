import * as THREE from 'three'
import type { SplitLockAxis } from '../../../lib/split'
import type { ViewFace } from '../../../state'

export const VIEW_FACE_PRESETS: Record<
  ViewFace,
  { dir: THREE.Vector3; up: THREE.Vector3; lock: SplitLockAxis }
> = {
  top: {
    dir: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    lock: 'z',
  },
  bottom: {
    dir: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
    lock: 'z',
  },
  front: {
    dir: new THREE.Vector3(0, -1, 0),
    up: new THREE.Vector3(0, 0, 1),
    lock: 'y',
  },
  back: {
    dir: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, 1),
    lock: 'y',
  },
  right: {
    dir: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
    lock: 'x',
  },
  left: {
    dir: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
    lock: 'x',
  },
}

export const ISO_DIR = new THREE.Vector3(1, -1, 0.85).normalize()
