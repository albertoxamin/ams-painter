import type { InsertMeta, PaletteColor } from './insert'

export const DEFAULT_PALETTE: PaletteColor[] = [
  { id: 'red', name: 'Red', hex: '#e74c3c' },
  { id: 'blue', name: 'Blue', hex: '#5ec8ff' },
  { id: 'yellow', name: 'Yellow', hex: '#f1c40f' },
  { id: 'white', name: 'White', hex: '#ecf0f1' },
]

/** Resolve cut settings for an island from per-face meta (majority vote). */
export function resolveIslandMeta(
  faces: Set<number>,
  meta: Map<number, InsertMeta>,
  fallback: InsertMeta,
): InsertMeta {
  const votes = new Map<string, { meta: InsertMeta; n: number }>()
  for (const f of faces) {
    const m = meta.get(f) ?? fallback
    const entryKey = m.entry !== undefined ? m.entry.toFixed(3) : '_'
    const key = `${m.axis}|${m.floor.toFixed(3)}|${entryKey}|${m.colorId}`
    const cur = votes.get(key)
    if (cur) cur.n++
    else votes.set(key, { meta: m, n: 1 })
  }
  let best: InsertMeta = fallback
  let bestN = -1
  for (const v of votes.values()) {
    if (v.n > bestN) {
      bestN = v.n
      best = v.meta
    }
  }
  return best
}

export function paletteColor(
  palette: PaletteColor[],
  id: string | undefined,
): PaletteColor {
  return (
    palette.find((c) => c.id === id) ??
    palette[0] ?? { id: 'blue', name: 'Blue', hex: '#5ec8ff' }
  )
}

/** Filename-safe slug from a color name. */
export function colorSlug(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return s || 'color'
}
