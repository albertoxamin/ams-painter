import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { MeshCheckResult } from './meshAnalysis'

const FORMWARE_ORIGIN = 'https://fixer.formware.co'
const MAX_STL_BYTES = 50 * 1024 * 1024
const MAX_WAIT_MS = 4.5 * 60 * 1000
const QUEUE_POLL_MS = 5000
const WORK_POLL_MS = 1000

export type FormwareStatus = {
  Id: string
  Status: number
  StatusMessage: string | null
  ExceptionDetail?: string
  IsValidMesh: boolean
  TimeFix: number
  Progress: number
  Analyzed: boolean
  Fixed: boolean
  QueueCount: number
  Analysis: FormwareAnalysis
  Fix: FormwareFixCounts
}

export type FormwareAnalysis = {
  FaceCount: number
  VerticesCount: number
  NakedEdges: number
  PlanarHoles: number
  NonPlanarHoles: number
  NonManifoldEdges: number
  InvertedNormals: number
  DuplicateFaces: number
  DegenerateFaces: number
  DisjointShells: number
}

export type FormwareFixCounts = {
  FaceCount_Fixed: number
  VerticesCount_Fixed: number
}

export type FormwareRepairProgress = {
  stage: 'uploading' | 'queued' | 'analyzing' | 'repairing' | 'downloading'
  message: string
  pct: number
  queueCount?: number
  analysis?: FormwareAnalysis
  job?: FormwareStatus
}

function isBrowserLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/** Same-origin Vite proxy in local/preview; direct host from Node (no CORS). */
export function formwareBaseUrl(): string {
  const override = import.meta.env.VITE_FORMWARE_BASE as string | undefined
  if (override) return override.replace(/\/$/, '')
  if (isBrowserLocalhost()) return '/formware-fixer'
  return FORMWARE_ORIGIN
}

export function formwareAnalysisToChecks(a: FormwareAnalysis): MeshCheckResult {
  return {
    nakedEdges: a.NakedEdges,
    planarHoles: a.PlanarHoles,
    nonPlanarHoles: a.NonPlanarHoles,
    nonManifoldEdges: a.NonManifoldEdges,
    invertedNormals: a.InvertedNormals,
    duplicateFaces: a.DuplicateFaces,
    degenerateFaces: a.DegenerateFaces,
    disjointShells: a.DisjointShells,
  }
}

function toBinaryStlBytes(root: THREE.Object3D): Uint8Array {
  const exporter = new STLExporter()
  const parsed: unknown = exporter.parse(root, { binary: true })
  if (parsed instanceof DataView) {
    return new Uint8Array(parsed.buffer, parsed.byteOffset, parsed.byteLength)
  }
  if (parsed instanceof ArrayBuffer) {
    return new Uint8Array(parsed)
  }
  if (ArrayBuffer.isView(parsed)) {
    return new Uint8Array(parsed.buffer, parsed.byteOffset, parsed.byteLength)
  }
  return new TextEncoder().encode(String(parsed))
}

export function geometryToRawStlBytes(geom: THREE.BufferGeometry): Uint8Array {
  return toBinaryStlBytes(new THREE.Mesh(geom))
}

