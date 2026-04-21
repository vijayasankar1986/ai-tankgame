// llm/providers/stubs.js — Placeholder implementations for providers that
// aren't wired up yet. The UI lists them in the dropdown so users can see
// what's coming, but selecting one currently throws a friendly error that
// the LLMController logs to the side panel and then falls back to the
// scripted AI for that decision interval.

function notImplemented(name) {
  return async function stubComplete() {
    throw new Error(`${name} provider not wired up yet — fallback to scripted AI. See README for setup.`)
  }
}

export const openai = {
  complete: notImplemented('OpenAI'),
  defaults: { model: 'gpt-4o-mini', displayName: 'OpenAI', requiresKey: true },
  models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
}
export const claude = {
  complete: notImplemented('Claude'),
  defaults: { model: 'claude-3-5-haiku-latest', displayName: 'Claude', requiresKey: true },
  models: [
    'claude-3-5-haiku-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-7-sonnet-latest',
    'claude-sonnet-4-5',
    'claude-opus-4-1',
  ],
}
export const gemini = {
  complete: notImplemented('Gemini'),
  defaults: { model: 'gemini-1.5-flash', displayName: 'Gemini', requiresKey: true },
  models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
}
