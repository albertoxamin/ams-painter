import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

const formwareProxy: Record<string, ProxyOptions> = {
  '/formware-fixer': {
    target: 'https://fixer.formware.co',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/formware-fixer/, ''),
  },
}

// Meshy internal web API + CDN are not CORS-enabled for third-party
// origins, so the Generate tab routes everything through these dev proxies.
// Only works under `npm run dev` / `npm run preview` (not the static deploy).
const meshyProxy: Record<string, ProxyOptions> = {
  '/meshy-api': {
    target: 'https://www.meshy.ai',
    changeOrigin: true,
    secure: true,
  },
  '/meshy-cdn': {
    target: 'https://cdn.meshy.ai',
    changeOrigin: true,
    secure: true,
  },
}

const proxy: Record<string, ProxyOptions> = { ...formwareProxy, ...meshyProxy }

// https://vite.dev/config/
export default defineConfig({
  base: '/ams-painter/',
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  optimizeDeps: {
    exclude: ['manifold-3d'],
    include: ['three-bvh-csg'],
  },
  assetsInclude: ['**/*.wasm'],
})
