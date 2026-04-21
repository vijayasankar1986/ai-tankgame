// llm/providers/ollama.js — Local Ollama provider.
//
// URL routing:
//   • `npm run dev` + empty `settings.llm.ollamaBaseUrl` → POST/GET to
//     `/api/llm/ollama` and `/api/llm/ollama-tags` (Vite proxies to the
//     machine where Vite runs — usually your dev PC).
//   • `vite build` + empty base → browser calls `http://127.0.0.1:11434`
//     so **each visitor's browser** talks to **that visitor's** Ollama.
//     (HTTPS game pages cannot call http://127.0.0.1 — browser blocks mixed
//     content; use http:// for the game, a tunneled HTTPS Ollama, or set
//     `ollamaBaseUrl` to your own reverse proxy.)
//   • Non-empty `ollamaBaseUrl` → always use that host (e.g. LAN IP).
//
// Ollama CORS: set `OLLAMA_ORIGINS` to include your game origin, e.g.
//   OLLAMA_ORIGINS=https://mygame.example,http://localhost:5173
//
// We request format=json so Ollama constrains the model's output to valid
// JSON. Streaming is disabled to keep the client code simple.

import { settings } from '../../Settings.js'

/**
 * Resolved Ollama API root (no trailing slash).
 * @returns {{ mode: 'vite-proxy' } | { mode: 'direct', base: string }}
 */
function ollamaRoute() {
  const custom = (settings.llm?.ollamaBaseUrl ?? '').trim().replace(/\/$/, '')
  if (custom) return { mode: 'direct', base: custom }
  if (import.meta.env.DEV) return { mode: 'vite-proxy' }
  return { mode: 'direct', base: 'http://127.0.0.1:11434' }
}

function urlGenerate() {
  const r = ollamaRoute()
  return r.mode === 'vite-proxy' ? '/api/llm/ollama' : `${r.base}/api/generate`
}

function urlTags() {
  const r = ollamaRoute()
  return r.mode === 'vite-proxy' ? '/api/llm/ollama-tags' : `${r.base}/api/tags`
}

/**
 * @param {object} args
 * @param {string} args.model     e.g. "mistral:7b"
 * @param {string} args.system    system prompt
 * @param {string} args.user      user prompt (the game state)
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<string>}  raw model output (a JSON string)
 */
export async function complete({ model, system, user, signal }) {
  const res = await fetch(urlGenerate(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      system,
      prompt: user,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.6,
        num_predict: 220,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 404 && /not found/i.test(text)) {
      throw new Error(`model "${model}" not pulled — run: ollama pull ${model} (or change model in Settings)`)
    }
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 160) || res.statusText}`)
  }

  const data = await res.json()
  if (typeof data?.response !== 'string') {
    throw new Error('Ollama: missing response field')
  }
  return data.response
}

export const ollamaDefaults = {
  model:     'mistral:7b',
  displayName: 'Ollama (local)',
  requiresKey: false,
}

/**
 * Query Ollama for installed models via /api/tags.
 */
export async function listModels({ signal } = {}) {
  const res = await fetch(urlTags(), { signal })
  if (!res.ok) throw new Error(`Ollama tags ${res.status}: ${res.statusText}`)
  const data = await res.json()
  const models = Array.isArray(data?.models) ? data.models : []
  const usable = models
    .map(m => m.name)
    .filter(name => typeof name === 'string')
    .filter(name => !/embed/i.test(name))
    .filter(name => !/-base(?::|$)/i.test(name))
  usable.sort()
  return usable
}
