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
      // Use paths that are NOT prefix-related: `/api/llm/ollama` matched
      // `/api/llm/ollama-tags` on many nginx configs, sending GET /tags to
      // /api/generate → Ollama 405. See /api/ollama-tags + /api/ollama-generate.
      '/api/ollama-tags': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama-tags/, '/api/tags'),
      },
      '/api/ollama-generate': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama-generate/, '/api/generate'),
      },
      // Production: copy deploy/nginx-ollama-proxy.example.conf into nginx
      // (https + empty Ollama base URL). Do not use /api/llm/ollama* — nginx
      // prefix matching sent /ollama-tags to /generate → 405.
    },
  },
  build: {
    outDir: 'dist'
  }
})
