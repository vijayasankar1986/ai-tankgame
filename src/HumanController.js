// HumanController.js — Keyboard + on-screen joystick input for human players

export class HumanController {
  constructor({ upKey, downKey, leftKey, rightKey, fireKey }) {
    this._keys      = {}
    this._keyMap    = { upKey, downKey, leftKey, rightKey, fireKey }
    this._joyActive    = false
    this._joyPointerId = null
    this._joyDx     = 0
    this._joyDy     = 0
    this._joyRadius  = 38
    this._joyKnob   = null
    this._fireBtnDown = false

    window.addEventListener('keydown', e => {
      this._keys[e.code] = true
      // Stop the page from scrolling when arrow keys drive the tank.
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const m = this._keyMap
        if (e.code === m.upKey || e.code === m.downKey ||
            e.code === m.leftKey || e.code === m.rightKey) {
          e.preventDefault()
        }
      }
    })
    window.addEventListener('keyup',   e => { this._keys[e.code] = false })
  }

  attachJoystick(baseEl, knobEl, fireEl) {
    this._joyKnob = knobEl

    baseEl.addEventListener('pointerdown', e => {
      if (this._joyActive) return
      e.preventDefault()
      baseEl.setPointerCapture(e.pointerId)
      this._joyActive    = true
      this._joyPointerId = e.pointerId
      this._updateJoy(e, baseEl)
    })

    baseEl.addEventListener('pointermove', e => {
      if (e.pointerId !== this._joyPointerId) return
      e.preventDefault()
      this._updateJoy(e, baseEl)
    })

    const endJoy = e => {
      if (e.pointerId !== this._joyPointerId) return
      this._joyActive    = false
      this._joyPointerId = null
      this._joyDx = 0
      this._joyDy = 0
      knobEl.style.transform = 'translate(-50%, -50%)'
    }
    baseEl.addEventListener('pointerup',     endJoy)
    baseEl.addEventListener('pointercancel', endJoy)

    fireEl.addEventListener('pointerdown', e => { e.preventDefault(); this._fireBtnDown = true })
    fireEl.addEventListener('pointerup',   () => { this._fireBtnDown = false })
    fireEl.addEventListener('pointerleave',() => { this._fireBtnDown = false })
  }

  _updateJoy(e, baseEl) {
    const rect = baseEl.getBoundingClientRect()
    const px   = e.clientX - (rect.left + rect.width  / 2)
    const py   = e.clientY - (rect.top  + rect.height / 2)
    const dist = Math.hypot(px, py)
    const r    = this._joyRadius
    this._joyDx = dist > r ? px / dist * r : px
    this._joyDy = dist > r ? py / dist * r : py
    if (this._joyKnob) {
      this._joyKnob.style.transform =
        `translate(calc(-50% + ${this._joyDx}px), calc(-50% + ${this._joyDy}px))`
    }
  }

  decide(self, enemy, _obstacles) {
    const k  = this._keys
    const km = this._keyMap

    let dx = 0, dy = 0
    if (k[km.upKey])    dy -= 1
    if (k[km.downKey])  dy += 1
    if (k[km.leftKey])  dx -= 1
    if (k[km.rightKey]) dx += 1

    if (Math.hypot(this._joyDx, this._joyDy) > 6) {
      dx += this._joyDx / this._joyRadius
      dy += this._joyDy / this._joyRadius
    }

    const mag     = Math.hypot(dx, dy)
    const moveDir = mag > 0.1 ? Math.atan2(dy, dx) : null
    const shoot   = !!(k[km.fireKey] || this._fireBtnDown)

    // Turret auto-tracks the enemy so driving and aiming are independent —
    // this matches the AI's behavior and makes human play actually feasible.
    const aimAt = enemy
      ? Math.atan2(enemy.y - self.y, enemy.x - self.x)
      : self.turretAngle

    return {
      state:     'HUMAN',
      moveDir,
      rotateTo:  moveDir,
      speedMult: 1.0,
      aimAt,
      shoot,
      log:       null,
    }
  }

  reset() {
    this._keys         = {}
    this._joyDx        = 0
    this._joyDy        = 0
    this._joyActive    = false
    this._joyPointerId = null
    this._fireBtnDown  = false
    if (this._joyKnob) this._joyKnob.style.transform = 'translate(-50%, -50%)'
  }
}
