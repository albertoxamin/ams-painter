import type { SelectionSnapshot } from './selectionSnapshot'
import type { Model } from '../domain/model'
import { loadAutosave } from './projectStorage'
import { validateSnapshotForModel } from './selectionSnapshot'

export async function tryRestoreAutosave(
  model: Model,
  restore: (snap: SelectionSnapshot) => void,
): Promise<boolean> {
  const record = await loadAutosave(model.meshHash)
  if (!record) return false
  if (record.meshName.toLowerCase() !== model.name.toLowerCase()) return false
  const mismatch = validateSnapshotForModel(record.snapshot, model)
  if (mismatch) return false
  restore(record.snapshot)
  return true
}
