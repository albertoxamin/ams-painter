import { useState, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  badge?: ReactNode
  children: ReactNode
  className?: string
}

export default function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
  className = '',
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={`bpy-panel ${className}`.trim()}>
      <button
        type="button"
        className="bpy-panel-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="bpy-panel-chevron">{open ? '▼' : '▶'}</span>
        <span className="bpy-panel-title">{title}</span>
        {badge != null && <span className="bpy-panel-badge">{badge}</span>}
      </button>
      {open && <div className="bpy-panel-body">{children}</div>}
    </section>
  )
}
