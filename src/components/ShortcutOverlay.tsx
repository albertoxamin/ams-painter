import { useEffect, useState } from 'react'
import { SHORTCUT_HELP } from '../features/painter/tools/registry'

interface ShortcutOverlayProps {
  open: boolean
  onClose: () => void
}

export default function ShortcutOverlay({ open, onClose }: ShortcutOverlayProps) {
  if (!open) return null

  return (
    <div
      className="shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div className="shortcut-card" onClick={(e) => e.stopPropagation()}>
        <div className="shortcut-card-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="shortcut-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUT_HELP.map((row) => (
              <tr key={row.keys}>
                <td>
                  <kbd>{row.keys}</kbd>
                </td>
                <td>{row.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="shortcut-foot">Press ? or Esc to close</p>
      </div>
    </div>
  )
}

export function useShortcutOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return { open, setOpen }
}
