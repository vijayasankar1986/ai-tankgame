import { settings } from '../../Settings.js'

const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini']

function openaiBase() {
  return 'https://api.openai.com/v1'
}

export async function complete({ model, system, user, signal }) {
  const key = (settings.llm?.openaiApiKey ?? '').trim()
  if (!key) {
    throw new Error('OpenAI API key missing. Set it in Settings → Cloud LLM Keys.')
  }

  const res = await fetch(`${openaiBase()}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 180) || res.statusText}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI: missing text response')
  }
  const inTok = Number(data?.usage?.prompt_tokens) || 0
  const outTok = Number(data?.usage?.completion_tokens) || 0
  const totalTok = Number(data?.usage?.total_tokens) || (inTok + outTok)
  return {
    text: content,
    usage: {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: totalTok,
    },
  }
}

export const openai = {
  complete,
  defaults: { model: 'gpt-4o-mini', displayName: 'OpenAI', requiresKey: true },
  models: OPENAI_MODELS,
}
