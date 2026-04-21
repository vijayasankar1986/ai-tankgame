// llm/cost.js — lightweight token pricing + formatting helpers.

const PRICE_PER_1M = {
  openai: {
    'gpt-4o-mini': { in: 0.15, out: 0.60 },
    'gpt-4o': { in: 5.0, out: 15.0 },
    'gpt-4.1-mini': { in: 0.40, out: 1.60 },
    'gpt-4.1': { in: 2.0, out: 8.0 },
    'o4-mini': { in: 1.10, out: 4.40 },
  },
  claude: {
    'claude-3-5-haiku-latest': { in: 0.80, out: 4.0 },
    'claude-3-5-sonnet-latest': { in: 3.0, out: 15.0 },
    'claude-3-7-sonnet-latest': { in: 3.0, out: 15.0 },
    'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
    'claude-opus-4-1': { in: 15.0, out: 75.0 },
  },
  gemini: {
    'gemini-2.0-flash': { in: 0.10, out: 0.40 },
    'gemini-2.5-flash': { in: 0.15, out: 0.60 },
    'gemini-2.5-pro': { in: 1.25, out: 5.0 },
    'gemini-1.5-flash-latest': { in: 0.35, out: 1.05 },
    'gemini-1.5-pro-latest': { in: 3.50, out: 10.50 },
  },
}

function priceFor(providerId, model) {
  const prov = PRICE_PER_1M[providerId]
  if (!prov) return null
  return prov[model] || null
}

export function estimateUsd({ providerId, model, inputTokens = 0, outputTokens = 0 }) {
  const price = priceFor(providerId, model)
  if (!price) return 0
  return ((inputTokens / 1_000_000) * price.in) + ((outputTokens / 1_000_000) * price.out)
}

export function formatUsd(v) {
  return `$${Number(v || 0).toFixed(5)}`
}

