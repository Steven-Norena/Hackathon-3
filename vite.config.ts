import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function buildSha(): string {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_REF || process.env.CF_PAGES_COMMIT_SHA
  if (env) return env.slice(0, 7)
  if (process.env.NODE_ENV === 'production' || process.argv.includes('build')) {
    try { return execSync('git rev-parse --short=7 HEAD').toString().trim() } catch { /* sin git */ }
  }
  return 'dev'
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(command === 'serve' ? 'dev' : buildSha()) },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
}))
