// llm/schema.js — Directive JSON schema produced by an LLM tank pilot.
//
// The LLM is a *strategic* advisor. It runs every few seconds and returns a
// compact directive that overrides parts of the scripted AIController's
// state-machine decisions. Low-level steering, collision avoidance, aiming
// and firing are still handled by the existing code, so one slow or flaky
// LLM call never causes the tank to freeze or crash.

export const GOALS = Object.freeze([
  'ADVANCE',      // close on enemy tank directly
  'ATTACK',       // hold mid range and fire
  'FLANK_LEFT',   // strafe left of enemy
  'FLANK_RIGHT',  // strafe right of enemy
  'RETREAT',      // back off to heal / regroup
  'HOLD',         // stop moving (stay behind cover)
  'PURSUE_KING',  // ignore enemy tank, race toward enemy king (king mode only)
  'DEFEND_KING',  // fall back and guard own king (king mode only)
])
export const AIM_TARGETS = Object.freeze([
  'ENEMY_TANK',
  'ENEMY_KING',
  'SELF_KING',
  'MOVE_DIR',     // where the hull is driving
])
export const SHOOT_TARGETS = Object.freeze([
  'AUTO',         // keep scripted shoot boolean
  'ENEMY_TANK',   // only pull trigger for enemy tank window
  'ENEMY_KING',   // only pull trigger for enemy king window
])

/**
 * Validate and coerce a raw parsed JSON object into a safe directive.
 * Anything malformed falls back to sensible defaults so the game never
 * breaks on a bad LLM response.
 *
 * @param {any} raw
 * @returns {{goal: string, aggression: number, aim: string, shootTarget: string, reasoning: string}}
 */
export function sanitizeDirective(raw) {
  const out = {
    goal: 'ATTACK',
    aggression: 0.6,
    aim: 'ENEMY_TANK',
    shootTarget: 'AUTO',
    reasoning: '',
  }
  if (!raw || typeof raw !== 'object') return out

  if (typeof raw.goal === 'string') {
    const g = raw.goal.toUpperCase().trim()
    if (GOALS.includes(g)) out.goal = g
  }

  if (typeof raw.aggression === 'number' && Number.isFinite(raw.aggression)) {
    // Keep a small floor so one bad directive can't force fully passive AI.
    out.aggression = Math.max(0.15, Math.min(1, raw.aggression))
  }

  if (typeof raw.aim === 'string') {
    const a = raw.aim.toUpperCase().trim()
    if (AIM_TARGETS.includes(a)) out.aim = a
  }

  if (typeof raw.shootTarget === 'string') {
    const s = raw.shootTarget.toUpperCase().trim()
    if (SHOOT_TARGETS.includes(s)) out.shootTarget = s
  }

  if (typeof raw.reasoning === 'string') {
    // Keep reasoning short enough to fit in the side log (~120 chars).
    out.reasoning = raw.reasoning.trim().slice(0, 160)
  }

  return out
}

/**
 * Parse a raw LLM completion string as JSON, then sanitize. Tolerant to
 * providers that wrap JSON in ```json fences or include prose.
 */
export function parseDirective(raw) {
  if (typeof raw !== 'string') return sanitizeDirective(raw)

  let text = raw.trim()
  // Strip ``` fences if the model added them.
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  }

  // Find the first {...} block — some providers prepend a prose sentence.
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1)
  }

  try {
    return sanitizeDirective(JSON.parse(text))
  } catch {
    return sanitizeDirective(null)
  }
}
