/**
 * Client for Meshy's *internal* web API (`/meshyd-api/web/...`), authenticated
 * with the bearer JWT from a logged-in meshy.ai session (NOT the public
 * `api.meshy.ai` API key).
 *
 * ⚠ Reverse-engineered from the meshy.ai web app's bundled JS. The task
 * creation payloads mirror what the workspace sends, but Meshy can change
 * these at any time. Every request/response is surfaced via the `onLog`
 * callback so failures are easy to diagnose and patch.
 *
 * CORS: meshy.ai does not allow cross-origin browser requests from this
 * app's origin, so all calls go through a Vite dev proxy:
 *   /meshy-api  → https://www.meshy.ai   (no path rewrite)
 *   /meshy-cdn  → https://cdn.meshy.ai   (no path rewrite)
 * The proxy is configured in `vite.config.ts` and only works under
 * `npm run dev` / `npm run preview`. On the static GitHub Pages deploy the
 * proxy is unavailable — run the tab locally.
 */

export type MeshyLog = (entry: string) => void

export interface MeshyAuth {
  /** Supabase session JWT copied from a logged-in meshy.ai request. */
  token: string
  /** Optional; a stable device id is generated and persisted if omitted. */
  deviceId?: string
}

export type MeshyAiModel =
  | 'meshy-5.1'
  | 'meshy-5.3'
  | 'meshy-6-lite'
  | 'meshy-7'
  | 'latest'
  | (string & {})

export interface UploadedImage {
  id: string
  url: string
  name: string
  noBgId?: string
  noBgUrl?: string
}

export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'

export interface MeshyTaskResult {
  draft?: { frames?: { url?: string }[] }
  generate?: { modelUrl?: string; quadJsonUrl?: string }
  texture?: { modelUrl?: string }
  stylize?: { modelUrl?: string }
  autoUv?: { modelUrl?: string }
  partSegmentation?: { modelUrl?: string }
}

export interface MeshyTask {
  id: string
  status: TaskStatus
  phase: string
  mode?: string
  progress?: number
  result?: MeshyTaskResult
  errMsg?: string
  args?: {
    draft?: {
      aiModel?: string
      modelType?: string
      imageIds?: string[]
      imageUrl?: string
      prompt?: string
    }
    generate?: { draftIds?: string[] }
    texture?: { prompt?: string; imageId?: string; artStyle?: string }
  }
}

export interface StreamUpdate {
  status?: TaskStatus
  progress?: number
  phase?: string
  task?: MeshyTask
  errMsg?: string
}

const API_PREFIX = '/meshy-api/meshyd-api/web'
const CDN_PREFIX = '/meshy-cdn'
const DEVICE_ID_KEY = 'ams-meshy-device-id'

function getDeviceId(explicit?: string): string {
  if (explicit) return explicit
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
  } catch {
    /* localStorage may be unavailable */
  }
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    localStorage.setItem(DEVICE_ID_KEY, id)
  } catch {
    /* ignore */
  }
  return id
}

/** Rewrite a full meshy.ai/cdn.meshy.ai URL to go through the dev proxy. */
export function proxifyMeshyUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.host === 'www.meshy.ai') return `/meshy-api${u.pathname}${u.search}`
    if (u.host === 'cdn.meshy.ai') return `${CDN_PREFIX}${u.pathname}${u.search}`
    return url
  } catch {
    return url
  }
}

async function meshyFetch(
  path: string,
  auth: MeshyAuth,
  init: RequestInit & { params?: Record<string, string | null> },
  onLog?: MeshyLog,
): Promise<Response> {
  const deviceId = getDeviceId(auth.deviceId)
  const qs = init.params
    ? '?' +
      Object.entries(init.params)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  const url = `${API_PREFIX}${path}${qs}`
  const isForm = init.body instanceof FormData
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    'x-device-id': deviceId,
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }

  onLog?.(`→ ${init.method || 'GET'} ${path}${qs}`)
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      try {
        detail = await res.text()
      } catch {
        detail = ''
      }
    }
    onLog?.(`← ${res.status} ${detail.slice(0, 500)}`)
    throw new Error(`Meshy ${res.status} on ${path}: ${detail.slice(0, 300)}`)
  }
  onLog?.(`← ${res.status}`)
  return res
}

/** Upload an image file. Returns the image id/url Meshy uses to reference it. */
export async function uploadImage(
  file: Blob,
  auth: MeshyAuth,
  onLog?: MeshyLog,
): Promise<UploadedImage> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await meshyFetch(
    '/v1/files/images',
    auth,
    { method: 'POST', body: fd, params: { skipNameGeneration: null } },
    onLog,
  )
  const data = (await res.json()) as { result?: UploadedImage }
  const r = data.result
  if (!r?.id) throw new Error('Meshy upload returned no image id')
  return r
}

/** Create the first-phase "draft" task (image → preview). */
export async function createDraftTask(
  input: {
    imageId: string
    prompt: string
    aiModel?: MeshyAiModel
    modelType?: 'standard' | 'lowpoly' | 'venus'
  },
  auth: MeshyAuth,
  onLog?: MeshyLog,
): Promise<string> {
  const body = {
    phase: 'draft',
    args: {
      draft: {
        aiModel: input.aiModel || 'meshy-5.1',
        modelType: input.modelType || 'standard',
        imageIds: [input.imageId],
        prompt: input.prompt,
      },
    },
    task_type: 'image_to_3d',
  }
  onLog?.(`draft body: ${JSON.stringify(body)}`)
  const res = await meshyFetch(
    '/v2/tasks',
    auth,
    { method: 'POST', body: JSON.stringify(body) },
    onLog,
  )
  const data = (await res.json()) as { result?: string }
  const id = data.result
  if (!id || typeof id !== 'string') {
    throw new Error('Meshy did not return a draft task id')
  }
  return id
}

