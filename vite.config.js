import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Date-only on purpose: a full timestamp changed on every build, which
    // re-hashed the entry chunk and defeated the immutable cache header on
    // /assets/*. The footer only renders a date, so nothing is lost.
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    rollupOptions: {
      output: {
        // Split React into its own content-hashed chunk (already immutable-cached)
        // so returning visitors don't re-download it after an app-code-only deploy.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.js',
  },
})
