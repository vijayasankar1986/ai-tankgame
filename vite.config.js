import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    proxy: {
      // Browser → Vite → local Ollama daemon.
      // Ollama listens on :11434 by default with no auth, so we just
      // rewrite the path and forward. No API key ever touches the browser.
      //
      // NOTE: more specific routes MUST come first — Vite's proxy matches
      // by prefix in declaration order, so /api/llm/ollama-tags has to be
      // registered before /api/llm/ollama or it would be shadowed.
      '/api/llm/ollama-tags': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm\/ollama-tags/, '/api/tags'),
      },
      '/api/llm/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm\/ollama/, '/api/generate'),
      },
      // Production https builds call these same paths from the browser; your
      // host (nginx, Caddy, Cloudflare Tunnel, etc.) must mirror this mapping
      // if you rely on empty Ollama base URL over https.
    },
  },
  build: {
    outDir: 'dist'
  }
})
