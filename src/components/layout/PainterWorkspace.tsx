import Viewport from '../Viewport'
import SidePanel from '../SidePanel'
import ToolShelf from '../ToolShelf'
import PainterStatusBar from './PainterStatusBar'
import ShortcutOverlay, { useShortcutOverlay } from '../ShortcutOverlay'
import { useAutosave } from '../../hooks/useAutosave'

export default function PainterWorkspace() {
  const { open, setOpen } = useShortcutOverlay()
  useAutosave()

  return (
    <div className="painter-workspace">
      <div className="painter-body">
        <ToolShelf />
        <Viewport />
        <SidePanel />
      </div>
      <PainterStatusBar onShowShortcuts={() => setOpen(true)} />
      <ShortcutOverlay open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
