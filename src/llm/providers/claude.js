import { settings } from '../../Settings.js'

const CLAUDE_MODELS = [
  'claude-3-5-haiku-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-7-sonnet-latest',
  'claude-sonnet-4-5',
  'claude-opus-4-1',
]

function claudeBase() {
  return 'https://api.anthropic.com/v1'
}

export async function complete({ model, system, user, signal }) {
  const key = (settings.llm?.claudeApiKey ?? '').trim()
  if (!key) {
    throw new Error('Claude API key missing. Set it in Settings → Cloud LLM Keys.')
  }

  const res = await fetch(`${claudeBase()}/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: 220,
      temperature: 0.6,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Claude ${res.status}: ${text.slice(0, 180) || res.statusText}`)
  }

  const data = await res.json()
  const textBlock = Array.isArray(data?.content)
    ? data.content.find(c => c?.type === 'text' && typeof c.text === 'string')
    : null
  const out = textBlock?.text
  if (typeof out !== 'string' || !out.trim()) {
    throw new Error('Claude: missing text response')
  }
  const inTok = Number(data?.usage?.input_tokens) || 0
  const outTok = Number(data?.usage?.output_tokens) || 0
  return {
    text: out,
    usage: {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: inTok + outTok,
    },
  }
}

export const claude = {
  complete,
  defaults: { model: 'claude-3-5-haiku-latest', displayName: 'Claude', requiresKey: true },
  models: CLAUDE_MODELS,
}
