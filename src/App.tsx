import { useState } from 'react'
import Viewport from './components/Viewport'
import SidePanel from './components/SidePanel'
import RepairTab from './components/RepairTab'
import WheelTab from './components/WheelTab'

type Tab = 'painter' | 'repair' | 'wheels'

export default function App() {
  const [tab, setTab] = useState<Tab>('painter')

  return (
    <div className="app-shell">
      <nav className="tab-bar">
        <button
          className={tab === 'painter' ? 'active' : ''}
          onClick={() => setTab('painter')}
        >
          Multi-color painter
        </button>
        <button
          className={tab === 'repair' ? 'active' : ''}
          onClick={() => setTab('repair')}
        >
          GLB → STL repair
        </button>
        <button
          className={tab === 'wheels' ? 'active' : ''}
          onClick={() => setTab('wheels')}
        >
          Toy car wheels
        </button>
      </nav>

      {tab === 'painter' ? (
        <div className="app">
          <Viewport />
          <SidePanel />
        </div>
      ) : tab === 'repair' ? (
        <RepairTab />
      ) : (
        <WheelTab />
      )}
    </div>
  )
}
