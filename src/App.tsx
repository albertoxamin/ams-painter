import { Suspense, useState } from 'react'
import { APP_FEATURES, type AppFeatureId } from './features/registry'

export default function App() {
  const [tab, setTab] = useState<AppFeatureId>('painter')
  const active = APP_FEATURES.find((f) => f.id === tab) ?? APP_FEATURES[0]!
  const Active = active.Component

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-brand">AMS Painter</div>
        <nav className="workspace-tabs" aria-label="Workspaces">
          {APP_FEATURES.map((feature) => (
            <button
              key={feature.id}
              type="button"
              className={tab === feature.id ? 'active' : ''}
              onClick={() => setTab(feature.id)}
            >
              {feature.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="workspace-main">
        <Suspense fallback={<div className="workspace-loading">Loading…</div>}>
          <Active />
        </Suspense>
      </main>
    </div>
  )
}
