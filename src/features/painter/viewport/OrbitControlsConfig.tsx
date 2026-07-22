import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useStore } from '../../../state'

type OrbitMouseButtons = {
  LEFT: THREE.MOUSE | null
  MIDDLE: THREE.MOUSE
  RIGHT: THREE.MOUSE
}

const DEFAULT_BUTTONS: OrbitMouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
}

const BOX_TOOL_BUTTONS: OrbitMouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.ROTATE,
  RIGHT: THREE.MOUSE.PAN,
}

/** While box-select is active, LMB draws the marquee — orbit with middle mouse. */
export function OrbitControlsConfig() {
  const paintTool = useStore((s) => s.paintTool)
  const controls = useThree((s) => s.controls)

  useEffect(() => {
    if (!controls || !('mouseButtons' in controls)) return
    const oc = controls as unknown as { mouseButtons: OrbitMouseButtons }
    const next = paintTool === 'box' ? BOX_TOOL_BUTTONS : DEFAULT_BUTTONS
    oc.mouseButtons.LEFT = next.LEFT
    oc.mouseButtons.MIDDLE = next.MIDDLE
    oc.mouseButtons.RIGHT = next.RIGHT
    return () => {
      oc.mouseButtons.LEFT = DEFAULT_BUTTONS.LEFT
      oc.mouseButtons.MIDDLE = DEFAULT_BUTTONS.MIDDLE
      oc.mouseButtons.RIGHT = DEFAULT_BUTTONS.RIGHT
    }
  }, [paintTool, controls])

  return null
}
