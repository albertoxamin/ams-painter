import * as THREE from 'three'

export type SplitHandleMode = 'corner' | 'mirrored' | 'broken'

export type SplitOffset = { x: number; y: number; z: number }

/** Cubic Bézier node on the split line (Figma/Photoshop pen). */
export interface SplitPathNode {
  x: number
  y: number
  z: number
  /** Incoming handle offset from the anchor. */
  in?: SplitOffset
  /** Outgoing handle offset from the anchor. */
  out?: SplitOffset
  mode?: SplitHandleMode
}

const HANDLE_EPS2 = 1e-10

export function cloneNode(n: SplitPathNode): SplitPathNode {
  return {
    x: n.x,
    y: n.y,
    z: n.z,
    ...(n.mode ? { mode: n.mode } : {}),
    ...(n.in ? { in: { ...n.in } } : {}),
    ...(n.out ? { out: { ...n.out } } : {}),
  }
}

export function serializeNode(n: SplitPathNode): SplitPathNode {
  const out: SplitPathNode = { x: n.x, y: n.y, z: n.z }
  if (n.mode && n.mode !== 'corner') out.mode = n.mode
  if (n.in && offsetLen2(n.in) > HANDLE_EPS2) out.in = { ...n.in }
  if (n.out && offsetLen2(n.out) > HANDLE_EPS2) out.out = { ...n.out }
  return out
}

export function cornerAt(p: THREE.Vector3): SplitPathNode {
  return { x: p.x, y: p.y, z: p.z, mode: 'corner' }
}

export function nodeAnchor(n: SplitPathNode): THREE.Vector3 {
  return new THREE.Vector3(n.x, n.y, n.z)
}

export function offsetVec(o?: SplitOffset): THREE.Vector3 {
  if (!o) return new THREE.Vector3()
  return new THREE.Vector3(o.x, o.y, o.z)
}

export function offsetLen2(o?: SplitOffset): number {
  if (!o) return 0
  return o.x * o.x + o.y * o.y + o.z * o.z
}

export function hasHandles(n: SplitPathNode): boolean {
  return offsetLen2(n.in) > HANDLE_EPS2 || offsetLen2(n.out) > HANDLE_EPS2
}

export function handleWorld(n: SplitPathNode, which: 'in' | 'out'): THREE.Vector3 {
  return nodeAnchor(n).add(offsetVec(n[which]))
}

function cubic(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return p0
    .clone()
    .multiplyScalar(uu * u)
    .add(p1.clone().multiplyScalar(3 * uu * t))
    .add(p2.clone().multiplyScalar(3 * u * tt))
    .add(p3.clone().multiplyScalar(tt * t))
}

function segmentControls(a: SplitPathNode, b: SplitPathNode) {
  const p0 = nodeAnchor(a)
  const p3 = nodeAnchor(b)
  const p1 = p0.clone().add(offsetVec(a.out))
  const p2 = p3.clone().add(offsetVec(b.in))
  const linear = offsetLen2(a.out) <= HANDLE_EPS2 && offsetLen2(b.in) <= HANDLE_EPS2
  return { p0, p1, p2, p3, linear }
}

export function sampleSplitPath(
  nodes: SplitPathNode[],
  samplesPerSeg = 16,
): THREE.Vector3[] {
  if (nodes.length === 0) return []
  if (nodes.length === 1) return [nodeAnchor(nodes[0]!)]
  const out: THREE.Vector3[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const { p0, p1, p2, p3, linear } = segmentControls(nodes[i]!, nodes[i + 1]!)
    const n = linear ? 1 : samplesPerSeg
    for (let s = 0; s < n; s++) {
      const t = s / n
      out.push(linear ? p0.clone().lerp(p3, t) : cubic(p0, p1, p2, p3, t))
    }
  }
  out.push(nodeAnchor(nodes[nodes.length - 1]!))
  return out
}

export function moveAnchor(n: SplitPathNode, p: THREE.Vector3): SplitPathNode {
  const next = cloneNode(n)
  next.x = p.x
  next.y = p.y
  next.z = p.z
  return next
}

export function setMirroredOut(
  n: SplitPathNode,
  outWorld: THREE.Vector3,
): SplitPathNode {
  const a = nodeAnchor(n)
  const out = outWorld.clone().sub(a)
  return {
    x: n.x,
    y: n.y,
    z: n.z,
    mode: 'mirrored',
    out: { x: out.x, y: out.y, z: out.z },
    in: { x: -out.x, y: -out.y, z: -out.z },
  }
}

export function setHandle(
  n: SplitPathNode,
  which: 'in' | 'out',
  world: THREE.Vector3,
  breakPair: boolean,
): SplitPathNode {
  const a = nodeAnchor(n)
  const off = world.clone().sub(a)
  const keepMirror =
    !breakPair && n.mode !== 'broken'
  const next = cloneNode(n)
  next[which] = { x: off.x, y: off.y, z: off.z }
  if (keepMirror) {
    const opp = which === 'out' ? 'in' : 'out'
    next[opp] = { x: -off.x, y: -off.y, z: -off.z }
    next.mode = 'mirrored'
  } else {
    next.mode = 'broken'
  }
  if (offsetLen2(next.in) <= HANDLE_EPS2 && offsetLen2(next.out) <= HANDLE_EPS2) {
    return { x: next.x, y: next.y, z: next.z, mode: 'corner' }
  }
  return next
}

