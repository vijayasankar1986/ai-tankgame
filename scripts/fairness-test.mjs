// Headless fairness harness: run mirrored AI-vs-AI rounds and report win split.
// Usage:
//   node scripts/fairness-test.mjs --rounds 100
//   node scripts/fairness-test.mjs --rounds 200 --layout maze --duration 120

globalThis.localStorage = {
  getItem() { return null },
  setItem() {},
  removeItem() {},
}

const { settings } = await import('../src/Settings.js')
const { Tank } = await import('../src/Tank.js')
const { createObstacles } = await import('../src/ObstacleMap.js')

const W = 660
const H = 460

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}

const rounds = Math.max(1, Number(arg('rounds', '100')) || 100)
const layout = String(arg('layout', settings.battlefield.layout || 'default'))
const durationSec = Math.max(5, Number(arg('duration', String(settings.match.durationSec || 120))) || 120)

settings.match.mode = 'deathmatch'
settings.match.durationSec = durationSec
settings.battlefield.layout = layout

// Mirror fairness test: both teams use identical behavior knobs.
const base = {
  aggression: 0.62,
  retreatHp: 25,
  fireRate: 58,
}
settings.teams.red.aggression = base.aggression
settings.teams.blue.aggression = base.aggression
settings.teams.red.retreatHp = base.retreatHp
settings.teams.blue.retreatHp = base.retreatHp
settings.teams.red.fireRate = base.fireRate
settings.teams.blue.fireRate = base.fireRate

function makeTanks() {
  const red = new Tank({
    x: 80, y: H / 2,
    color: '#ff4444',
    accentColor: '#7a1111',
    faction: 'ALPHA',
    isRed: true,
    aiConfig: { aggressionLevel: settings.teams.red.aggression, retreatHpThreshold: settings.teams.red.retreatHp },
  })
  const blue = new Tank({
    x: W - 80, y: H / 2,
    color: '#44aaff',
    accentColor: '#114477',
    faction: 'BRAVO',
    isRed: false,
    aiConfig: { aggressionLevel: settings.teams.blue.aggression, retreatHpThreshold: settings.teams.blue.retreatHp },
  })
  red.shootInterval = settings.teams.red.fireRate
  blue.shootInterval = settings.teams.blue.fireRate
  red.canvasW = blue.canvasW = W
  red.canvasH = blue.canvasH = H
  return { red, blue }
}

function bulletHitsTank(bullet, cx, cy, radius) {
  const cur = Math.hypot(bullet.x - cx, bullet.y - cy)
  if (cur < radius) return true
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

function scanHits(attacker, defender) {
  for (const b of attacker.bullets) {
    if (!b.active) continue
    if (bulletHitsTank(b, defender.x, defender.y, 18)) {
      const dead = defender.takeDamage(b.damage)
      b.active = false
      if (dead) return true
    }
  }
  return false
}

function runRound(startStep) {
  const { red, blue } = makeTanks()
  const obstacles = createObstacles()
  const maxFrames = durationSec * 60
  let simStep = startStep

  for (let frame = 0; frame < maxFrames; frame++) {
    const redFirst = (simStep++ % 2) === 0
    if (redFirst) {
      red.update(blue, obstacles)
      blue.update(red, obstacles)
    } else {
      blue.update(red, obstacles)
      red.update(blue, obstacles)
    }

    let winner = null
    if (redFirst) {
      if (scanHits(red, blue)) winner = 'red'
      if (!winner && scanHits(blue, red)) winner = 'blue'
    } else {
      if (scanHits(blue, red)) winner = 'blue'
      if (!winner && scanHits(red, blue)) winner = 'red'
    }
    if (winner) return winner
  }

  if (red.hp === blue.hp) return 'draw'
  return red.hp > blue.hp ? 'red' : 'blue'
}

const out = { red: 0, blue: 0, draw: 0 }
for (let i = 0; i < rounds; i++) {
  const winner = runRound(i)
  out[winner]++
}

const pct = (n) => `${((n / rounds) * 100).toFixed(1)}%`
console.log(`Fairness test complete (${rounds} rounds)`)
console.log(`Layout: ${layout}, mode: deathmatch, duration: ${durationSec}s`)
console.log(`Red wins : ${out.red} (${pct(out.red)})`)
console.log(`Blue wins: ${out.blue} (${pct(out.blue)})`)
console.log(`Draws    : ${out.draw} (${pct(out.draw)})`)

