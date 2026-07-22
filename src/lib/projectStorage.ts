import type { SelectionSnapshot } from './selectionSnapshot'

const DB_NAME = 'ams-painter'
const DB_VERSION = 1
const STORE = 'autosave'

export interface AutosaveRecord {
  meshHash: string
  meshName: string
  snapshot: SelectionSnapshot
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'meshHash' })
      }
    }
  })
}

export function autosaveKey(meshHash: string, meshName: string): string {
  return `${meshHash}::${meshName.toLowerCase()}`
}

export async function saveAutosave(record: AutosaveRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(record)
  })
  db.close()
}

export async function loadAutosave(meshHash: string): Promise<AutosaveRecord | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  const result = await new Promise<AutosaveRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(meshHash)
    req.onsuccess = () => resolve((req.result as AutosaveRecord) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return result
}

export async function clearAutosave(meshHash: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(meshHash)
  })
  db.close()
}
