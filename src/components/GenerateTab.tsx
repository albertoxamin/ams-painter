import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { prepareForDisplay } from '../lib/stlRepair'
import { loadGLBGeometry } from '../lib/loadGLB'
import { downloadSTL } from '../lib/exportSTL'
import { downloadBlob } from '../platform/io/downloadBlob'
import {
  generateGeminiImage,
  DEFAULT_GEMINI_MODEL,
  type GeminiAspectRatio,
} from '../lib/geminiClient'
import {
  uploadImage,
  createDraftTask,
  createGenerateTask,
  streamTask,
  reserveDownload,
  markDownloaded,
  fetchModelBytes,
  getModelUrl,
  type MeshyAuth,
  type MeshyAiModel,
  type MeshyTask,
} from '../lib/meshyClient'
import { decodeMeshyToStandardGlb, isMeshyFile } from '../lib/meshyDecrypt'

type MeshyMode = 'auto' | 'manual'

const LS_GEMINI_KEY = 'ams-gemini-key'
const LS_MESHY_TOKEN = 'ams-meshy-token'

function PreviewMesh({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const displayGeom = useMemo(
    () => (geometry ? prepareForDisplay(geometry) : null),
    [geometry],
  )
  if (!displayGeom) return null
  return (
    <mesh geometry={displayGeom}>
      <meshStandardMaterial color="#6ea8fe" metalness={0.1} roughness={0.6} flatShading />
    </mesh>
  )
}

function CameraRig({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    camera.up.set(0, 0, 1)
    if (!geometry) return
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    b.getCenter(center)
    b.getSize(size)
    const dist = Math.max(size.x, size.y, size.z, 0.01) * 1.8
    camera.position.set(center.x + dist, center.y - dist * 0.85, center.z + dist * 0.55)
    camera.lookAt(center)
    if (controls && 'target' in controls) {
      ;(controls as unknown as { target: THREE.Vector3; update: () => void }).target.copy(center)
      ;(controls as unknown as { update: () => void }).update()
    }
  }, [geometry, camera, controls])
  return null
}

