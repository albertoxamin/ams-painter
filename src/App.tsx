import { Suspense, useState } from 'react'
import { APP_FEATURES, type AppFeatureId } from './features/registry'

export default function App() {
  const [tab, setTab] = useState<AppFeatureId>('painter')
  const active = APP_FEATURES.find((f) => f.id === tab) ?? APP_FEATURES[0]!
  const Active = active.Component

  return (
    <div className="app-shell">
      <nav className="tab-bar">
        {APP_FEATURES.map((feature) => (
          <button
            key={feature.id}
            className={tab === feature.id ? 'active' : ''}
            onClick={() => setTab(feature.id)}
          >
            {feature.label}
          </button>
        ))}
      </nav>

      <Suspense fallback={<div className="panel section">Loading…</div>}>
        <Active />
      </Suspense>
    </div>
  )
}
