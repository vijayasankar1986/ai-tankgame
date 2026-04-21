// main.js — Game loop, collision detection, orchestration
// Entry point for IRON WARFARE

import './style.css'
import { initTheme }                                     from './theme.js'
import { Tank }                                          from './Tank.js'
import { King }                                          from './King.js'
import { ParticleSystem }                                from './Particle.js'
import { UI }                                            from './UI.js'
import { createObstacles, drawObstacles, drawGround }    from './ObstacleMap.js'
import { HumanController }                               from './HumanController.js'
import { LLMController }                                 from './LLMController.js'
import { isLLMController }                               from './llm/providers/index.js'
import { settings, saveSettings, resetToDefaults }       from './Settings.js'
import { mountSettingsPanel }                            from './SettingsPanel.js'

initTheme()

// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas')
const ctx    = canvas.getContext('2d')
const W = 660, H = 460
canvas.width = W; canvas.height = H

// Match duration (ms) — derived from settings each fullReset()
let MATCH_DURATION_MS = settings.match.durationSec * 1000

// ── Game state ─────────────────────────────────────────────────────────────
let gameRunning     = false
let speedMultiplier = 1
let scoreRed        = 0
let scoreBlue       = 0
let roundNum        = 1
let animId
let simStep         = 0
let autoNextTimer   = null

// Match timer (counts down while gameRunning)
let matchTimeLeft   = MATCH_DURATION_MS
let lastFrameTs     = 0

const particles = new ParticleSystem()
const ui        = new UI()
let   obstacles = createObstacles()

// ── Factory: create tanks ──────────────────────────────────────────────────
function makeTanks() {
  const shared = {
    onBulletHitObstacle: (x, y, obstacle, destroyed) => {
      particles.spawn(x, y, '#888', destroyed ? 14 : 4)
      if (destroyed) {
        particles.spawn(obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2, '#ff8844', 22)
        ui.log('red',  'BLOCK DESTROYED', 'sys')
        ui.log('blue', 'BLOCK DESTROYED', 'sys')
      }
    },
  }

  const r = settings.teams.red
  const b = settings.teams.blue

  const red = new Tank({
    x: 80, y: H / 2,
    color: r.color, accentColor: r.accent,
    faction: r.name, isRed: true,
    aiConfig: { aggressionLevel: r.aggression, retreatHpThreshold: r.retreatHp },
    onLog: (f, msg, type) => ui.log(f, msg, type),
    ...shared,
  })

  const blue = new Tank({
    x: W - 80, y: H / 2,
    color: b.color, accentColor: b.accent,
    faction: b.name, isRed: false,
    aiConfig: { aggressionLevel: b.aggression, retreatHpThreshold: b.retreatHp },
    onLog: (f, msg, type) => ui.log(f, msg, type),
    ...shared,
  })

  red.canvasW  = blue.canvasW  = W
  red.canvasH  = blue.canvasH  = H

  return { red, blue }
}

let { red: redTank, blue: blueTank } = makeTanks()

// ── World snapshot builder (LLM prompt input) ─────────────────────────
// LLMControllers poll this closure every `llmInterval` seconds so the
// prompt always reflects the current tick — we purposefully read the
// module-level `redTank`/`blueTank`/`obstacles`/... bindings at call time
// so a settings-apply (which reassigns them) doesn't leave stale refs.
function snapTank(t) {
  return {
    x: t.x, y: t.y,
    hp: Math.round(t.hp), maxHp: t.maxHp,
    hitsTaken: t.hitsTaken, maxHits: t.maxHits,
  }
}
function snapKing(k) {
  return { x: k.x, y: k.y, hp: k.hp, maxHp: k.maxHp }
}
function getWorldFor(teamKey) {
  const isRed    = teamKey === 'red'
  const selfTank = isRed ? redTank  : blueTank
  const foeTank  = isRed ? blueTank : redTank
  const selfKing = isRed ? redKing  : blueKing
  const foeKing  = isRed ? blueKing : redKing
  return {
    mode:       settings.match.mode,
    self:       snapTank(selfTank),
    enemy:      snapTank(foeTank),
    timeLeftMs: matchTimeLeft,
    scoreSelf:  isRed ? scoreRed  : scoreBlue,
    scoreEnemy: isRed ? scoreBlue : scoreRed,
    selfKing:   selfKing ? snapKing(selfKing) : null,
    enemyKing:  foeKing  ? snapKing(foeKing)  : null,
    obstacles,
  }
}

