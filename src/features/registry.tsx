import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'

export type AppFeatureId = 'painter' | 'repair' | 'wheels'

export interface AppFeature {
  id: AppFeatureId
  label: string
  Component: ComponentType | LazyExoticComponent<ComponentType>
}

const PainterFeature = lazy(() => import('../components/layout/PainterWorkspace'))

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
