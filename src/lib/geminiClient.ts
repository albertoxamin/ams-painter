/**
 * Minimal client for Google's Gemini image-generation models
 * (a.k.a. "nano banana" — `gemini-2.5-flash-image`).
 *
 * Calls the Generative Language REST endpoint directly from the browser
 * using an API key the user pastes into the UI. The key is held only in
 * memory (and optionally localStorage) and is never bundled into the app.
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   header: x-goog-api-key: <KEY>
 *   body:   { contents:[{role:"user",parts:[{text}]}],
 *            generationConfig:{ responseModalities:["IMAGE"], imageConfig:{aspectRatio} } }
 *   resp:   candidates[0].content.parts[].inlineData.{mimeType,data(base64)}
 *
 * NOTE: `gemini-2.5-flash-image` is announced for shutdown on 2026-10-02.
 * The model id is configurable in the UI so a successor can be dropped in.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-image'

export type GeminiAspectRatio =
  | '1:1'
  | '3:2'
  | '2:3'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9'

export interface GeminiImageOptions {
  prompt: string
  apiKey: string
  model?: string
  aspectRatio?: GeminiAspectRatio
  /** Abort the request (e.g. when the user cancels). */
  signal?: AbortSignal
}

export interface GeminiImageResult {
  /** Raw image bytes (PNG). */
  bytes: Uint8Array
  /** MIME type reported by the API, e.g. `image/png`. */
  mimeType: string
  /** Object URL for previewing the image in an <img>. Caller revokes it. */
  previewUrl: string
}

interface InlineData {
  mimeType?: string
  data: string
}

interface ResponsePart {
  text?: string
  inlineData?: InlineData
  inline_data?: InlineData
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: ResponsePart[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Generate a single image from a text prompt. Throws on API errors, safety
 * blocks, or when no image is returned.
 */
export async function generateGeminiImage(
  opts: GeminiImageOptions,
): Promise<GeminiImageResult> {
  const model = opts.model?.trim() || DEFAULT_GEMINI_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`

  const body = {
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(opts.aspectRatio
        ? { imageConfig: { aspectRatio: opts.aspectRatio } }
        : {}),
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': opts.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  let json: GeminiResponse
  try {
    json = (await res.json()) as GeminiResponse
  } catch {
    throw new Error(`Gemini request failed (HTTP ${res.status})`)
  }

  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`
    throw new Error(`Gemini error: ${msg}`)
  }

  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`)
  }

  const parts = json.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) {
      const bytes = base64ToBytes(inline.data)
      const mimeType = inline.mimeType || 'image/png'
      const blob = new Blob([bytes as BlobPart], { type: mimeType })
      const previewUrl = URL.createObjectURL(blob)
      return { bytes, mimeType, previewUrl }
    }
  }

  const finishReason = json.candidates?.[0]?.finishReason
  throw new Error(
    `Gemini returned no image${
      finishReason ? ` (finishReason: ${finishReason})` : ''
    }`,
  )
}
