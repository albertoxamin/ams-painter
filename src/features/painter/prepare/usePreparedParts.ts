import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CutAxis } from '../../../lib/extrude'
import {
  buildPreparePartsInput,
  prepareInputCacheKey,
  type PreparePartsInput,
} from './buildPrepareInput'
import { loadPreparedWithWorker } from './prepareWorkerClient'

export interface PreparedPartsView {
  lower: THREE.BufferGeometry
  upper: THREE.BufferGeometry | null
  dropIns: THREE.BufferGeometry[]
  dropInAxes: CutAxis[]
  insertsOnly: boolean
}

const MAX_CACHE = 8

type CacheEntry = {
  promise: Promise<PreparedPartsView>
  parts?: PreparedPartsView
}

const cache = new Map<string, CacheEntry>()
const cacheOrder: string[] = []

function touchCacheKey(key: string) {
  const idx = cacheOrder.indexOf(key)
  if (idx >= 0) cacheOrder.splice(idx, 1)
  cacheOrder.push(key)
}

function evictIfNeeded() {
  while (cacheOrder.length > MAX_CACHE) {
    const old = cacheOrder.shift()
    if (old) cache.delete(old)
  }
}

export function invalidatePreparedPartsCache(): void {
  cache.clear()
  cacheOrder.length = 0
}

async function loadPrepared(input: PreparePartsInput): Promise<PreparedPartsView> {
  return loadPreparedWithWorker(input)
}

export function getPreparedPartsCached(
  input: PreparePartsInput,
): Promise<PreparedPartsView> {
  const key = prepareInputCacheKey(input)
  const hit = cache.get(key)
  if (hit) {
    touchCacheKey(key)
    return hit.promise
  }
  const promise = loadPrepared(input).then((parts) => {
    const entry = cache.get(key)
    if (entry) entry.parts = parts
    return parts
  })
  cache.set(key, { promise })
  touchCacheKey(key)
  evictIfNeeded()
  return promise
}

export function usePreparedParts(
  storeSlice: Parameters<typeof buildPreparePartsInput>[0],
  enabled: boolean,
  onError?: (message: string | null) => void,
  onBusy?: (busy: boolean) => void,
  options?: { paused?: boolean; debounceMs?: number },
) {
  const input = buildPreparePartsInput(storeSlice)
  const cacheKey = input ? prepareInputCacheKey(input) : null
  const [parts, setParts] = useState<PreparedPartsView | null>(null)
  const keyRef = useRef<string | null>(null)
  const paused = options?.paused ?? false
  const debounceMs = options?.debounceMs ?? 400

  useEffect(() => {
    if (!enabled || !input || paused) {
      if (!enabled || !input) {
        keyRef.current = null
        setParts(null)
        onBusy?.(false)
      }
      return
    }

    const key = cacheKey!
    keyRef.current = key
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = () => {
      onBusy?.(true)
      onError?.(null)

      const cached = cache.get(key)
      if (cached?.parts) {
        setParts(cached.parts)
        onBusy?.(false)
        return
      }

      getPreparedPartsCached(input)
        .then((result) => {
          if (!cancelled && keyRef.current === key) setParts(result)
        })
        .catch((err) => {
          console.error(err)
          if (!cancelled && keyRef.current === key) {
            onError?.((err as Error).message || 'CSG failed')
            setParts(null)
          }
        })
        .finally(() => {
          if (!cancelled && keyRef.current === key) onBusy?.(false)
        })
    }

    timer = setTimeout(run, debounceMs)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, input, cacheKey, paused, debounceMs, onBusy, onError])

  return parts
}

/** Await prepared parts for export (uses same cache as preview). */
export async function awaitPreparedParts(
  storeSlice: Parameters<typeof buildPreparePartsInput>[0],
) {
  const input = buildPreparePartsInput(storeSlice)
  if (!input) return null
  return getPreparedPartsCached(input)
}