// Replace `tank.ai` with an LLMController if the team's selected controller
// is an LLM provider. For 'auto' we leave the default scripted AIController
// that Tank built at construction time.
//
// Per-provider config lives under `settings.teams.<team>.agents.<provider>`,
// so switching between Ollama / OpenAI / Claude / Gemini preserves each
// provider's own model + interval + reasoning settings.
function wireAiControllers() {
  for (const teamKey of ['red', 'blue']) {
    const tank = teamKey === 'red' ? redTank : blueTank
    const t    = settings.teams[teamKey]
    if (!isLLMController(t.controller)) continue

    const agent = t.agents?.[t.controller] ?? {}
    tank.ai = new LLMController({
      providerId:        t.controller,
      model:             agent.model,
      intervalSec:       agent.intervalSec ?? 3,
      systemPromptExtra: agent.systemPromptExtra ?? '',
      aiConfig:          { aggressionLevel: t.aggression, retreatHpThreshold: t.retreatHp },
      teamKey,
      getWorld:          () => getWorldFor(teamKey),
      onThinking:        (d, meta) => {
        // Latency + call count in the log is the easiest way to SEE that
        // this is really Ollama and not the scripted FSM — the numbers
        // change every interval, and latency dips/spikes match real RTT.
        const ms      = Math.round(meta?.latencyMs ?? 0)
        const n       = meta?.callCount ?? 0
        const suffix  = agent.showReasoning && d.reasoning ? ` — ${d.reasoning}` : ''
        ui.log(teamKey,
          `[${t.controller.toUpperCase()} · ${agent.model} · #${n} · ${ms}ms] ${d.goal} (agg ${d.aggression.toFixed(2)})${suffix}`,
          'sys')
      },
      onError: (err) => {
        ui.log(teamKey,
          `[${t.controller.toUpperCase()}] ERR — ${String(err?.message || err).slice(0, 90)} · FALLBACK`,
          'danger')
      },
    })
  }
}
wireAiControllers()

// ── King factory (Protect-The-King mode) ──────────────────────────────
function makeKings() {
  const r = settings.teams.red
  const b = settings.teams.blue
  return {
    red:  new King({ x:  35, y: H / 2, color: r.color, accentColor: r.accent, name: r.name, isRed: true  }),
    blue: new King({ x: 625, y: H / 2, color: b.color, accentColor: b.accent, name: b.name, isRed: false }),
  }
}
let { red: redKing, blue: blueKing } = makeKings()

const isKingMode = () => settings.match.mode === 'king'

// ── Human controllers ──────────────────────────────────────────────────────
// Red = arrow keys (common single-player expectation). Blue = WASD so
// two humans on one keyboard do not fight over the same arrow cluster.
const redHuman = new HumanController({
  upKey: 'ArrowUp', downKey: 'ArrowDown', leftKey: 'ArrowLeft', rightKey: 'ArrowRight', fireKey: 'Space',
})
const blueHuman = new HumanController({
  upKey: 'KeyW', downKey: 'KeyS', leftKey: 'KeyA', rightKey: 'KeyD', fireKey: 'Enter',
})

redHuman.attachJoystick(
  document.getElementById('redJoyBase'),
  document.getElementById('redJoyKnob'),
  document.getElementById('redFireBtn'),
)
blueHuman.attachJoystick(
  document.getElementById('blueJoyBase'),
  document.getElementById('blueJoyKnob'),
  document.getElementById('blueFireBtn'),
)

// Label shown on the AI toggle button, derived from the team's current
// controller selection. For LLM providers we surface the provider name so
// the spectator knows "this isn't the scripted AI, this is Ollama talking".
function aiToggleLabel(teamKey) {
  const team = settings.teams[teamKey]
  const c = team.controller
  if (c === 'human') return 'HUMAN'
  if (c === 'auto')  return 'GAME ENGINER AUTO'
  const model = team.agents?.[c]?.model
  return model ? `AI: ${c.toUpperCase()} · ${model}` : `AI: ${c.toUpperCase()}`
}

