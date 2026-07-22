/** Fast synchronous hash for STL identity checks (autosave / project files). */
export function hashArrayBufferSync(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf)
  let h = 2166136261
  for (let i = 0; i < view.length; i++) {
    h ^= view[i]!
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export async function hashArrayBuffer(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf)
      const bytes = new Uint8Array(digest)
      let hex = ''
      for (let i = 0; i < 8; i++) {
        hex += bytes[i]!.toString(16).padStart(2, '0')
      }
      return hex
    } catch {
      /* fall through */
    }
  }
  return hashArrayBufferSync(buf)
}
