// LLMController.js — Strategic LLM overlay on top of the scripted AIController.
//
// The per-frame `decide(...)` call is still O(1) — we never block the game
// loop on an LLM request. Instead, every `intervalSec` we fire an async
// call to the provider; when it resolves we stash the directive, and the
// next `decide()` blends it into the base FSM output.
//
// If the provider errors out or returns nonsense we keep the last good
// directive (or fall back to pure AI) and log a warning to the side log.

import { AIController, AI_STATE } from './AIController.js'
import { getProvider }            from './llm/providers/index.js'
import { SYSTEM_PROMPT, buildUserPrompt } from './llm/prompt.js'
import { parseDirective }         from './llm/schema.js'

export class LLMController {
  /**
   * @param {object} opts
   * @param {string} opts.providerId         'ollama' | 'openai' | 'claude' | 'gemini'
   * @param {string} opts.model              model name
   * @param {number} opts.intervalSec        seconds between LLM calls
   * @param {object} opts.aiConfig           forwarded to AIController fallback
   * @param {Function} opts.getWorld         () => rich world state for prompt
   * @param {string}   [opts.systemPromptExtra] user-authored instructions
   *                                           appended to the base system
   *                                           prompt (e.g. "be a sniper").
   * @param {Function} [opts.onThinking]     (directive, meta) => void
   *                                           meta = { latencyMs, callCount }
   * @param {Function} [opts.onError]        (error) => void
   * @param {string}   [opts.teamKey]        'red' | 'blue'
   */
  constructor(opts) {
    this.providerId  = opts.providerId
    this.model       = opts.model
    this.intervalSec = Math.max(0.5, opts.intervalSec ?? 3)
    this.getWorld    = opts.getWorld ?? (() => ({}))
    this.onThinking  = opts.onThinking ?? (() => {})
    this.onError     = opts.onError    ?? (() => {})
    this.teamKey     = opts.teamKey    ?? 'red'
    this.systemPromptExtra = (opts.systemPromptExtra ?? '').trim()

    this.ai = new AIController(opts.aiConfig ?? {})
    this._baseAggression = this.ai.aggressionLevel

    // Observability — read by Tank/UI to prove the LLM is actually live
    // (call count ticks up, inFlight flashes during network RTT,
    // lastLatencyMs shows real response times).
    this.isLLM          = true
    this.callCount      = 0
    this.lastLatencyMs  = 0
    this.inFlight       = false
    this.lastError      = null

    this.currentDirective = null
    this._lastTickTs      = 0
    this._firstTickFired  = false
    this._nextAllowedTickTs = 0
    this._errorBackoffMs    = 0
    this._lastErrorKey      = ''
    this._lastErrorLogTs    = 0
  }

  // Proxy a few AIController fields so Tank.js keeps working unchanged.
  get state()        { return this.ai.state }
  get lastSensors()  { return this.ai.lastSensors }

  decide(self, enemy, obstacles) {
    const base = this.ai.decide(self, enemy, obstacles)
    this._maybeTick()
    return this._applyDirective(base, self, enemy)
  }

  reset() {
    this.ai.reset()
    this.ai.aggressionLevel = this._baseAggression
    this.currentDirective = null
    this._lastTickTs = 0
    this._firstTickFired = false
    this._nextAllowedTickTs = 0
    this._errorBackoffMs = 0
    this._lastErrorKey = ''
    this._lastErrorLogTs = 0
  }

  // ── Internal ──────────────────────────────────────────────────────────
  _maybeTick() {
    if (this.inFlight) return
    const now = performance.now()
    if (now < this._nextAllowedTickTs) return
    const due = !this._firstTickFired || (now - this._lastTickTs) >= this.intervalSec * 1000
    if (!due) return
    this._firstTickFired = true
    this._lastTickTs = now
    this.inFlight = true
    this._requestDirective()
      .catch(err => {
        this.lastError = err
        const errText = String(err?.message || err)
        const errKey = errText.slice(0, 140)
        const nowMs = performance.now()
        const shouldLog = errKey !== this._lastErrorKey || (nowMs - this._lastErrorLogTs) > 12_000
        if (shouldLog) {
          this.onError(err)
          this._lastErrorLogTs = nowMs
          this._lastErrorKey = errKey
        }
        this._errorBackoffMs = this._errorBackoffMs
          ? Math.min(this._errorBackoffMs * 2, 20_000)
          : 2_000
        this._nextAllowedTickTs = nowMs + this._errorBackoffMs
      })
      .finally(() => { this.inFlight = false })
  }

  _composedSystemPrompt() {
    if (!this.systemPromptExtra) return SYSTEM_PROMPT
    // Append user-authored personality/strategy instructions AFTER the
    // base protocol rules, so the JSON output contract still dominates.
    return `${SYSTEM_PROMPT}\n\n--- TEAM-SPECIFIC INSTRUCTIONS ---\n${this.systemPromptExtra}`
  }