function setAiActive(tank, human, isAi, toggleBtn, panelEl) {
  tank.humanController = isAi ? null : human
  panelEl.style.display = isAi ? 'none' : 'flex'
  const color   = tank.isRed ? 'red' : 'blue'
  const teamKey = tank.isRed ? 'red' : 'blue'
  toggleBtn.className   = `btn-ai-toggle ${color} ${isAi ? 'active' : 'inactive'}`
  toggleBtn.textContent = isAi ? aiToggleLabel(teamKey) : 'HUMAN MODE'
}

// Quick in-canvas human↔AI toggle. Flips the team's `controller` setting
// between 'human' and whatever non-human controller was previously
// selected (defaulting to 'auto' if there was none). When flipping to an
// LLM controller we also rebuild `tank.ai` so the LLM engages immediately.
function quickToggleController(teamKey, toggleBtn, panelEl) {
  const t = settings.teams[teamKey]
  if (t.controller === 'human') {
    t.controller = t._prevController || 'auto'
  } else {
    t._prevController = t.controller
    t.controller = 'human'
  }
  saveSettings()
  const tank  = teamKey === 'red' ? redTank  : blueTank
  const human = teamKey === 'red' ? redHuman : blueHuman
  wireAiControllers() // may swap in / out an LLMController
  setAiActive(tank, human, t.controller !== 'human', toggleBtn, panelEl)
}

document.getElementById('redAiToggle').addEventListener('click', e => {
  quickToggleController('red', e.currentTarget, document.getElementById('redJoyPanel'))
})

document.getElementById('blueAiToggle').addEventListener('click', e => {
  quickToggleController('blue', e.currentTarget, document.getElementById('blueJoyPanel'))
})

// ── Collision helpers ──────────────────────────────────────────────────────
// Swept point-vs-circle: did the bullet's last step pass within `radius` of (cx, cy)?
function bulletHitsTank(bullet, cx, cy, radius) {
  // Hit at the bullet's current position
  const cur = Math.hypot(bullet.x - cx, bullet.y - cy)
  if (cur < radius) return true

  // Hit somewhere along the previous step (segment vs circle)
  const ax = bullet.x - Math.cos(bullet.angle) * bullet.speed
  const ay = bullet.y - Math.sin(bullet.angle) * bullet.speed
  const dx = bullet.x - ax
  const dy = bullet.y - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return false
  const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2))
  const px = ax + dx * t
  const py = ay + dy * t
  return Math.hypot(px - cx, py - cy) < radius
}

// ── Collision: check if bullets from one tank hit the other ───────────────
// In king mode, tank destruction causes a respawn at spawn point instead
// of ending the round — only destroying the enemy king ends the match.
function respawnTank(tank, side) {
  const sx = side === 'red' ? 80 : W - 80
  tank.reset(sx, H / 2)
  particles.spawn(sx, H / 2, tank.color, 18)
  ui.log(side, 'RESPAWNED — HULL REPAIRED', 'sys')
}

function checkBulletHits(redFirst = true) {
  const king = isKingMode()
  const scanSide = (attacker, defender, attackerSide, defenderSide, defenderKing) => {
    attacker.bullets.forEach(b => {
      if (!b.active) return

      if (bulletHitsTank(b, defender.x, defender.y, 18)) {
        const dead = defender.takeDamage(b.damage)
        b.active = false
        particles.spawn(b.x, b.y, defenderSide === 'blue' ? '#44aaff' : '#ff4444', 10)
        ui.log(defenderSide, `HIT ${defender.hitsTaken} / ${defender.maxHits} — -${b.damage.toFixed(0)} HP`, 'hit')
        ui.log(attackerSide, `ENEMY HIT (${defender.hitsTaken}/${defender.maxHits})`, 'hit')
        if (dead) {
          if (king) respawnTank(defender, defenderSide)
          else      endRound(attackerSide)
        }
        return
      }

      if (king && defenderKing.alive && bulletHitsTank(b, defenderKing.x, defenderKing.y, defenderKing.radius)) {
        const kingDead = defenderKing.takeDamage(b.damage)
        b.active = false
        particles.spawn(b.x, b.y, defenderKing.color, kingDead ? 30 : 12)
        ui.log(defenderSide, `KING HIT — ${defenderKing.hp}/${defenderKing.maxHp} HP`, 'danger')
        ui.log(attackerSide, `ENEMY KING ${defenderKing.hp}/${defenderKing.maxHp} HP`, 'hit')
        if (kingDead) endRound(attackerSide, 'king')
      }
    })
  }

  if (redFirst) {
    scanSide(redTank,  blueTank, 'red',  'blue', blueKing)
    scanSide(blueTank, redTank,  'blue', 'red',  redKing)
  } else {
    scanSide(blueTank, redTank,  'blue', 'red',  redKing)
    scanSide(redTank,  blueTank, 'red',  'blue', blueKing)
  }
}

