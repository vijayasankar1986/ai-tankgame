import { settings } from '../../Settings.js'

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
]

function geminiBase() {
  return 'https://generativelanguage.googleapis.com/v1beta'
}

export async function complete({ model, system, user, signal }) {
  const key = (settings.llm?.geminiApiKey ?? '').trim()
  if (!key) {
    throw new Error('Gemini API key missing. Set it in Settings → Cloud LLM Keys.')
  }

  const normalize = (m) => {
    if (m === 'gemini-1.5-flash') return 'gemini-1.5-flash-latest'
    if (m === 'gemini-1.5-pro') return 'gemini-1.5-pro-latest'
    return m
  }
  const candidates = [...new Set([
    model,
    normalize(model),
    'gemini-2.0-flash',
    'gemini-2.5-flash',
  ].filter(Boolean))]

  let lastErr = null
  for (const candidate of candidates) {
    const url = `${geminiBase()}/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 220,
          responseMimeType: 'application/json',
        },
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: user }],
        }],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // Some Gemini model ids are retired; try next fallback model on 404.
      if (res.status === 404) {
        lastErr = new Error(`Gemini ${res.status}: model "${candidate}" not found`)
        continue
      }
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 180) || res.statusText}`)
    }

    const data = await res.json()
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof out !== 'string' || !out.trim()) {
      throw new Error(`Gemini: missing text response from "${candidate}"`)
    }
    const inTok = Number(data?.usageMetadata?.promptTokenCount) || 0
    const outTok = Number(data?.usageMetadata?.candidatesTokenCount) || 0
    const totalTok = Number(data?.usageMetadata?.totalTokenCount) || (inTok + outTok)
    return {
      text: out,
      usage: {
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: totalTok,
      },
    }
  }

  throw lastErr || new Error('Gemini: no usable model response')
}

export const gemini = {
  complete,
  defaults: { model: 'gemini-2.0-flash', displayName: 'Gemini', requiresKey: true },
  models: GEMINI_MODELS,
}
