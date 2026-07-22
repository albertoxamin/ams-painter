import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useInteractionOptional } from '../interaction/InteractionContext'

/** Registers camera + canvas on the interaction context for HTML overlays (box select). */
export function ViewportPickBridge() {
  const { camera, gl } = useThree()
  const setViewportPick = useInteractionOptional()?.setViewportPick

  useEffect(() => {
    setViewportPick?.({ camera, canvas: gl.domElement })
    return () => setViewportPick?.({ camera: null, canvas: null })
  }, [camera, gl, setViewportPick])

  return null
}
