import * as THREE from 'three'
import { analyzeMesh, type MeshAnalysis } from './meshAnalysis'
import { loadGLBGeometry } from './loadGLB'
import { repairMesh } from './stlRepair'

export type RepairStage =
  | 'idle'
  | 'loading'
  | 'analyzing'
  | 'converting'
  | 'repairing'
  | 'done'
  | 'error'

export interface RepairProgress {
  stage: RepairStage
  message: string
  repairPct?: number
  beforeChecks?: import('./meshAnalysis').MeshCheckResult
  afterChecks?: import('./meshAnalysis').MeshCheckResult
}

export interface RepairResult {
  rawGeometry: THREE.BufferGeometry
  repairedGeometry: THREE.BufferGeometry
  before: MeshAnalysis
  after: MeshAnalysis
  sourceName: string
  repaired: boolean
  repairWarning?: string
  vertexCountBefore: number
  vertexCountAfter: number
  triangleCountBefore: number
  triangleCountAfter: number
}

/**
 * Full pipeline: load GLB → convert to mesh → analyze → repair → re-analyze.
 */
export async function repairGLB(
  buffer: ArrayBuffer,
  name: string,
  onProgress?: (p: RepairProgress) => void,
): Promise<RepairResult> {
  const report = (stage: RepairStage, message: string, extra?: Partial<RepairProgress>) =>
    onProgress?.({ stage, message, ...extra })

  report('loading', 'Loading GLB…')
  const rawGeometry = await loadGLBGeometry(buffer)

  report('converting', 'Converting to STL mesh…')
  const beforeGeom = rawGeometry.clone()

  report('analyzing', 'Analyzing file…')
  const before = analyzeMesh(beforeGeom)
  onProgress?.({ stage: 'analyzing', message: 'Analyzing file…', beforeChecks: before.checks })

  report('repairing', 'Repairing mesh…', { repairPct: 0 })
  const { geometry: repairedGeometry, manifold } = await repairMesh(
    rawGeometry,
    (pct) =>
      onProgress?.({
        stage: 'repairing',
        message: `Repairing: ${pct.toFixed(0)}%`,
        repairPct: pct,
        beforeChecks: before.checks,
      }),
  )

  report('analyzing', 'Re-analyzing repaired mesh…')
  const after = analyzeMesh(repairedGeometry)
  onProgress?.({
    stage: 'analyzing',
    message: 'Re-analyzing repaired mesh…',
    beforeChecks: before.checks,
    afterChecks: after.checks,
  })

  const vertexCountBefore = beforeGeom.getAttribute('position').count
  const vertexCountAfter = repairedGeometry.getAttribute('position').count
  const triangleCountBefore = before.triangleCount
  const triangleCountAfter = after.triangleCount

  report('done', manifold ? 'File repaired' : 'Repair incomplete')

  return {
    rawGeometry: beforeGeom,
    repairedGeometry,
    before,
    after,
    sourceName: name,
    repaired: manifold || after.ok,
    repairWarning: manifold
      ? undefined
      : after.ok
        ? undefined
        : 'Mesh improved but some issues may remain.',
    vertexCountBefore,
    vertexCountAfter,
    triangleCountBefore,
    triangleCountAfter,
  }
}
