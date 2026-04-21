// llm/providers/index.js — Provider registry.

import { complete as ollamaComplete, ollamaDefaults, listModels as listOllamaModels } from './ollama.js'
import { openai, claude, gemini }                                                     from './stubs.js'

/**
 * Map of provider id → { complete(args), defaults, models?, listModels?() }.
 *   - `models`: static list used by stubs (OpenAI/Claude/Gemini).
 *   - `listModels`: async fn; currently only Ollama since we can query it
 *     live via /api/tags. Other providers could add one later.
 * The 'human' and 'auto' controllers are handled elsewhere — this registry
 * only contains the actual LLM backends.
 */
export const PROVIDERS = {
  ollama: {
    complete:   ollamaComplete,
    defaults:   ollamaDefaults,
    listModels: listOllamaModels,
  },
  openai,
  claude,
  gemini,
}

export function getProvider(id) {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`Unknown LLM provider: ${id}`)
  return p
}

/** True if this controller id routes through the LLM pipeline. */
export function isLLMController(id) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id)
}

/**
 * Best-effort list of selectable models for a provider. Returns a Promise
 * resolving to { models: string[], source: 'live' | 'static' | 'fallback' }.
 * Never rejects — if a live query fails we fall back to static defaults.
 */
export async function listModelsFor(providerId) {
  const p = PROVIDERS[providerId]
  if (!p) return { models: [], source: 'fallback' }

  if (typeof p.listModels === 'function') {
    try {
      const models = await p.listModels()
      if (models.length) return { models, source: 'live' }
    } catch {
      // fall through to static list below
    }
  }

  if (Array.isArray(p.models) && p.models.length) {
    return { models: p.models, source: 'static' }
  }

  const fallback = p.defaults?.model
  return { models: fallback ? [fallback] : [], source: 'fallback' }
}