// ── HUD ────────────────────────────────────────────────────────────────────
function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function drawHUD() {
  const dist = Math.hypot(redTank.x - blueTank.x, redTank.y - blueTank.y)
  ctx.font      = '11px "Share Tech Mono"'
  ctx.fillStyle = '#c5d0e0'
  ctx.fillText(`RANGE: ${dist.toFixed(0)}px`, W / 2 - 40, H - 8)

  // Match-type indicator — bottom-left
  ctx.font      = 'bold 11px "Orbitron"'
  ctx.fillStyle = isKingMode() ? '#ffc107' : '#a8b8d0'
  ctx.fillText(isKingMode() ? '◆ PROTECT THE KING' : '◆ DEATHMATCH', 10, H - 8)

  // Countdown timer — top-center of canvas
  const timeStr = formatTime(matchTimeLeft)
  const warning = matchTimeLeft <= 10_000
  ctx.font      = 'bold 18px "Share Tech Mono"'
  ctx.textAlign = 'center'
  ctx.fillStyle = warning ? '#ff4444' : '#8fdcff'
  ctx.shadowColor = warning ? '#ff4444' : '#8fdcff'
  ctx.shadowBlur  = warning ? 12 : 6
  ctx.fillText(timeStr, W / 2, 22)
  ctx.shadowBlur = 0
  ctx.font      = '10px "Share Tech Mono"'
  ctx.fillStyle = '#8fa3bd'
  ctx.fillText('MATCH TIMER', W / 2, 34)
  ctx.textAlign = 'left'
}

// ── Main render/update loop ─────────────────────────────────────────────────
// Cap dt so a backgrounded tab (requestAnimationFrame paused) can't produce a
// huge delta that instantly drains the match timer on the next frame.
const MAX_FRAME_DT = 100 // ms

function gameLoop(ts) {
  const rawDt = lastFrameTs ? ts - lastFrameTs : 0
  const dt    = Math.min(rawDt, MAX_FRAME_DT)
  lastFrameTs = ts

  ctx.clearRect(0, 0, W, H)

  drawGround(ctx, W, H)
  drawObstacles(ctx, obstacles)

  // Draw kings BEFORE tanks so tanks can overlap them visually when close.
  if (isKingMode()) {
    redKing.draw(ctx)
    blueKing.draw(ctx)
  }

  if (gameRunning && redTank.alive && blueTank.alive) {
    matchTimeLeft -= dt
    if (matchTimeLeft <= 0) {
      matchTimeLeft = 0
      endRoundByTime()
    } else {
      for (let s = 0; s < speedMultiplier; s++) {
        const redFirst = (simStep++ % 2) === 0
        if (redFirst) {
          redTank.update(blueTank, obstacles)
          blueTank.update(redTank, obstacles)
        } else {
          blueTank.update(redTank, obstacles)
          redTank.update(blueTank, obstacles)
        }
        checkBulletHits(redFirst)
      }
    }
  }

  particles.update()
  particles.draw(ctx)

  redTank.bullets.forEach(b => b.draw(ctx))
  blueTank.bullets.forEach(b => b.draw(ctx))
  redTank.draw(ctx)
  blueTank.draw(ctx)
  drawHUD()

  ui.updateStats(redTank, blueTank)
  ui.updateScore(scoreRed, scoreBlue, roundNum)
  ui.updateTimer(matchTimeLeft)

  animId = requestAnimationFrame(gameLoop)
}

// ── Round management ───────────────────────────────────────────────────────
// Stop bullets mid-flight so they don't hang frozen on-screen after the round.
function clearBullets() {
  redTank.bullets.length  = 0
  blueTank.bullets.length = 0
}

function startNextRound() {
  ui.hideOverlay()
  roundNum++
  resetRound()
  gameRunning = true
  ui.log('red',  `ROUND ${roundNum} — DEPLOYING`, 'sys')
  ui.log('blue', `ROUND ${roundNum} — DEPLOYING`, 'sys')
}