export function parseStlGeometry(buffer: ArrayBuffer): THREE.BufferGeometry {
  const geom = new STLLoader().parse(buffer)
  if (!geom.getAttribute('position')) {
    throw new Error('Repaired STL has no geometry data')
  }
  const out = geom.index ? geom.toNonIndexed() : geom
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Formware request failed (${res.status}): ${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Formware returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
}

function failMessage(job: FormwareStatus): string {
  return (
    job.StatusMessage ||
    job.ExceptionDetail ||
    'Formware could not repair this file'
  )
}

export async function repairStlWithFormware(
  stlBytes: Uint8Array,
  filename: string,
  onProgress?: (p: FormwareRepairProgress) => void,
): Promise<{ buffer: ArrayBuffer; job: FormwareStatus }> {
  if (stlBytes.byteLength > MAX_STL_BYTES) {
    throw new Error('STL is larger than Formware’s 50 MB limit. Reduce the mesh first.')
  }

  const base = formwareBaseUrl()
  const name = filename.toLowerCase().endsWith('.stl') ? filename : `${filename}.stl`

  onProgress?.({
    stage: 'uploading',
    message: 'Uploading STL to Formware…',
    pct: 5,
  })

  const body = new FormData()
  const copy = stlBytes.slice()
  body.append(
    'Filedata',
    new Blob([copy], { type: 'application/octet-stream' }),
    name,
  )

  let uploaded: FormwareStatus
  try {
    const res = await fetch(`${base}/Home/UploadStl`, {
      method: 'POST',
      body,
      credentials: 'omit',
    })
    uploaded = await readJson<FormwareStatus>(res)
  } catch (e) {
    const msg = (e as Error).message || String(e)
    if (/failed to fetch|networkerror|cors/i.test(msg)) {
      throw new Error(
        'Could not reach Formware (CORS or network). Run the app with `npm run dev` so Vite can proxy fixer.formware.co.',
      )
    }
    throw e
  }

  if (uploaded.Status >= 8 || !uploaded.Id) {
    throw new Error(failMessage(uploaded))
  }

  const jobId = uploaded.Id
  const started = Date.now()
  let job = uploaded

  while (job.Status < 7) {
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error('Formware repair timed out (4 minute limit).')
    }
    const queued = job.Status === 0
    if (queued) {
      onProgress?.({
        stage: 'queued',
        message: `In Formware queue (${job.QueueCount} ahead)…`,
        pct: 12,
        queueCount: job.QueueCount,
        analysis: job.Analyzed ? job.Analysis : undefined,
        job,
      })
    } else if (job.Status < 5) {
      onProgress?.({
        stage: 'analyzing',
        message: 'Formware analyzing file…',
        pct: 20 + job.Status * 5,
        analysis: job.Analyzed ? job.Analysis : undefined,
        job,
      })
    } else {
      const progress = Number.isFinite(job.Progress) ? job.Progress : 0
      onProgress?.({
        stage: 'repairing',
        message: `Formware repairing: ${(progress * 100).toFixed(0)}%`,
        pct: 40 + Math.min(50, progress * 50),
        analysis: job.Analyzed ? job.Analysis : undefined,
        job,
      })
    }

    await new Promise((r) => setTimeout(r, queued ? QUEUE_POLL_MS : WORK_POLL_MS))
    const check = await fetch(`${base}/Home/CheckV2?JobId=${encodeURIComponent(jobId)}`, {
      credentials: 'omit',
    })
    job = await readJson<FormwareStatus>(check)
    if (job.Status >= 8) throw new Error(failMessage(job))
  }

  onProgress?.({
    stage: 'downloading',
    message: 'Downloading repaired STL…',
    pct: 95,
    analysis: job.Analyzed ? job.Analysis : undefined,
    job,
  })

  const dl = await fetch(
    `${base}/home/downloadstl/?JobId=${encodeURIComponent(jobId)}`,
    { credentials: 'omit' },
  )
  if (!dl.ok) {
    throw new Error(`Formware download failed (${dl.status})`)
  }
  const buffer = await dl.arrayBuffer()
  if (buffer.byteLength < 84) {
    throw new Error(
      job.Fixed
        ? 'Formware reported a repair but returned an empty STL.'
        : failMessage(job),
    )
  }

  return { buffer, job }
}

export async function repairGeometryWithFormware(
  geom: THREE.BufferGeometry,
  filename: string,
  onProgress?: (p: FormwareRepairProgress) => void,
): Promise<{ geometry: THREE.BufferGeometry; job: FormwareStatus }> {
  const stlBytes = geometryToRawStlBytes(geom)
  const { buffer, job } = await repairStlWithFormware(stlBytes, filename, onProgress)
  return { geometry: parseStlGeometry(buffer), job }
}
