import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'

export type AppFeatureId = 'painter' | 'repair' | 'wheels'

export interface AppFeature {
  id: AppFeatureId
  label: string
  Component: ComponentType | LazyExoticComponent<ComponentType>
}

const PainterFeature = lazy(async () => {
  const [{ default: Viewport }, { default: SidePanel }] = await Promise.all([
    import('../components/Viewport'),
    import('../components/SidePanel'),
  ])
  return {
    default: function PainterFeature() {
      return (
        <div className="app">
          <Viewport />
          <SidePanel />
        </div>
      )
    },
  }
})

export const APP_FEATURES: AppFeature[] = [
  {
    id: 'painter',
    label: 'Multi-color painter',
    Component: PainterFeature,
  },
  {
    id: 'repair',
    label: 'GLB → STL repair',
    Component: lazy(() => import('../components/RepairTab')),
  },
  {
    id: 'wheels',
    label: 'Toy car wheels',
    Component: lazy(() => import('../components/WheelTab')),
  },
]
