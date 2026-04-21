// llm/providers/ollama.js — Local Ollama provider.
//
// URL routing:
//   • `npm run dev` + empty `settings.llm.ollamaBaseUrl` → POST/GET to
//     `/api/ollama-generate` and `/api/ollama-tags` (Vite proxies to the
//     machine where Vite runs — usually your dev PC).
//   • `vite build` + **http:** page + empty base → `http://127.0.0.1:11434`
//     (visitor's browser → that visitor's Ollama; needs OLLAMA_ORIGINS CORS).
//   • `vite build` + **https:** page + empty base → same-origin
//     `/api/ollama-tags` (like dev). The host must reverse-proxy those
//     paths to Ollama, **or** set `ollamaBaseUrl` to an **https://** URL that
//     reaches your Ollama (tunnel / LAN proxy). Browsers block http://127.0.0.1
//     from https pages (mixed content).
//   • Non-empty `ollamaBaseUrl` → that origin for `/api/generate` and `/api/tags`.
//
// Ollama CORS: set `OLLAMA_ORIGINS` to include your game origin, e.g.
//   OLLAMA_ORIGINS=https://mygame.example,http://localhost:5173
//
// We request format=json so Ollama constrains the model's output to valid
// JSON. Streaming is disabled to keep the client code simple.

import { settings } from '../../Settings.js'

/**
 * Same-origin paths: Vite dev proxy and production hosts that forward these
 * to Ollama (see vite.config.js). Respects `import.meta.env.BASE_URL`.
 * @param {'tags' | 'generate'} kind
 */
function bundledOllamaPath(kind) {
  // Paths must NOT share a prefix (e.g. /api/llm/ollama vs /api/llm/ollama-tags):
  // many reverse proxies match the shorter prefix and GET /tags was sent to
  // /api/generate → Ollama 405 Method Not Allowed.
  const seg = kind === 'tags' ? 'api/ollama-tags' : 'api/ollama-generate'
  const base = import.meta.env.BASE_URL || '/'
  if (typeof window !== 'undefined') {
    try {
      const u = new URL(base, window.location.origin)
      const p = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`
      return `${p}${seg}`.replace(/\/+/g, '/')
    } catch {
      /* fall through */
    }
  }
  const p = base.endsWith('/') ? base : `${base}/`
  return `${p}${seg}`.replace(/\/+/g, '/')
}

/**
 * @returns {{ mode: 'bundled' } | { mode: 'direct', base: string }}
 */
function ollamaRoute() {
  const custom = (settings.llm?.ollamaBaseUrl ?? '').trim().replace(/\/$/, '')
  if (custom) return { mode: 'direct', base: custom }
  const httpsPage =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
  if (import.meta.env.DEV || httpsPage) return { mode: 'bundled' }
  return { mode: 'direct', base: 'http://127.0.0.1:11434' }
}

function urlGenerate() {
  const r = ollamaRoute()
  return r.mode === 'bundled' ? bundledOllamaPath('generate') : `${r.base}/api/generate`
}

function urlTags() {
  const r = ollamaRoute()
  return r.mode === 'bundled' ? bundledOllamaPath('tags') : `${r.base}/api/tags`
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
  const inTok = Number(data?.prompt_eval_count) || 0
  const outTok = Number(data?.eval_count) || 0
  return {
    text: data.response,
    usage: {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: inTok + outTok,
    },
  }
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
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Ollama tags: response was not JSON — check base URL or site /api/ollama-tags proxy')
  }
  const models = Array.isArray(data?.models) ? data.models : []
  const names = models
    .map(m => (typeof m?.name === 'string' && m.name) || (typeof m?.model === 'string' && m.model) || '')
    .filter(Boolean)
  const usable = [...new Set(names)].filter(name => !/embed/i.test(name))
  usable.sort()
  return usable
}