function finishRound(winner, subtitle, header) {
  if (settings.match.autoNextRound) {
    ui.hideOverlay()
    // Small delay so round-end effects/logs remain visible briefly.
    if (autoNextTimer) clearTimeout(autoNextTimer)
    autoNextTimer = setTimeout(() => {
      autoNextTimer = null
      startNextRound()
    }, 350)
    return
  }
  ui.showWinner(winner, subtitle, header)
}

function endRound(winner, reason = 'tank') {
  gameRunning = false
  clearBullets()

  if (reason === 'king') {
    const loserKing = winner === 'red' ? blueKing : redKing
    particles.spawn(loserKing.x, loserKing.y, '#ff6600', 60)
    particles.spawn(loserKing.x, loserKing.y, '#ffc107', 30)
    if (winner === 'red') {
      scoreRed++
      ui.log('red',  'ENEMY KING DESTROYED — VICTORY', 'hit')
      ui.log('blue', 'KING FALLEN — DEFEAT',           'danger')
    } else {
      scoreBlue++
      ui.log('blue', 'ENEMY KING DESTROYED — VICTORY', 'hit')
      ui.log('red',  'KING FALLEN — DEFEAT',           'danger')
    }
    finishRound(winner, 'ENEMY KING DESTROYED', '◆ THE KING IS DEAD ◆')
    return
  }

  const loser = winner === 'red' ? blueTank : redTank
  particles.spawn(loser.x, loser.y, '#ff6600', 40)

  if (winner === 'red') {
    scoreRed++
    redTank.kills++
    ui.log('red',  'TARGET NEUTRALIZED — VICTORY', 'hit')
    ui.log('blue', 'HULL BREACH — DESTROYED',      'danger')
  } else {
    scoreBlue++
    blueTank.kills++
    ui.log('blue', 'TARGET NEUTRALIZED — VICTORY', 'hit')
    ui.log('red',  'HULL BREACH — DESTROYED',      'danger')
  }

  finishRound(winner, 'HULL INTEGRITY ZERO')
}

// Called when the 2-minute timer hits zero. Winner tiebreaker depends on mode.
function endRoundByTime() {
  gameRunning = false
  clearBullets()
  ui.log('red',  'TIME UP — MATCH ENDED', 'sys')
  ui.log('blue', 'TIME UP — MATCH ENDED', 'sys')

  // In king mode, whoever dealt more damage to the enemy king wins.
  if (isKingMode()) {
    const redKingLeft  = redKing.hp
    const blueKingLeft = blueKing.hp
    if (redKingLeft === blueKingLeft) {
      finishRound('draw', 'TIME UP — KINGS EQUAL', '◆ STALEMATE ◆')
      return
    }
    const winner = blueKingLeft < redKingLeft ? 'red' : 'blue'
    if (winner === 'red') scoreRed++; else scoreBlue++
    ui.log(winner,                  `TIME VICTORY — KINGS ${redKingLeft} vs ${blueKingLeft}`, 'hit')
    ui.log(winner === 'red' ? 'blue' : 'red', 'KING OUTLASTED — DEFEAT', 'danger')
    finishRound(winner,
      `TIME UP — ${winner === 'red' ? blueKingLeft : redKingLeft} HP LEFT ON ENEMY KING`,
      '◆ THE KING STANDS ◆')
    return
  }

  if (redTank.hp === blueTank.hp) {
    finishRound('draw', 'TIME UP — STALEMATE')
    return
  }

  const winner = redTank.hp > blueTank.hp ? 'red' : 'blue'
  if (winner === 'red') {
    scoreRed++
    ui.log('red',  `TIME VICTORY — HP ${redTank.hp} vs ${blueTank.hp}`, 'hit')
    ui.log('blue', 'OUTLASTED — DEFEAT', 'danger')
  } else {
    scoreBlue++
    ui.log('blue', `TIME VICTORY — HP ${blueTank.hp} vs ${redTank.hp}`, 'hit')
    ui.log('red',  'OUTLASTED — DEFEAT', 'danger')
  }
  finishRound(winner, `TIME UP — WINNER BY HP (${Math.max(redTank.hp, blueTank.hp)} HP)`)
}

// ── Button handlers ────────────────────────────────────────────────────────
document.getElementById('btnDeploy').addEventListener('click', () => {
  if (!gameRunning) {
    gameRunning = true
    ui.log('red',  'AI ONLINE — COMBAT INITIATED', 'sys')
    ui.log('blue', 'AI ONLINE — COMBAT INITIATED', 'sys')
  }
})

