import type { Camera } from 'three'

export type CameraPose = {
  px: number
  py: number
  pz: number
  qx: number
  qy: number
  qz: number
  qw: number
  ux: number
  uy: number
  uz: number
}

const pose: CameraPose = {
  px: 1,
  py: -1,
  pz: 0.8,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  ux: 0,
  uy: 0,
  uz: 1,
}

const listeners = new Set<() => void>()

export function publishCameraPose(camera: Camera) {
  const p = camera.position
  const q = camera.quaternion
  const u = camera.up
  pose.px = p.x
  pose.py = p.y
  pose.pz = p.z
  pose.qx = q.x
  pose.qy = q.y
  pose.qz = q.z
  pose.qw = q.w
  pose.ux = u.x
  pose.uy = u.y
  pose.uz = u.z
  for (const fn of listeners) fn()
}

export function getCameraPose(): CameraPose {
  return pose
}

export function subscribeCameraPose(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
