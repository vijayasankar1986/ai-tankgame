// Tank.js — Tank entity: physics, rendering, shooting, damage

import { Bullet } from './Bullet.js'
import { AIController } from './AIController.js'
import { collidesWithObstacles } from './ObstacleMap.js'
import { settings } from './Settings.js'

export class Tank {
  /**
   * @param {object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.color         primary hex color
   * @param {string} opts.accentColor   darker shade
   * @param {string} opts.faction       display name
   * @param {boolean} opts.isRed
   * @param {object} opts.aiConfig      passed to AIController
   * @param {Function} opts.onLog       (faction, msg, type) => void
   * @param {Function} opts.onBulletHitObstacle  (x, y) => void
   */
  constructor(opts) {
    this.x            = opts.x
    this.y            = opts.y
    this.color        = opts.color
    this.accentColor  = opts.accentColor
    this.faction      = opts.faction
    this.isRed        = opts.isRed
    this.onLog        = opts.onLog        ?? (() => {})
    this.onHitObstacle = opts.onBulletHitObstacle ?? (() => {})

    const teamCfg = opts.isRed ? settings.teams.red : settings.teams.blue
    this.angle        = opts.isRed ? 0 : Math.PI
    this.turretAngle  = opts.isRed ? 0 : Math.PI
    this.hp           = settings.tank.hp
    this.maxHp        = settings.tank.hp
    this.maxHits      = settings.tank.maxHits
    this.hitsTaken    = 0
    this.speed        = settings.tank.speed
    this.shootCooldown = 0
    this.shootInterval = teamCfg.fireRate
    this.kills        = 0

    this.bullets         = []
    this.ai              = new AIController(opts.aiConfig ?? {})
    this.humanController = null

    // Track lug animation — advances when the tank moves so the wheels
    // visually "roll" in the direction of travel.
    this._trackOffset = 0

    // Canvas dimensions — set before first update
    this.canvasW = 660
    this.canvasH = 460

    // Generic anti-stuck driver (works for scripted AI + LLM controller).
    // If movement intent exists but the body barely moves for a short burst,
    // we force a brief perpendicular escape vector to break wall/corner locks.
    this._stuckFrames   = 0
    this._unstickFrames = 0
    this._unstickDir    = 1
  }

  get alive()        { return this.hp > 0 }
  get controlState() { return this.humanController ? 'HUMAN' : this.ai.state }

