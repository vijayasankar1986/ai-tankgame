// AIController.js — AI decision-making state machine
// States: SEEK | ADVANCE | ATTACK | STRAFE | RETREAT
// Future hook: replace sensor reads with MQTT / ROS2 topic data

/**
 * AI states enum
 */
export const AI_STATE = {
  SEEK:    'SEEK',
  ADVANCE: 'ADVANCE',
  ATTACK:  'ATTACK',
  STRAFE:  'STRAFE',
  RETREAT: 'RETREAT',
}

export class AIController {
  /**
   * @param {object} config
   * @param {number} config.aggressionLevel   0.0–1.0
   * @param {number} config.retreatHpThreshold  hp% to trigger retreat
   * @param {number} config.advanceRange       distance to start advancing
   * @param {number} config.strafeRange        distance to strafe instead of advance
   * @param {number} config.shootRange         max distance to attempt shooting
   * @param {number} config.aimTolerance       radians — max aim error to shoot
   */
  constructor(config = {}) {
    this.aggressionLevel    = config.aggressionLevel    ?? 0.65
    this.retreatHpThreshold = config.retreatHpThreshold ?? 25
    this.recoverHpThreshold = config.recoverHpThreshold ?? 40
    this.advanceRange       = config.advanceRange       ?? 280
    this.strafeRange        = config.strafeRange        ?? 100
    this.shootRange         = config.shootRange         ?? 320
    this.aimTolerance       = config.aimTolerance       ?? 0.30

    this.state           = AI_STATE.SEEK
    this.stateTimer      = 0
    this.repositionTimer = 0
    this.strafeDir       = 1
    this.strafeTimer     = 0
    this._lastLogTime    = 0
    this.lastSensors     = null
    this._posCheckTimer  = 0
    this._lastX          = null
    this._lastY          = null
    this._escapeTimer    = 0
    this._escapeDir      = 1
  }

