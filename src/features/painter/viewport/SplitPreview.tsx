import * as THREE from 'three'
import { useStore, resolveIslandMeta, paletteColor } from '../../../state'
import { COLORS } from './constants'
import { usePreparedParts } from '../prepare/usePreparedParts'
import { useInteraction } from '../interaction/InteractionContext'

export function SplitPreview({
  splitHeight,
  model,
  preview,
  setBusy,
  setError,
  dropInIslands,
}: {
  splitHeight: number
  model: NonNullable<ReturnType<typeof useStore.getState>['model']>
  preview: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  dropInIslands: Set<number>[]
}) {
  const structural = useStore((s) => s.structural)
  const dropIn = useStore((s) => s.dropIn)
  const dropInMeta = useStore((s) => s.dropInMeta)
  const palette = useStore((s) => s.palette)
  const brushColorId = useStore((s) => s.brushColorId)
  const cutAxis = useStore((s) => s.cutAxis)
  const dropInFloorZ = useStore((s) => s.dropInFloorZ)
  const explode = useStore((s) => s.explode)
  const clearance = useStore((s) => s.clearance)
  const insertsOnly = useStore((s) => s.insertsOnly)
  const penCutouts = useStore((s) => s.penCutouts)
  const { isPainting } = useInteraction()

  const parts = usePreparedParts(
    {
      model,
      splitHeight,
      structural,
      dropIn,
      dropInMeta,
      penCutouts,
      clearance,
      dropInFloorZ,
      insertsOnly,
      cutAxis,
    },
    preview,
    setError,
    setBusy,
    { paused: isPainting, debounceMs: 400 },
  )

  const box = model.geometry.boundingBox!
  const size = new THREE.Vector3()
  box.getSize(size)
  const planeW = Math.max(size.x, size.y) * 1.4
  const planeH = planeW
  const gap = size.z * 0.85 * explode

  const fallback = {
    axis: cutAxis,
    floor: dropInFloorZ,
    colorId: brushColorId,
  }

  return (
    <group>
      {!insertsOnly && explode < 0.05 && (
        <>
          <mesh position={[0, 0, splitHeight]} raycast={() => {}}>
            <planeGeometry args={[planeW, planeH]} />
            <meshBasicMaterial
              color={COLORS.plane}
              transparent
              opacity={0.18}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments position={[0, 0, splitHeight]} raycast={() => {}}>
            <edgesGeometry args={[new THREE.PlaneGeometry(planeW, planeH)]} />
            <lineBasicMaterial color={COLORS.plane} />
          </lineSegments>
        </>
      )}

      {preview && parts && (
        <group>
          <mesh
            geometry={parts.lower}
            position={[0, 0, parts.insertsOnly ? 0 : -gap]}
            raycast={() => {}}
          >
            <meshStandardMaterial
              color={COLORS.lower}
              flatShading
              side={THREE.DoubleSide}
            />
          </mesh>
          {parts.upper && (
            <mesh geometry={parts.upper} position={[0, 0, gap]} raycast={() => {}}>
              <meshStandardMaterial
                color={COLORS.upper}
                flatShading
                side={THREE.DoubleSide}
                transparent
                opacity={0.7}
              />
            </mesh>
          )}
          {parts.dropIns.map((g, i) => {
            const islandCount = dropInIslands.length
            const axis = parts.dropInAxes[i] ?? '-z'
            let hex = COLORS.dropIn
            if (i < islandCount) {
              const island = dropInIslands[i]
              if (island) {
                hex = paletteColor(
                  palette,
                  resolveIslandMeta(island, dropInMeta, fallback).colorId,
                ).hex
              }
            } else {
              const pen = penCutouts[i - islandCount]
              if (pen) {
                hex = paletteColor(palette, pen.meta.colorId).hex
              }
            }
            // Explode along the insert's cut axis so ±X / ±Y inserts are visible
            const lift = gap * (parts.insertsOnly ? 1.1 : 1.35)
            const ox =
              axis === '+x' ? lift : axis === '-x' ? -lift : 0
            const oy =
              axis === '+y' ? lift : axis === '-y' ? -lift : 0
            const oz =
              axis === '+z' ? lift : axis === '-z' ? lift : 0
            return (
              <mesh
                key={i}
                geometry={g}
                position={[ox, oy, oz]}
                raycast={() => {}}
              >
                <meshStandardMaterial
                  color={hex}
                  flatShading
                  side={THREE.DoubleSide}
                />
              </mesh>
            )
          })}
        </group>
      )}
    </group>
  )
}