export function makeCorner(n: SplitPathNode): SplitPathNode {
  return { x: n.x, y: n.y, z: n.z, mode: 'corner' }
}

export function makeMirrored(
  n: SplitPathNode,
  prev?: SplitPathNode,
  next?: SplitPathNode,
): SplitPathNode {
  const a = nodeAnchor(n)
  const dir = new THREE.Vector3()
  let span = 4
  if (prev && next) {
    dir.subVectors(nodeAnchor(next), nodeAnchor(prev))
    span = nodeAnchor(next).distanceTo(nodeAnchor(prev))
  } else if (next) {
    dir.subVectors(nodeAnchor(next), a)
    span = dir.length()
  } else if (prev) {
    dir.subVectors(a, nodeAnchor(prev))
    span = dir.length()
  }
  if (dir.lengthSq() < HANDLE_EPS2) dir.set(1, 0, 0)
  dir.normalize().multiplyScalar(Math.max(span * 0.25, 1))
  return {
    x: n.x,
    y: n.y,
    z: n.z,
    mode: 'mirrored',
    out: { x: dir.x, y: dir.y, z: dir.z },
    in: { x: -dir.x, y: -dir.y, z: -dir.z },
  }
}

function lerpV(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  return a.clone().lerp(b, t)
}

/** Insert a node on segment `seg` at parameter `t` (de Casteljau). */
export function insertNodeAt(
  nodes: SplitPathNode[],
  seg: number,
  t: number,
): SplitPathNode[] {
  if (seg < 0 || seg >= nodes.length - 1) return nodes.map(cloneNode)
  const tt = THREE.MathUtils.clamp(t, 1e-3, 1 - 1e-3)
  const a = cloneNode(nodes[seg]!)
  const b = cloneNode(nodes[seg + 1]!)
  const { p0, p1, p2, p3 } = segmentControls(a, b)
  const p01 = lerpV(p0, p1, tt)
  const p12 = lerpV(p1, p2, tt)
  const p23 = lerpV(p2, p3, tt)
  const p012 = lerpV(p01, p12, tt)
  const p123 = lerpV(p12, p23, tt)
  const p0123 = lerpV(p012, p123, tt)

  const aOut = p01.clone().sub(p0)
  const midIn = p012.clone().sub(p0123)
  const midOut = p123.clone().sub(p0123)
  const bIn = p23.clone().sub(p3)

  a.out = { x: aOut.x, y: aOut.y, z: aOut.z }
  if (a.mode === 'corner' && offsetLen2(a.out) > HANDLE_EPS2) a.mode = 'broken'
  b.in = { x: bIn.x, y: bIn.y, z: bIn.z }
  if (b.mode === 'corner' && offsetLen2(b.in) > HANDLE_EPS2) b.mode = 'broken'

  const mid: SplitPathNode = {
    x: p0123.x,
    y: p0123.y,
    z: p0123.z,
    mode: 'broken',
    in: { x: midIn.x, y: midIn.y, z: midIn.z },
    out: { x: midOut.x, y: midOut.y, z: midOut.z },
  }

  const next = nodes.map(cloneNode)
  next[seg] = a
  next[seg + 1] = b
  next.splice(seg + 1, 0, mid)
  return next
}

export function closestOnPath(
  nodes: SplitPathNode[],
  p: THREE.Vector3,
  samplesPerSeg = 24,
): { seg: number; t: number; dist: number; point: THREE.Vector3 } | null {
  if (nodes.length < 2) return null
  let best: { seg: number; t: number; dist: number; point: THREE.Vector3 } | null =
    null
  for (let i = 0; i < nodes.length - 1; i++) {
    const { p0, p1, p2, p3, linear } = segmentControls(nodes[i]!, nodes[i + 1]!)
    const n = linear ? 8 : samplesPerSeg
    for (let s = 0; s <= n; s++) {
      const t = s / n
      const q = linear ? p0.clone().lerp(p3, t) : cubic(p0, p1, p2, p3, t)
      const dist = q.distanceTo(p)
      if (!best || dist < best.dist) best = { seg: i, t, dist, point: q }
    }
  }
  return best
}

function parseOffset(raw: unknown): SplitOffset | undefined {
  if (!raw) return undefined
  if (Array.isArray(raw) && raw.length >= 3) {
    const x = Number(raw[0])
    const y = Number(raw[1])
    const z = Number(raw[2])
    if ([x, y, z].every(Number.isFinite)) return { x, y, z }
    return undefined
  }
  if (typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  const z = Number(o.z)
  if (![x, y, z].every(Number.isFinite)) return undefined
  return { x, y, z }
}

export function parseSplitPathNode(raw: unknown): SplitPathNode | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  const z = Number(o.z)
  if (![x, y, z].every(Number.isFinite)) return null
  const mode =
    o.mode === 'mirrored' || o.mode === 'broken' || o.mode === 'corner'
      ? o.mode
      : undefined
  const inn = parseOffset(o.in)
  const out = parseOffset(o.out)
  return {
    x,
    y,
    z,
    ...(mode ? { mode } : {}),
    ...(inn ? { in: inn } : {}),
    ...(out ? { out } : {}),
  }
}