  // ── Raycasting sensor ──────────────────────────────────────────────────────
  /**
   * Cast a ray from (ox,oy) in direction `angle` up to `maxDist` px.
   * Steps by 2px; returns distance to first obstacle hit, or maxDist if clear.
   */
  _raycast(ox, oy, angle, maxDist, obstacles) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (let d = 14; d <= maxDist; d += 2) {
      const px = ox + cos * d
      const py = oy + sin * d
      for (const o of obstacles) {
        // Skip destroyed blocks so AI doesn't steer around phantom walls.
        if (o.hp !== undefined && o.hp <= 0) continue
        if (px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h) return d
      }
    }
    return maxDist
  }

  /**
   * Compute next AI decision given sensor input.
   *
   * @param {object} self      { x, y, hp, angle, turretAngle }
   * @param {object} enemy     { x, y, hp }
   * @param {Array}  obstacles  obstacle defs for raycasting
   * @returns {object} decision { state, moveDir, rotateTo, aimAt, shoot, log }
   */
  decide(self, enemy, obstacles = []) {
    this.stateTimer    += 1
    this.repositionTimer = Math.max(0, this.repositionTimer - 1)
    this.strafeTimer    = Math.max(0, this.strafeTimer - 1)

    const dist         = Math.hypot(self.x - enemy.x, self.y - enemy.y)
    const angleToEnemy = Math.atan2(enemy.y - self.y, enemy.x - self.x)
    const hpPct        = self.hp

    // ── Stuck detection ────────────────────────────────────────────────────
    this._posCheckTimer++
    if (this._posCheckTimer >= 20) {
      this._posCheckTimer = 0
      if (this._lastX !== null) {
        const moved = Math.hypot(self.x - this._lastX, self.y - this._lastY)
        if (moved < 2 && this._escapeTimer <= 0) {
          // Pick perpendicular with most clearance
          const perpL = this._raycast(self.x, self.y, angleToEnemy - Math.PI / 2, 60, obstacles)
          const perpR = this._raycast(self.x, self.y, angleToEnemy + Math.PI / 2, 60, obstacles)
          this._escapeDir   = perpL > perpR ? -1 : 1
          this._escapeTimer = 55
        }
      }
      this._lastX = self.x
      this._lastY = self.y
    }

    // ── State transitions ──────────────────────────────────────────────────
    if (hpPct < this.retreatHpThreshold && this.state !== AI_STATE.RETREAT) {
      this.state = AI_STATE.RETREAT
      this.stateTimer = 0
    } else if (this.state === AI_STATE.RETREAT && hpPct > this.recoverHpThreshold) {
      this.state = AI_STATE.SEEK
    } else if (this.state !== AI_STATE.RETREAT) {
      if (dist > this.advanceRange) {
        this.state = AI_STATE.ADVANCE
      } else if (dist < this.strafeRange) {
        this.state = AI_STATE.STRAFE
        if (this.strafeTimer <= 0) {
          this.strafeDir *= -1
          this.strafeTimer = 60 + Math.random() * 60
        }
      } else if (this.repositionTimer <= 0) {
        this.state = Math.random() < this.aggressionLevel
          ? AI_STATE.ATTACK
          : AI_STATE.STRAFE
        this.repositionTimer = 80 + Math.random() * 60
      }
    }

    // ── Movement decision ──────────────────────────────────────────────────
    let moveDir   = null
    let rotateTo  = null
    let speedMult = 1.0

    // For all driving states the tracked body should face the way it's
    // rolling — the turret tracks the enemy independently via aimAt, so
    // pointing the body at the enemy while strafing made the wheels look
    // out of sync with movement.
    switch (this.state) {
      case AI_STATE.ADVANCE:
        moveDir  = angleToEnemy
        break

      case AI_STATE.ATTACK:
        moveDir   = angleToEnemy + Math.PI / 2 * this.strafeDir
        speedMult = 0.8
        break

      case AI_STATE.STRAFE:
        moveDir = angleToEnemy + Math.PI / 2 * this.strafeDir
        break

      case AI_STATE.RETREAT:
        moveDir = angleToEnemy + Math.PI
        break

      default:
        break
    }
    rotateTo = moveDir

    // ── Obstacle sensor steering ───────────────────────────────────────────────
    this.lastSensors = null
    if (moveDir !== null && obstacles.length) {
      const range   = 60
      const offsets = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]
      const dists   = offsets.map(a => this._raycast(self.x, self.y, moveDir + a, range, obstacles))
      this.lastSensors = { moveDir, offsets, dists, range }

      const fwd = dists[2]
      if (fwd < 38) {
        // Forward blocked — steer toward clearest flanking sensor
        const bias    = (dists[3] + dists[4]) - (dists[0] + dists[1])
        const turnDir = bias !== 0 ? Math.sign(bias) : this.strafeDir
        moveDir  += turnDir * Math.PI / 2.5
      } else if (fwd < range * 0.75) {
        // Partial block — gentle nudge
        const bias = dists[3] - dists[1]
        if (Math.abs(bias) > 4) moveDir += Math.sign(bias) * Math.PI / 5
      }
      rotateTo = moveDir
    }

    // ── Escape override (takes priority over sensor steering) ─────────────
    if (this._escapeTimer > 0) {
      this._escapeTimer--
      if (moveDir !== null) {
        moveDir  = angleToEnemy + Math.PI / 2 * this._escapeDir
        rotateTo = moveDir
      }
    }

    // ── Shoot decision ─────────────────────────────────────────────────────
    const turretDiff = Math.abs(
      Math.atan2(
        Math.sin(angleToEnemy - self.turretAngle),
        Math.cos(angleToEnemy - self.turretAngle)
      )
    )
    const shouldShoot = dist < this.shootRange && turretDiff < this.aimTolerance

    // ── Occasional log messages ────────────────────────────────────────────
    const now = Date.now()
    let logMsg = null
    const logInterval = {
      [AI_STATE.ADVANCE]:  1100,
      [AI_STATE.ATTACK]:   800,
      [AI_STATE.STRAFE]:   900,
      // Retreat can persist for long stretches; keep this less chatty.
      [AI_STATE.RETREAT]:  1800,
    }[this.state] ?? 500

    if (now - this._lastLogTime > logInterval + Math.random() * 150) {
      logMsg = {
        [AI_STATE.ADVANCE]:  'ADVANCING ON TARGET',
        [AI_STATE.ATTACK]:   'ENGAGING TARGET',
        [AI_STATE.STRAFE]:   'STRAFING',
        [AI_STATE.RETREAT]:  'RETREATING — LOW HP',
        [AI_STATE.SEEK]:     'SCANNING...',
      }[this.state]
      this._lastLogTime = now
    }

    return {
      state:     this.state,
      moveDir,
      rotateTo,
      speedMult,
      aimAt:     angleToEnemy,
      shoot:     shouldShoot,
      log:       logMsg,
    }
  }

  reset() {
    this.state           = AI_STATE.SEEK
    this.stateTimer      = 0
    this.repositionTimer = 0
    this.strafeDir       = 1
    this.strafeTimer     = 0
    this._lastLogTime    = 0
    this.lastSensors     = null
    this._posCheckTimer  = 0
    this._lastX          = null
    this._lastY          = null
    this._escapeTimer    = 0
    this._escapeDir      = 1
  }
}
