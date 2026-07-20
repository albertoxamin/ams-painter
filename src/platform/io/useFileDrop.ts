import { useCallback, useState } from 'react'

export function useFileDrop(onFile: (file: File) => void) {
  const [active, setActive] = useState(false)

  const bind = useCallback(
    () => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        setActive(true)
      },
      onDragLeave: () => setActive(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        setActive(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      },
    }),
    [onFile],
  )

  return { dropActive: active, bind }
}
