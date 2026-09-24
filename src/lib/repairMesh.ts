import * as THREE from 'three'
import { analyzeMesh, type MeshAnalysis } from './meshAnalysis'
import { loadGLBGeometry } from './loadGLB'
import { repairGeometryWithFormware } from './formwareRepair'

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
 * Full pipeline: load GLB → convert to STL → Formware online repair → re-analyze.
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

  report('repairing', 'Uploading to Formware…', { repairPct: 0, beforeChecks: before.checks })
  const stlName = name.replace(/\.[^.]+$/i, '') + '.stl'
  const { geometry: repairedGeometry, job } = await repairGeometryWithFormware(
    rawGeometry,
    stlName,
    (p) =>
      onProgress?.({
        stage: 'repairing',
        message: p.message,
        repairPct: p.pct,
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

  const vertexCountBefore =
    job.Analysis?.VerticesCount || beforeGeom.getAttribute('position').count
  const vertexCountAfter =
    job.Fix?.VerticesCount_Fixed || repairedGeometry.getAttribute('position').count
  const triangleCountBefore = job.Analysis?.FaceCount || before.triangleCount
  const triangleCountAfter = job.Fix?.FaceCount_Fixed || after.triangleCount

  const repaired = job.Fixed || after.ok
  report('done', repaired ? 'File repaired' : 'Repair incomplete')

  return {
    rawGeometry: beforeGeom,
    repairedGeometry,
    before,
    after,
    sourceName: name,
    repaired,
    repairWarning: repaired
      ? undefined
      : 'Formware ran but some issues may remain.',
    vertexCountBefore,
    vertexCountAfter,
    triangleCountBefore,
    triangleCountAfter,
  }
}