  /**
   * Main update tick.
   * @param {Tank} enemy
   * @param {Array} obstacles
   */
  update(enemy, obstacles) {
    if (!this.alive) return

    this.shootCooldown = Math.max(0, this.shootCooldown - 1)

    // Ask controller (AI or human) for decision
    const controller = this.humanController ?? this.ai
    const decision = controller.decide(
      { x: this.x, y: this.y, hp: this.hp, angle: this.angle, turretAngle: this.turretAngle },
      { x: enemy.x, y: enemy.y, hp: enemy.hp },
      obstacles
    )

    // Tank-vs-tank: bodies are ~28×20, so any closer than ~26 px between
    // centers means we'd clip into the other tank.
    const TANK_BODY_RADIUS = 14
    const MIN_TANK_SEPARATION = TANK_BODY_RADIUS * 2 - 2 // small overlap forgiveness
    const blocksTank = (nx, ny) =>
      enemy.alive && Math.hypot(nx - enemy.x, ny - enemy.y) < MIN_TANK_SEPARATION
    const blocked = (nx, ny) =>
      collidesWithObstacles(nx, ny, TANK_BODY_RADIUS, obstacles) || blocksTank(nx, ny)

    // Apply movement
    const startX = this.x
    const startY = this.y
    let moveDir = decision.moveDir
    if (this._unstickFrames > 0 && moveDir !== null) {
      this._unstickFrames--
      moveDir = moveDir + Math.PI / 2 * this._unstickDir
      decision.rotateTo = moveDir
    }

    if (moveDir !== null) {
      const spd = this.speed * (decision.speedMult ?? 1)
      const nx  = this.x + Math.cos(moveDir) * spd
      const ny  = this.y + Math.sin(moveDir) * spd
      if (!blocked(nx, ny)) {
        this.x = nx
        this.y = ny
      } else {
        // Try sliding along each axis independently
        const nx2 = this.x + Math.cos(moveDir) * spd
        const ny2 = this.y
        const nx3 = this.x
        const ny3 = this.y + Math.sin(moveDir) * spd
        if (!blocked(nx2, ny2)) {
          this.x = nx2
        } else if (!blocked(nx3, ny3)) {
          this.y = ny3
        }
      }
    }

    // If controller requested movement but the tank didn't go anywhere,
    // accumulate "stuck frames" and occasionally force a short escape burst.
    if (moveDir !== null) {
      const moved = Math.hypot(this.x - startX, this.y - startY)
      if (moved < 0.25) {
        this._stuckFrames++
        if (this._stuckFrames > 14 && this._unstickFrames <= 0) {
          this._unstickFrames = 12
          this._unstickDir = Math.random() < 0.5 ? -1 : 1
          this._stuckFrames = 0
          this.onLog(this.isRed ? 'red' : 'blue', 'AUTO-UNSTICK MANEUVER', 'sys')
        }
      } else {
        this._stuckFrames = 0
      }
    } else {
      this._stuckFrames = 0
    }

    // Roll the tracks based on how far the body moved along its facing.
    if (decision.moveDir !== null) {
      const dx = this.x - startX
      const dy = this.y - startY
      // Project the actual movement vector onto the body's forward axis so
      // the track lugs roll forward when going forward and backward when
      // sliding in reverse.
      const forward = Math.cos(this.angle) * dx + Math.sin(this.angle) * dy
      this._trackOffset = (this._trackOffset + forward + 5000) % 5
    }

    // Failsafe: if we're already overlapping the enemy (e.g. spawned close,
    // bumped on a slide), nudge straight away from them so they unstick.
    if (enemy.alive) {
      const dx = this.x - enemy.x
      const dy = this.y - enemy.y
      const d  = Math.hypot(dx, dy)
      if (d > 0 && d < MIN_TANK_SEPARATION) {
        const push = (MIN_TANK_SEPARATION - d) / 2
        this.x += (dx / d) * push
        this.y += (dy / d) * push
      }
    }

    // Apply rotation (smooth lerp)
    if (decision.rotateTo !== null) {
      const diff = Math.atan2(
        Math.sin(decision.rotateTo - this.angle),
        Math.cos(decision.rotateTo - this.angle)
      )
      this.angle += diff * 0.06
    }

    // Turret always tracks enemy
    const turretDiff = decision.aimAt - this.turretAngle
    this.turretAngle += Math.atan2(Math.sin(turretDiff), Math.cos(turretDiff)) * 0.08

    // Shoot
    if (decision.shoot && this.shootCooldown <= 0) {
      this._shoot(obstacles)
    }

    // Clamp to canvas
    this.x = Math.max(20, Math.min(this.canvasW - 20, this.x))
    this.y = Math.max(20, Math.min(this.canvasH - 20, this.y))

    // Log
    if (decision.log) this.onLog(this.isRed ? 'red' : 'blue', decision.log)

    // Update bullets
    this.bullets = this.bullets.filter(b => b.active)
    this.bullets.forEach(b => b.update(obstacles, this.canvasW, this.canvasH))
  }

  _shoot(obstacles) {
    const spread = (Math.random() - 0.5) * 0.07
    const bx = this.x + Math.cos(this.turretAngle) * 20
    const by = this.y + Math.sin(this.turretAngle) * 20
    this.bullets.push(new Bullet(
      bx, by,
      this.turretAngle + spread,
      this.color,
      this.isRed,
      (x, y, obstacle, destroyed) => this.onHitObstacle(x, y, obstacle, destroyed)
    ))
    this.shootCooldown = this.shootInterval
  }

  /**
   * Apply damage and return true if tank is now dead.
   * @param {number} dmg
   * @returns {boolean}
   */
  takeDamage(dmg) {
    this.hp = Math.max(0, this.hp - dmg)
    this.hitsTaken++
    return this.hp <= 0 || this.hitsTaken >= this.maxHits
  }

