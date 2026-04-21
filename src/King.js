// King.js — Stationary "VIP" entity for Protect-The-King mode. Each team
// has a King near the back of its side; destroying the enemy King wins
// the round regardless of tank HP.

import { settings } from './Settings.js'

export class King {
  /**
   * @param {object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.color        primary hex
   * @param {string} opts.accentColor  darker shade
   * @param {string} opts.name         team display name
   * @param {boolean} opts.isRed
   */
  constructor(opts) {
    this.x            = opts.x
    this.y            = opts.y
    this.color        = opts.color
    this.accentColor  = opts.accentColor
    this.name         = opts.name
    this.isRed        = opts.isRed
    this.maxHp        = settings.match.kingHp
    this.hp           = this.maxHp
    // Circular hitbox used by swept bullet-vs-circle collision.
    this.radius       = 18
  }

  get alive() { return this.hp > 0 }

  /** @returns {boolean} true if the king is now destroyed. */
  takeDamage(dmg) {
    this.hp = Math.max(0, this.hp - dmg)
    return this.hp <= 0
  }

  reset() {
    this.maxHp = settings.match.kingHp
    this.hp    = this.maxHp
  }

  draw(ctx) {
    const ratio = Math.max(0, this.hp / this.maxHp)

    ctx.save()
    ctx.translate(this.x, this.y)

    if (this.alive) {
      // Pulsing aura so it reads as the objective at a glance.
      const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 260)
      ctx.fillStyle = this.isRed
        ? `rgba(255, 80, 80, ${0.12 * pulse})`
        : `rgba(80, 170, 255, ${0.12 * pulse})`
      ctx.beginPath()
      ctx.arc(0, 0, 28, 0, Math.PI * 2)
      ctx.fill()

      // Castle base
      ctx.fillStyle   = this.accentColor
      ctx.strokeStyle = '#0a0c10'
      ctx.lineWidth   = 1
      ctx.fillRect(-16, -4, 32, 20)
      ctx.strokeRect(-16, -4, 32, 20)

      // Crenellations
      ctx.fillStyle = this.color
      ctx.fillRect(-16, -12, 7, 10)
      ctx.fillRect(-4,  -12, 8, 10)
      ctx.fillRect( 9,  -12, 7, 10)

      // Arrow slit / door
      ctx.fillStyle = '#0a0c10'
      ctx.fillRect(-3, 2, 6, 10)

      // Flag pole
      ctx.fillStyle = '#8a8f99'
      ctx.fillRect(-1, -26, 2, 14)

      // Flag
      ctx.fillStyle = this.color
      ctx.beginPath()
      ctx.moveTo( 1, -26)
      ctx.lineTo(14, -22)
      ctx.lineTo( 1, -18)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = this.accentColor
      ctx.stroke()
    } else {
      // Destroyed — smoldering rubble
      ctx.fillStyle = '#2a1a15'
      ctx.fillRect(-16, 4, 32, 12)
      ctx.fillStyle = '#5a2a20'
      ctx.fillRect(-14, 6, 8,  8)
      ctx.fillRect( -2, 6, 10, 6)
      ctx.fillRect( 10, 8, 4,  6)
    }

    ctx.restore()

    // Label + HP bar above the castle
    const barW = 46
    const barX = this.x - barW / 2
    const barY = this.y - 40

    ctx.font        = 'bold 9px "Share Tech Mono"'
    ctx.textAlign   = 'center'
    ctx.fillStyle   = this.color
    ctx.shadowColor = this.color
    ctx.shadowBlur  = 5
    ctx.fillText(`${this.name} KING`, this.x, barY - 3)
    ctx.shadowBlur  = 0
    ctx.textAlign   = 'left'

    ctx.fillStyle = '#111'
    ctx.fillRect(barX, barY, barW, 5)
    ctx.fillStyle = ratio > 0.5 ? '#00ff88' : ratio > 0.25 ? '#ffc107' : '#ff2d2d'
    ctx.fillRect(barX, barY, barW * ratio, 5)
    ctx.strokeStyle = '#0a0c10'
    ctx.strokeRect(barX, barY, barW, 5)
  }
}
