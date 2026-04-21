// Particle.js — Particle system for explosions and hit effects

export class ParticleSystem {
  constructor() {
    this.particles = []
  }

  /**
   * Spawn particles at (x, y) with a given color.
   * @param {number} x
   * @param {number} y
   * @param {string} color  hex color e.g. '#ff4444'
   * @param {number} count
   */
  spawn(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 4
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.04 + Math.random() * 0.04,
        color,
        size: 1.5 + Math.random() * 3,
      })
    }
  }

  update() {
    // Apply per-frame physics & decay FIRST, then drop dead particles. Doing
    // it in this order guarantees a particle whose life crosses zero this
    // frame is removed before draw() ever sees it, preventing negative radius
    // / invalid alpha values from being passed to the canvas API.
    this.particles.forEach(p => {
      p.x += p.vx
      p.y += p.vy
      p.vx *= 0.93
      p.vy *= 0.93
      p.life -= p.decay
    })
    this.particles = this.particles.filter(p => p.life > 0)
  }

  draw(ctx) {
    this.particles.forEach(p => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
      const alpha = Math.floor(p.life * 255).toString(16).padStart(2, '0')
      ctx.fillStyle = p.color + alpha
      ctx.fill()
    })
  }

  clear() {
    this.particles = []
  }
}