  draw(ctx) {
    if (!this.alive) return

    // ── Body ────────────────────────────────────────────────────────────
    // Local axes: +x is FRONT (cannon side), -x is REAR (exhaust side).
    ctx.save()
    ctx.translate(this.x, this.y)
    ctx.rotate(this.angle)

    // Hull
    ctx.fillStyle = this.color
    ctx.fillRect(-14, -10, 28, 20)

    // ── Tracks ──
    ctx.fillStyle = this.accentColor
    ctx.fillRect(-14, -12, 28, 4)
    ctx.fillRect(-14,   8, 28, 4)

    // Animated track lugs — they scroll with movement so the wheels look
    // like they're actually rolling in the direction the tank is going.
    ctx.strokeStyle = this.color
    ctx.lineWidth   = 1
    const off = this._trackOffset
    for (let base = -14; base <= 14; base += 5) {
      const i = base + off
      if (i < -13 || i > 13) continue
      ctx.beginPath(); ctx.moveTo(i, -12); ctx.lineTo(i, -8); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(i,   8); ctx.lineTo(i, 12); ctx.stroke()
    }

    // Inner hull panel
    ctx.fillStyle = this.accentColor
    ctx.fillRect(-8, -6, 16, 12)

    // ── Front indicator: bright wedge at +x (the "nose") ──
    ctx.fillStyle = this.isRed ? '#ffe0a0' : '#a0e8ff'
    ctx.beginPath()
    ctx.moveTo(14,  -7)
    ctx.lineTo(18,   0)
    ctx.lineTo(14,   7)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = this.accentColor
    ctx.lineWidth   = 1
    ctx.stroke()

    // ── Rear indicator: dark plate + exhaust pipe at -x ──
    ctx.fillStyle = '#1a1f2a'
    ctx.fillRect(-16, -7, 4, 14)
    // Exhaust pipe sticking out the back
    ctx.fillStyle = '#3a4150'
    ctx.fillRect(-19, -2, 3, 4)
    // Two small "tail light" dots so red/blue is unmistakable from behind
    ctx.fillStyle = this.color
    ctx.fillRect(-15, -6, 2, 2)
    ctx.fillRect(-15,  4, 2, 2)

    ctx.restore()

    // ── Turret (drawn cannon-first so the dome sits cleanly on top) ─────
    ctx.save()
    ctx.translate(this.x, this.y)
    ctx.rotate(this.turretAngle)

    // Cannon barrel — starts inside the dome so there's no visible seam.
    ctx.fillStyle   = this.accentColor
    ctx.fillRect(0, -3, 22, 6)
    ctx.fillStyle   = this.isRed ? '#ff8888' : '#88ccff'
    ctx.fillRect(2, -2, 20, 4)
    // Muzzle tip
    ctx.fillStyle   = '#1a1f2a'
    ctx.fillRect(20, -2, 2, 4)

    // Turret dome — solid fill + crisp outline, no big shadow blur.
    ctx.beginPath()
    ctx.arc(0, 0, 8, 0, Math.PI * 2)
    ctx.fillStyle   = this.color
    ctx.fill()
    ctx.lineWidth   = 1.5
    ctx.strokeStyle = this.accentColor
    ctx.stroke()

    // Inner detail dot so you can see where the turret is facing at a glance.
    ctx.beginPath()
    ctx.arc(3, 0, 1.6, 0, Math.PI * 2)
    ctx.fillStyle = this.accentColor
    ctx.fill()

    ctx.restore()

    // HP bar above tank
    const barW    = 30
    const hpRatio = this.hp / this.maxHp
    ctx.fillStyle = '#111'
    ctx.fillRect(this.x - barW / 2, this.y - 22, barW, 4)
    ctx.fillStyle = hpRatio > 0.5 ? '#00ff88' : hpRatio > 0.25 ? '#ffc107' : '#ff2d2d'
    ctx.fillRect(this.x - barW / 2, this.y - 22, barW * hpRatio, 4)

    // Sensor ray visualization (AI mode only)
    const s = !this.humanController && this.ai.lastSensors
    if (s) {
      const rayColor  = this.isRed ? 'rgba(255,80,80,' : 'rgba(80,170,255,'
      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.lineWidth = 1
      s.offsets.forEach((offset, i) => {
        const angle = s.moveDir + offset
        const dist  = s.dists[i]
        const hit   = dist < s.range
        ctx.strokeStyle = rayColor + (i === 2 ? '0.7)' : '0.35)')
        ctx.beginPath()
        ctx.moveTo(this.x, this.y)
        ctx.lineTo(this.x + Math.cos(angle) * dist, this.y + Math.sin(angle) * dist)
        ctx.stroke()
        // endpoint dot — bright when hitting obstacle
        ctx.fillStyle = hit ? '#ffd700' : rayColor + '0.4)'
        ctx.beginPath()
        ctx.arc(this.x + Math.cos(angle) * dist, this.y + Math.sin(angle) * dist, hit ? 3 : 2, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.setLineDash([])
      ctx.restore()
    }
  }

  reset(x, y) {
    this.x            = x
    this.y            = y
    this.angle        = this.isRed ? 0 : Math.PI
    this.turretAngle  = this.isRed ? 0 : Math.PI
    this.hp           = this.maxHp
    this.hitsTaken    = 0
    this.shootCooldown = 0
    this.bullets      = []
    this.ai.reset()
    this._stuckFrames   = 0
    this._unstickFrames = 0
    this._unstickDir    = 1
  }
}
