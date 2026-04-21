// Bullet.js — Projectile with trail rendering, range limit, and obstacle damage

import { sweepObstacle } from './ObstacleMap.js'
import { settings } from './Settings.js'

export class Bullet {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} angle  radians
   * @param {string} color  hex
   * @param {boolean} isRed
   * @param {Function} onHitObstacle  callback(x, y, obstacle, destroyed)
   */
  constructor(x, y, angle, color, isRed, onHitObstacle) {
    this.x = x
    this.y = y
    this.angle = angle
    this.speed = settings.tank.bulletSpeed
    this.color = color
    this.isRed = isRed
    this.active = true
    this.trail = []
    this.damage = settings.tank.bulletDamage
    this.maxRange = settings.tank.bulletRange
    this.traveled = 0
    this.onHitObstacle = onHitObstacle
  }

  /**
   * @param {Array} obstacles
   * @param {number} W canvas width
   * @param {number} H canvas height
   */
  update(obstacles, W, H) {
    this.trail.push({ x: this.x, y: this.y })
    if (this.trail.length > 6) this.trail.shift()

    const prevX = this.x
    const prevY = this.y
    const nextX = this.x + Math.cos(this.angle) * this.speed
    const nextY = this.y + Math.sin(this.angle) * this.speed

    // Swept obstacle collision — uses the entire path between frames so fast
    // bullets can't tunnel through thin blocks.
    const hit = sweepObstacle(prevX, prevY, nextX, nextY, 3, obstacles)
    if (hit) {
      this.x = hit.x
      this.y = hit.y
      this.traveled += Math.hypot(hit.x - prevX, hit.y - prevY)
      hit.obstacle.hp = Math.max(0, hit.obstacle.hp - 1)
      this.active = false
      const destroyed = hit.obstacle.hp <= 0
      if (this.onHitObstacle) this.onHitObstacle(hit.x, hit.y, hit.obstacle, destroyed)
      return
    }

    this.x = nextX
    this.y = nextY
    this.traveled += this.speed

    // Out of range — fizzle
    if (this.traveled >= this.maxRange) {
      this.active = false
      return
    }

    // Out of bounds
    if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) {
      this.active = false
      return
    }
  }

  draw(ctx) {
    if (!this.active) return

    const life = Math.max(0, 1 - this.traveled / this.maxRange)

    this.trail.forEach((p, i) => {
      const r = 2 * (i / this.trail.length)
      if (r <= 0) return
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      const alpha = Math.max(0, Math.floor((i / this.trail.length) * 153 * life))
        .toString(16).padStart(2, '0')
      ctx.fillStyle = this.color + alpha
      ctx.fill()
    })

    ctx.save()
    ctx.globalAlpha = 0.35 + 0.65 * life
    ctx.beginPath()
    ctx.arc(this.x, this.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.shadowColor = this.color
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.restore()
  }
}
