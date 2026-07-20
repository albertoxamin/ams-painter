/** Bed grid in the XY plane (Z up). */
export default function ZUpGrid() {
  return (
    <gridHelper
      args={[400, 80, '#2a2f3a', '#1a1d24']}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
    />
  )
}
