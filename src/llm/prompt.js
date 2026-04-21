// llm/prompt.js — System prompt + compact state serializer.
//
// Philosophy: we send the smallest possible board summary the LLM needs to
// make a strategic call. Think "chess notation for tanks", not "every pixel".
// Keeping the prompt tiny controls both latency and token cost.

import { GOALS, AIM_TARGETS, SHOOT_TARGETS } from './schema.js'

export const SYSTEM_PROMPT = `You are piloting a tank in a 1v1 arena battle. You output STRATEGIC goals every few seconds; a lower-level controller handles steering and aim.

Arena: 660 x 460 pixels. Origin (0,0) is top-left. +x is right, +y is down.
You will be told which team you are ("RED" or "BLUE") and the current match mode.

Modes:
- DEATHMATCH: destroy the enemy tank. Tanks die after a fixed number of hits.
- KING: there are two "kings" (large stationary units). First to destroy the enemy king wins. Tanks respawn when killed, kings do not.

You MUST respond with a single JSON object — no prose, no markdown fences — matching exactly:
{
  "goal": "<one of: ${GOALS.join(' | ')}>",
  "aggression": <number between 0.0 and 1.0>,
  "aim": "<one of: ${AIM_TARGETS.join(' | ')}>",
  "shootTarget": "<one of: ${SHOOT_TARGETS.join(' | ')}>",
  "reasoning": "<short, one sentence>"
}

Goal semantics:
- ADVANCE      — drive straight at the enemy tank
- ATTACK       — stay mid-range, orbit, fire from cover
- FLANK_LEFT   — circle to the enemy's left side
- FLANK_RIGHT  — circle to the enemy's right side
- RETREAT      — back off toward a safer zone (pick when low HP)
- HOLD         — stop moving, dig in behind cover
- PURSUE_KING  — ignore enemy tank, push toward enemy king (KING mode only)
- DEFEND_KING  — fall back and guard own king (KING mode only)

aggression: 0.0 = hide and heal, 0.5 = measured, 1.0 = full send.
aim:
- ENEMY_TANK (default): turret tracks enemy tank
- ENEMY_KING: turret tracks enemy king (KING mode usually)
- SELF_KING: turret points back at own king (defensive posture)
- MOVE_DIR: turret points where the hull is moving
shootTarget:
- AUTO: keep scripted trigger behavior
- ENEMY_TANK: fire only when enemy tank has a clean firing window
- ENEMY_KING: fire only when enemy king has a clean firing window
reasoning: one short sentence for a human spectator log. <= 120 chars.`

/**
 * Build a compact string state for the LLM. Keep it small.
 *
 * @param {object} ctx
 * @param {string} ctx.teamKey    'red' | 'blue'
 * @param {string} ctx.mode       'deathmatch' | 'king'
 * @param {object} ctx.self       { x, y, hp, maxHp, hitsTaken, maxHits }
 * @param {object} ctx.enemy      { x, y, hp, maxHp, hitsTaken, maxHits }
 * @param {number} ctx.timeLeftMs
 * @param {number} [ctx.scoreSelf]
 * @param {number} [ctx.scoreEnemy]
 * @param {object} [ctx.selfKing]   { x, y, hp, maxHp }
 * @param {object} [ctx.enemyKing]  { x, y, hp, maxHp }
 * @param {Array}  [ctx.obstacles]  obstacle list (only live ones are serialized)
 */
export function serializeState(ctx) {
  const {
    teamKey, mode, self, enemy, timeLeftMs,
    scoreSelf = 0, scoreEnemy = 0,
    selfKing, enemyKing, obstacles = [],
  } = ctx

  const xy = (p) => `(${Math.round(p.x)},${Math.round(p.y)})`

  const dist   = Math.round(Math.hypot(self.x - enemy.x, self.y - enemy.y))
  const bearing = bearingToCompass(self, enemy)
  const timeStr = `${Math.ceil(timeLeftMs / 1000)}s`

  // Live obstacles only — quantize to a 6x4 grid heatmap so the LLM gets
  // "where cover is" without drowning in exact rectangles.
  const grid = occupancyGrid(obstacles, 6, 4)

  const lines = [
    `TEAM: ${teamKey.toUpperCase()}`,
    `MODE: ${mode.toUpperCase()}`,
    `TIME_LEFT: ${timeStr}`,
    `SCORE: self=${scoreSelf} enemy=${scoreEnemy}`,
    `SELF: pos=${xy(self)} hp=${self.hp}/${self.maxHp} hits=${self.hitsTaken}/${self.maxHits}`,
    `ENEMY: pos=${xy(enemy)} hp=${enemy.hp}/${enemy.maxHp} hits=${enemy.hitsTaken}/${enemy.maxHits}`,
    `ENEMY_DIST: ${dist}px (${bearing})`,
  ]

  if (mode === 'king') {
    if (selfKing)  lines.push(`SELF_KING:  pos=${xy(selfKing)}  hp=${selfKing.hp}/${selfKing.maxHp} alive=${selfKing.hp > 0}`)
    if (enemyKing) lines.push(`ENEMY_KING: pos=${xy(enemyKing)} hp=${enemyKing.hp}/${enemyKing.maxHp} alive=${enemyKing.hp > 0}`)
  }

  lines.push(`COVER_GRID_6x4 (# = wall, . = open, from top row to bottom):`)
  grid.forEach(row => lines.push('  ' + row))

  lines.push(`Return the JSON directive only.`)
  return lines.join('\n')
}

function bearingToCompass(from, to) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x)
  const deg = (ang * 180 / Math.PI + 360) % 360
  const dirs = ['E','SE','S','SW','W','NW','N','NE']
  return dirs[Math.round(deg / 45) % 8]
}

function occupancyGrid(obstacles, cols, rows) {
  const W = 660, H = 460
  const cellW = W / cols
  const cellH = H / rows
  const grid = Array.from({ length: rows }, () => Array(cols).fill(false))
  for (const o of obstacles) {
    if (o.hp !== undefined && o.hp <= 0) continue
    const c0 = Math.max(0, Math.floor(o.x / cellW))
    const c1 = Math.min(cols - 1, Math.floor((o.x + o.w) / cellW))
    const r0 = Math.max(0, Math.floor(o.y / cellH))
    const r1 = Math.min(rows - 1, Math.floor((o.y + o.h) / cellH))
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) grid[r][c] = true
  }
  return grid.map(row => row.map(v => v ? '#' : '.').join(''))
}

/** Build the user prompt string by combining state with a short instruction. */
export function buildUserPrompt(ctx) {
  return serializeState(ctx)
}