  async _requestDirective() {
    const world = this.getWorld()
    const user  = buildUserPrompt({ teamKey: this.teamKey, ...world })
    const { complete } = getProvider(this.providerId)

    const t0 = performance.now()
    const raw = await complete({
      model:  this.model,
      system: this._composedSystemPrompt(),
      user,
    })
    const latencyMs = performance.now() - t0

    const directive = parseDirective(raw)
    this.currentDirective = directive
    this.lastLatencyMs    = latencyMs
    this.callCount       += 1
    this.lastError        = null
    this._errorBackoffMs  = 0
    this._nextAllowedTickTs = 0
    this._lastErrorKey    = ''
    this._lastErrorLogTs  = 0
    // Apply aggression override for scripted fallback behavior too.
    this.ai.aggressionLevel = directive.aggression
    this.onThinking(directive, { latencyMs, callCount: this.callCount })
  }

  _applyDirective(base, self, enemy) {
    const w = this.getWorld()
    const d = this.currentDirective
    // Before the first directive arrives, keep movement from the scripted
    // fallback but make turret objective-aware in king mode.
    if (!d) {
      if (w.mode === 'king' && w.enemyKing && (w.enemyKing.hp === undefined || w.enemyKing.hp > 0)) {
        return {
          ...base,
          aimAt: Math.atan2(w.enemyKing.y - self.y, w.enemyKing.x - self.x),
        }
      }
      return base
    }

    const out = { ...base }
    const angToEnemy = Math.atan2(enemy.y - self.y, enemy.x - self.x)
    // In king mode, objective-first default is to aim enemy king unless
    // the directive explicitly overrides aim.
    let aimTarget = d.aim || (w.mode === 'king' ? 'ENEMY_KING' : 'ENEMY_TANK')

    switch (d.goal) {
      case 'ADVANCE':
        out.moveDir  = angToEnemy
        out.state    = AI_STATE.ADVANCE
        break
      case 'ATTACK':
        out.state    = AI_STATE.ATTACK
        // keep base moveDir — scripted AI already orbits in ATTACK
        break
      case 'FLANK_LEFT':
        out.moveDir  = angToEnemy - Math.PI / 2
        out.state    = AI_STATE.STRAFE
        break
      case 'FLANK_RIGHT':
        out.moveDir  = angToEnemy + Math.PI / 2
        out.state    = AI_STATE.STRAFE
        break
      case 'RETREAT':
        out.moveDir  = angToEnemy + Math.PI
        out.state    = AI_STATE.RETREAT
        break
      case 'HOLD':
        out.moveDir  = null
        out.state    = AI_STATE.SEEK
        break
      case 'PURSUE_KING': {
        const w = this.getWorld()
        const k = w.enemyKing
        if (k && (k.hp === undefined || k.hp > 0)) {
          const a = Math.atan2(k.y - self.y, k.x - self.x)
          out.moveDir = a
          aimTarget   = 'ENEMY_KING'
          out.state   = AI_STATE.ADVANCE
        }
        break
      }
      case 'DEFEND_KING': {
        const w = this.getWorld()
        const k = w.selfKing
        if (k) {
          const a = Math.atan2(k.y - self.y, k.x - self.x)
          out.moveDir = a
          out.state   = AI_STATE.RETREAT
        }
        break
      }
      default:
        break
    }

    // Body faces movement direction (same convention as AIController).
    if (out.moveDir !== null && out.moveDir !== undefined) {
      out.rotateTo = out.moveDir
    }

    // Turret aim selection is agent-driven (not hardcoded to enemy tank).
    // If a target doesn't exist (e.g. king destroyed), fall back safely.
    switch (aimTarget) {
      case 'ENEMY_KING':
        if (w.enemyKing && (w.enemyKing.hp === undefined || w.enemyKing.hp > 0)) {
          out.aimAt = Math.atan2(w.enemyKing.y - self.y, w.enemyKing.x - self.x)
          break
        }
        out.aimAt = angToEnemy
        break
      case 'SELF_KING':
        if (w.selfKing) {
          out.aimAt = Math.atan2(w.selfKing.y - self.y, w.selfKing.x - self.x)
          break
        }
        out.aimAt = angToEnemy
        break
      case 'MOVE_DIR':
        out.aimAt = out.moveDir ?? out.rotateTo ?? angToEnemy
        break
      case 'ENEMY_TANK':
      default:
        out.aimAt = angToEnemy
        break
    }

    // Trigger discipline: let the agent choose whether this decision window
    // should prioritize tank kills or king damage.
    //
    // AUTO keeps the scripted AI's shoot bool. For explicit targets we
    // recalc a local "should shoot" using the current turret angle window.
    const shootTarget = d.shootTarget || 'AUTO'
    if (shootTarget !== 'AUTO') {
      const shootFor = (tx, ty) => {
        const dist = Math.hypot(self.x - tx, self.y - ty)
        const angleTo = Math.atan2(ty - self.y, tx - self.x)
        const turretDiff = Math.abs(
          Math.atan2(
            Math.sin(angleTo - self.turretAngle),
            Math.cos(angleTo - self.turretAngle)
          )
        )
        return dist < this.ai.shootRange && turretDiff < this.ai.aimTolerance
      }

      if (shootTarget === 'ENEMY_KING' && w.enemyKing && (w.enemyKing.hp === undefined || w.enemyKing.hp > 0)) {
        out.shoot = shootFor(w.enemyKing.x, w.enemyKing.y)
      } else if (shootTarget === 'ENEMY_TANK') {
        out.shoot = shootFor(enemy.x, enemy.y)
      } else {
        // Missing requested target (e.g. king already dead) → do not spray.
        out.shoot = false
      }
    }
    return out
  }
}