document.getElementById('btnReset').addEventListener('click', () => {
  fullReset()
  ui.log('red',  'SYSTEM RESET — STANDBY', 'sys')
  ui.log('blue', 'SYSTEM RESET — STANDBY', 'sys')
})

document.getElementById('btnSpeed').addEventListener('click', (e) => {
  speedMultiplier = speedMultiplier === 1 ? 2 : speedMultiplier === 2 ? 3 : 1
  e.target.textContent = `⚡ SPEED: ${speedMultiplier}×`
})

document.getElementById('btnNextRound').addEventListener('click', () => {
  startNextRound()
})

document.getElementById('btnRestartMatch').addEventListener('click', () => {
  fullReset()
  ui.log('red',  'MATCH RESTARTED — STANDBY', 'sys')
  ui.log('blue', 'MATCH RESTARTED — STANDBY', 'sys')
})

// Reset tanks + obstacles + timer, but keep scores/round number.
function resetRound() {
  particles.clear()
  obstacles = createObstacles()
  redTank.reset(80,      H / 2)
  blueTank.reset(W - 80, H / 2)
  redKing.reset()
  blueKing.reset()
  redHuman.reset()
  blueHuman.reset()
  matchTimeLeft = MATCH_DURATION_MS
}

// Full reset (RESET button): clear scores, round, timer, tanks, obstacles.
function fullReset() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer)
    autoNextTimer = null
  }
  gameRunning = false
  ui.hideOverlay()
  scoreRed = 0
  scoreBlue = 0
  roundNum = 1
  MATCH_DURATION_MS = settings.match.durationSec * 1000
  redTank.kills = 0
  blueTank.kills = 0
  resetRound()
}

// Rebuild tanks from current settings — called when the settings panel is
// applied. We tear down the existing tanks (with their hard-coded colors,
// fire rates, aggression, etc) and construct new ones reading from the
// updated `settings` object, then re-attach the existing human controllers
// so manual mode keeps working.
function applySettings() {
  ;({ red: redTank, blue: blueTank } = makeTanks())
  ;({ red: redKing, blue: blueKing } = makeKings())

  // Attach LLM controllers (if any) to the freshly-built tanks BEFORE
  // toggling the AI/human button so the label picks up the right name.
  wireAiControllers()

  // Honor team.controller selection from settings on a fresh apply
  // (overrides whatever the in-game quick toggle was set to).
  setAiActive(redTank,  redHuman,  settings.teams.red.controller  !== 'human',
    document.getElementById('redAiToggle'),
    document.getElementById('redJoyPanel'))
  setAiActive(blueTank, blueHuman, settings.teams.blue.controller !== 'human',
    document.getElementById('blueAiToggle'),
    document.getElementById('blueJoyPanel'))

  // Update live UI labels (team names, scoreboard captions) and refresh.
  ui.refreshTeamLabels(settings)

  fullReset()
}

// Mount the settings overlay — wires the gear button + panel inputs to
// settings.* mutations, calls applySettings() on Apply.
mountSettingsPanel({
  settings,
  saveSettings,
  resetToDefaults,
  onApply: () => {
    applySettings()
    ui.log('red',  'SETTINGS UPDATED — RELOADED', 'sys')
    ui.log('blue', 'SETTINGS UPDATED — RELOADED', 'sys')
  },
})

// ── Boot ───────────────────────────────────────────────────────────────────
ui.refreshTeamLabels(settings)

// Honor controller selection at boot — same path Apply takes.
setAiActive(redTank,  redHuman,  settings.teams.red.controller  !== 'human',
  document.getElementById('redAiToggle'),
  document.getElementById('redJoyPanel'))
setAiActive(blueTank, blueHuman, settings.teams.blue.controller !== 'human',
  document.getElementById('blueAiToggle'),
  document.getElementById('blueJoyPanel'))

ui.log('red',  `${settings.teams.red.name} UNIT INITIALIZED`,  'sys')
ui.log('blue', `${settings.teams.blue.name} UNIT INITIALIZED`, 'sys')
ui.log('red',  'AWAITING DEPLOY COMMAND...',  'sys')
ui.log('blue', 'AWAITING DEPLOY COMMAND...',  'sys')

requestAnimationFrame(gameLoop)