/**
 * Create the second-phase "generate" task that produces the final textured
 * model from a completed draft.
 */
export async function createGenerateTask(
  input: {
    draftTaskId: string
    prompt: string
    imageId?: string
    enablePBR?: boolean
    artStyle?: string
  },
  auth: MeshyAuth,
  onLog?: MeshyLog,
): Promise<string> {
  const body = {
    phase: 'generate',
    parent: input.draftTaskId,
    args: {
      generate: { draftIds: [input.draftTaskId] },
      texture: {
        prompt: input.prompt,
        ...(input.imageId ? { imageId: input.imageId } : {}),
        artStyle: input.artStyle || 'realistic',
        enablePBR: input.enablePBR ?? true,
      },
    },
  }
  onLog?.(`generate body: ${JSON.stringify(body)}`)
  const res = await meshyFetch(
    '/v2/tasks',
    auth,
    { method: 'POST', body: JSON.stringify(body) },
    onLog,
  )
  const data = (await res.json()) as { result?: string }
  const id = data.result
  if (!id || typeof id !== 'string') {
    throw new Error('Meshy did not return a generate task id')
  }
  return id
}

/** Fetch the full task object (used to read result.modelUrl after success). */
export async function getTask(
  taskId: string,
  auth: MeshyAuth,
  onLog?: MeshyLog,
): Promise<MeshyTask> {
  const res = await meshyFetch(`/v2/tasks/${taskId}`, auth, { method: 'GET' }, onLog)
  const data = (await res.json()) as { result?: MeshyTask }
  if (!data.result) throw new Error(`Meshy task ${taskId} not found`)
  return data.result
}

/**
 * Subscribe to the task status SSE stream (`GET /v2/tasks/{id}/stream`).
 * Calls `onUpdate` for each parsed event and resolves with the terminal
 * task when the stream closes on a terminal status. Throws on fatal errors.
 */
export async function streamTask(
  taskId: string,
  auth: MeshyAuth,
  onUpdate: (u: StreamUpdate) => void,
  onLog?: MeshyLog,
  signal?: AbortSignal,
): Promise<MeshyTask> {
  const deviceId = getDeviceId(auth.deviceId)
  const url = `${API_PREFIX}/v2/tasks/${taskId}/stream`
  onLog?.(`→ GET /v2/tasks/${taskId}/stream (SSE)`)

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'x-device-id': deviceId,
      Accept: 'text/event-stream',
    },
    signal,
  })
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      detail = `HTTP ${res.status}`
    }
    throw new Error(`Meshy stream ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal: MeshyTask | undefined

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evt of events) {
      const dataLine = evt.match(/^data:\s*(.+)$/m)
      if (!dataLine) continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(dataLine[1]!) as Record<string, unknown>
      } catch {
        continue
      }
      const status = (parsed.status as TaskStatus | undefined) ?? undefined
      const progress = parsed.progress as number | undefined
      const errMsg = parsed.errMsg as string | undefined
      const task = (parsed as unknown as { task?: MeshyTask }).task
      onUpdate({ status, progress, task, errMsg })
      if (task) terminal = task
      if (
        status === 'SUCCEEDED' ||
        status === 'FAILED' ||
        status === 'CANCELED'
      ) {
        // Try to fetch the authoritative final task before returning.
        try {
          const full = await getTask(taskId, auth, onLog)
          terminal = full
        } catch {
          /* use the streamed snapshot */
        }
      }
    }
  }

  if (!terminal) {
    // Stream closed without a terminal event — fetch the current state.
    terminal = await getTask(taskId, auth, onLog)
  }
  return terminal
}

/** Reserve a download slot (quota accounting) before fetching the model. */
export async function reserveDownload(
  taskId: string,
  format: string,
  auth: MeshyAuth,
  onLog?: MeshyLog,
): Promise<boolean> {
  try {
    await meshyFetch(
      `/v2/tasks/${taskId}/reserve-download`,
      auth,
      { method: 'POST', body: JSON.stringify({ format }) },
      onLog,
    )
    return true
  } catch (e) {
    onLog?.(`reserve-download failed (continuing anyway): ${(e as Error).message}`)
    return false
  }
}

/** Mark a model as downloaded (quota accounting) after fetching it. */
export async function markDownloaded(
  taskId: string,
  format: string,
  auth: MeshyAuth,
  onLog?: MeshyLog,
): Promise<void> {
  try {
    await meshyFetch(
      `/v2/tasks/${taskId}/mark-downloaded`,
      auth,
      { method: 'POST', body: JSON.stringify({ format }) },
      onLog,
    )
  } catch (e) {
    onLog?.(`mark-downloaded failed: ${(e as Error).message}`)
  }
}

/**
 * Fetch the encrypted `.meshy` (or plain GLB) bytes for a model URL.
 * The URL is routed through the dev proxy to bypass CORS.
 */
export async function fetchModelBytes(
  modelUrl: string,
  onLog?: MeshyLog,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const proxied = proxifyMeshyUrl(modelUrl)
  onLog?.(`→ GET model ${modelUrl.slice(-60)}`)
  const res = await fetch(proxied, { signal })
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** Extract the first available model URL from a finished task. */
export function getModelUrl(task: MeshyTask): string | undefined {
  return (
    task.result?.texture?.modelUrl ||
    task.result?.generate?.modelUrl ||
    task.result?.stylize?.modelUrl ||
    task.result?.autoUv?.modelUrl ||
    task.result?.partSegmentation?.modelUrl
  )
}