export default function GenerateTab() {
  const [geminiKey, setGeminiKey] = useState(
    () => localStorage.getItem(LS_GEMINI_KEY) ?? '',
  )
  const [meshyToken, setMeshyToken] = useState(
    () => localStorage.getItem(LS_MESHY_TOKEN) ?? '',
  )
  const [showKeys, setShowKeys] = useState(false)

  const [prompt, setPrompt] = useState('a low-poly sports car, studio product photo, white background, 3/4 view')
  const [aspectRatio, setAspectRatio] = useState<GeminiAspectRatio>('1:1')
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL)
  const [meshyAiModel, setMeshyAiModel] = useState<MeshyAiModel>('meshy-5.1')
  const [meshyMode, setMeshyMode] = useState<MeshyMode>('auto')
  const [manualTaskId, setManualTaskId] = useState('')

  // Image source: generate with Gemini, or upload a file directly.
  const [imageSource, setImageSource] = useState<'gemini' | 'upload'>('upload')
  const [uploadedImage, setUploadedImage] = useState<{
    file: File
    previewUrl: string
  } | null>(null)
  const imageFileRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [progress, setProgress] = useState<string>('')

  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [glbBytes, setGlbBytes] = useState<ArrayBuffer | null>(null)
  const [dropActive, setDropActive] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const imagePreviewRef = useRef<string | null>(null)

  const addLog = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString()
    setLog((l) => [...l, `${stamp}  ${line}`])
  }, [])

  const auth: MeshyAuth = useMemo(() => ({ token: meshyToken.trim() }), [meshyToken])

  // Persist keys to localStorage (memory-only fallback if storage is blocked).
  useEffect(() => {
    try { localStorage.setItem(LS_GEMINI_KEY, geminiKey) } catch { /* ignore */ }
  }, [geminiKey])
  useEffect(() => {
    try { localStorage.setItem(LS_MESHY_TOKEN, meshyToken) } catch { /* ignore */ }
  }, [meshyToken])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current)
  }, [])

  const resetResult = () => {
    setGeometry(null)
    setGlbBytes(null)
    setError(null)
    setProgress('')
    if (imagePreviewRef.current) {
      URL.revokeObjectURL(imagePreviewRef.current)
      imagePreviewRef.current = null
    }
    setImagePreview(null)
  }

  const pickUploadedImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (png/jpg/webp).')
      return
    }
    setError(null)
    setUploadedImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return { file, previewUrl: URL.createObjectURL(file) }
    })
  }

  const showImage = (url: string) => {
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current)
    imagePreviewRef.current = url
    setImagePreview(url)
  }

  /** Decode already-downloaded .meshy/.glb bytes into a previewable geometry. */
  const decodeBytes = useCallback(
    async (bytes: ArrayBuffer, name: string) => {
      addLog(`Decoding ${name} (${bytes.byteLength.toLocaleString()} bytes)…`)
      const glb = await decodeMeshyToStandardGlb(bytes)
      addLog(`Decoded → GLB (${glb.byteLength.toLocaleString()} bytes)`)
      setGlbBytes(glb)
      const geom = await loadGLBGeometry(glb)
      setGeometry(geom)
      addLog(`Loaded mesh: ${geom.getAttribute('position').count.toLocaleString()} verts`)
    },
    [addLog],
  )

  const handleDroppedFile = useCallback(
    async (file: File) => {
      if (!/\.(meshy|glb)$/i.test(file.name)) {
        setError('Drop a .meshy or .glb file to decrypt/preview')
        return
      }
      resetResult()
      setBusy(true)
      try {
        const buf = await file.arrayBuffer()
        await decodeBytes(buf, file.name)
      } catch (e) {
        setError((e as Error).message)
        addLog(`✗ ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [decodeBytes, addLog],
  )

  /** Download the encrypted model for a finished Meshy task and decode it. */
  const downloadAndDecodeTask = useCallback(
    async (task: MeshyTask) => {
      const modelUrl = getModelUrl(task)
      if (!modelUrl) {
        throw new Error(
          `Task ${task.id} succeeded but has no model URL (phase=${task.phase}). ` +
            'Try the manual mode with a generate/texture-phase task id.',
        )
      }
      await reserveDownload(task.id, 'glb', auth, addLog)
      addLog('Downloading model…')
      const enc = await fetchModelBytes(modelUrl, addLog, abortRef.current?.signal)
      addLog(`Got ${enc.byteLength.toLocaleString()} bytes (encrypted: ${isMeshyFile(enc)})`)
      await decodeBytes(enc, `${task.id}.meshy`)
      await markDownloaded(task.id, 'glb', auth, addLog)
    },
    [auth, addLog, decodeBytes],
  )

/** Run the full automatic Gemini → Meshy → GLB pipeline. */
const runAuto = useCallback(async () => {
  if (imageSource === 'gemini' && !geminiKey.trim()) {
    setError('Paste your Gemini API key first (or switch to Upload image).')
    return
  }
  if (imageSource === 'upload' && !uploadedImage) {
    setError('Choose an image file first (or switch to Gemini prompt).')
    return
  }
  if (!meshyToken.trim()) { setError('Paste your Meshy bearer token first.'); return }
  abortRef.current?.abort()
  const ac = new AbortController()
  abortRef.current = ac
  resetResult()
  setBusy(true)
  setLog([])
  try {
    // ── Acquire the source image (Gemini or uploaded file) ──
    let imageBlob: Blob
    if (imageSource === 'upload' && uploadedImage) {
      addLog(`Using uploaded image: ${uploadedImage.file.name}`)
      imageBlob = uploadedImage.file
      showImage(uploadedImage.previewUrl)
    } else {
      setProgress('Generating image with Gemini…')
      addLog(`Gemini model: ${geminiModel}, aspect: ${aspectRatio}`)
      const img = await generateGeminiImage({
        prompt,
        apiKey: geminiKey.trim(),
        model: geminiModel,
        aspectRatio,
        signal: ac.signal,
      })
      addLog(`Gemini image: ${img.mimeType}, ${img.bytes.byteLength.toLocaleString()} bytes`)
      showImage(img.previewUrl)
      imageBlob = new Blob([img.bytes as BlobPart], { type: img.mimeType })
    }

    setProgress('Uploading image to Meshy…')
    const uploaded = await uploadImage(imageBlob, auth, addLog)
    addLog(`Uploaded → imageId ${uploaded.id}`)

    setProgress('Creating draft task (phase 1/2)…')
    const draftId = await createDraftTask(
        { imageId: uploaded.id, prompt, aiModel: meshyAiModel },
        auth,
        addLog,
      )
      addLog(`Draft task: ${draftId}`)

      setProgress('Waiting for draft to finish…')
      const draft = await streamTask(draftId, auth, (u) => {
        if (u.progress !== undefined) setProgress(`Draft ${u.progress}%`)
      }, addLog, ac.signal)
      if (draft.status !== 'SUCCEEDED') {
        throw new Error(`Draft ${draft.status}: ${draft.errMsg || 'no details'}`)
      }
      addLog('Draft complete — creating generate task (phase 2/2)…')

      setProgress('Generating final textured model…')
      const genId = await createGenerateTask(
        { draftTaskId: draftId, prompt, imageId: uploaded.id, enablePBR: true },
        auth,
        addLog,
      )
      addLog(`Generate task: ${genId}`)

      setProgress('Waiting for model to finish…')
      const gen = await streamTask(genId, auth, (u) => {
        if (u.progress !== undefined) setProgress(`Refine ${u.progress}%`)
      }, addLog, ac.signal)
      if (gen.status !== 'SUCCEEDED') {
        throw new Error(`Generate ${gen.status}: ${gen.errMsg || 'no details'}`)
      }
      addLog('Model ready — downloading & decrypting…')
      setProgress('Downloading & decrypting GLB…')
      await downloadAndDecodeTask(gen)
      setProgress('Done')
      addLog('✓ Done')
    } catch (e) {
      if ((e as Error).name === 'AbortError') { addLog('Cancelled'); return }
      setError((e as Error).message)
      addLog(`✗ ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [imageSource, uploadedImage, geminiKey, meshyToken, prompt, aspectRatio, geminiModel, meshyAiModel, auth, addLog, downloadAndDecodeTask])

  /** Manual mode: stream a task id the user created on meshy.ai, then download+decrypt. */
  const runManual = useCallback(async () => {
    const id = manualTaskId.trim()
    if (!id) { setError('Paste a Meshy task id.'); return }
    if (!meshyToken.trim()) { setError('Paste your Meshy bearer token first.'); return }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    resetResult()
    setBusy(true)
    setLog([])
    try {
      setProgress('Streaming task…')
      addLog(`Streaming task ${id}`)
      const task = await streamTask(id, auth, (u) => {
        if (u.progress !== undefined) setProgress(`${u.progress}%`)
      }, addLog, ac.signal)
      if (task.status !== 'SUCCEEDED') {
        throw new Error(`Task ${task.status}: ${task.errMsg || 'no details'}`)
      }
      addLog('Task ready — downloading & decrypting…')
      setProgress('Downloading & decrypting GLB…')
      await downloadAndDecodeTask(task)
      setProgress('Done')
      addLog('✓ Done')
    } catch (e) {
      if ((e as Error).name === 'AbortError') { addLog('Cancelled'); return }
      setError((e as Error).message)
      addLog(`✗ ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [manualTaskId, meshyToken, auth, addLog, downloadAndDecodeTask])

  const cancel = () => {
    abortRef.current?.abort()
    setBusy(false)
    setProgress('')
  }

  const downloadGlb = () => {
    if (!glbBytes) return
    downloadBlob(new Blob([glbBytes as BlobPart], { type: 'model/gltf-binary' }), 'meshy_model.glb')
  }
  const downloadStl = () => {
    if (!geometry) return
    downloadSTL(geometry, 'meshy_model.stl')
  }

  return (
    <div className="repair-tab">
      <div
        className="repair-viewport"
        onDragOver={(e) => { e.preventDefault(); setDropActive(true) }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault(); setDropActive(false)
          const f = e.dataTransfer.files?.[0]
          if (f) handleDroppedFile(f)
        }}
      >
        <Canvas
          camera={{ fov: 45, near: 0.1, far: 5000, position: [200, -170, 120], up: [0, 0, 1] }}
          gl={{ antialias: true }}
          onCreated={({ camera, scene }) => {
            camera.up.set(0, 0, 1)
            scene.background = new THREE.Color('#0a0c10')
          }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[200, -150, 300]} intensity={1.2} />
          <directionalLight position={[-150, 100, 200]} intensity={0.4} />
          <PreviewMesh geometry={geometry} />
          <CameraRig geometry={geometry} />
          <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.95} />
        </Canvas>

        {imagePreview && (
          <div className="gen-image-overlay">
            <img src={imagePreview} alt="Gemini generated" />
            <span className="gen-image-tag">Gemini image</span>
          </div>
        )}

        {!geometry && !imagePreview && !busy && (
          <div className={`dropzone ${dropActive ? 'active' : ''}`}>
            <div className="card">
              <h2>Gemini → Meshy → GLB</h2>
              <p>Enter a prompt and keys in the panel, or drop a <code>.meshy</code>/<code>.glb</code> file here to decrypt.</p>
            </div>
          </div>
        )}
      </div>

      <aside className="panel repair-panel">
        <section>
          <h3>Keys</h3>
          <label className="field-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <span>Gemini API key</span>
            <input
              type={showKeys ? 'text' : 'password'}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIza…"
              autoComplete="off"
            />
          </label>
          <label className="field-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <span>Meshy bearer token (JWT)</span>
            <textarea
              className="gen-token-area"
              value={meshyToken}
              onChange={(e) => setMeshyToken(e.target.value)}
              placeholder="eyJhbGciOi… (from a logged-in meshy.ai request's Authorization header)"
              rows={3}
              style={{ width: '100%' }}
            />
          </label>
          <button onClick={() => setShowKeys((s) => !s)} disabled={busy}>
            {showKeys ? 'Hide keys' : 'Reveal keys'}
          </button>
          <div className="help">
            Keys are stored only in this browser (localStorage) and sent directly to
            Google / Meshy. The Meshy token is a 15-minute session JWT — re-copy it if it expires.
          </div>
        </section>

        <section>
          <h3>Image source</h3>
          <div className="modes">
            <button className={imageSource === 'upload' ? 'active' : ''} onClick={() => setImageSource('upload')} disabled={busy}>Upload image</button>
            <button className={imageSource === 'gemini' ? 'active' : ''} onClick={() => setImageSource('gemini')} disabled={busy}>Gemini prompt</button>
          </div>

          {imageSource === 'upload' ? (
            <>
              <input
                ref={imageFileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) pickUploadedImage(f)
                  e.target.value = ''
                }}
              />
              <button onClick={() => imageFileRef.current?.click()} disabled={busy}>
                {uploadedImage ? 'Change image…' : 'Choose image…'}
              </button>
              {uploadedImage && (
                <div className="help">
                  <strong>{uploadedImage.file.name}</strong>
                  <br />
                  {(uploadedImage.file.size / 1024).toFixed(0)} KB
                </div>
              )}
              <div className="help" style={{ color: 'var(--bpy-text-dim)' }}>
                No Gemini key needed — any image works (free generator, screenshot, photo).
              </div>
            </>
          ) : (
            <>
              <textarea
                className="gen-prompt-area"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                style={{ width: '100%' }}
              />
              <div className="row">
                <label className="label">Aspect</label>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as GeminiAspectRatio)}>
                  {['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="row">
                <label className="label">Gemini model</label>
                <input type="text" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} />
              </div>
              <div className="help" style={{ color: 'var(--bpy-text-dim)' }}>
                Image generation is paid-only on the Gemini API (free tier = 0 quota). Enable billing on your
                Google Cloud project, or use Upload image.
              </div>
            </>
          )}
        </section>

        <section>
          <h3>Meshy</h3>
          <div className="modes">
            <button className={meshyMode === 'auto' ? 'active' : ''} onClick={() => setMeshyMode('auto')} disabled={busy}>Auto (2-phase)</button>
            <button className={meshyMode === 'manual' ? 'active' : ''} onClick={() => setMeshyMode('manual')} disabled={busy}>Manual task id</button>
          </div>
          {meshyMode === 'auto' ? (
            <div className="row">
              <label className="label">AI model</label>
              <select value={meshyAiModel} onChange={(e) => setMeshyAiModel(e.target.value as MeshyAiModel)}>
                {['meshy-5.1', 'meshy-5.3', 'meshy-6-lite', 'meshy-7', 'latest'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          ) : (
            <label className="field-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <span>Task id (from meshy.ai workspace URL)</span>
              <input type="text" value={manualTaskId} onChange={(e) => setManualTaskId(e.target.value)} placeholder="xxxxxxxx-…" />
            </label>
          )}
          {meshyMode === 'auto' ? (
            <button className="primary" onClick={runAuto} disabled={busy}>
              {busy ? 'Working…' : imageSource === 'gemini' ? 'Generate image → Meshy → GLB' : 'Upload image → Meshy → GLB'}
            </button>
          ) : (
            <button className="primary" onClick={runManual} disabled={busy}>
              {busy ? 'Working…' : 'Stream & download GLB'}
            </button>
          )}
          {busy && <button className="danger" onClick={cancel} style={{ marginTop: 6 }}>Cancel</button>}
          {progress && <div className="help">{progress}</div>}
          <div className="help" style={{ color: 'var(--bpy-text-dim)' }}>
            {meshyMode === 'auto'
              ? 'Auto creates a draft then a generate task on your account (uses credits).'
              : 'Manual streams a task you already created on meshy.ai and just fetches the GLB.'}
          </div>
        </section>

        {(log.length > 0) && (
          <section>
            <h3>Activity log</h3>
            <div className="repair-log gen-log">
              {log.map((l, i) => (
                <div className="log-step" key={i} style={{ fontWeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{l}</div>
              ))}
            </div>
          </section>
        )}

        {geometry && (
          <section>
            <h3>Export</h3>
            <button className="primary" onClick={downloadGlb} disabled={busy}>Download GLB</button>
            <button onClick={downloadStl} disabled={busy} style={{ marginTop: 6 }}>Download STL</button>
          </section>
        )}

        {error && (
          <section>
            <div className="help" style={{ color: 'var(--danger)' }}>{error}</div>
          </section>
        )}
      </aside>
    </div>
  )
}


