// UI.js — DOM updates, scoreboard, logs, overlays

export class UI {
  constructor() {
    this.$redHp       = document.getElementById('redHp')
    this.$blueHp      = document.getElementById('blueHp')
    this.$redHpVal    = document.getElementById('redHpVal')
    this.$blueHpVal   = document.getElementById('blueHpVal')
    this.$redStatus   = document.getElementById('redStatus')
    this.$blueStatus  = document.getElementById('blueStatus')
    this.$redKills    = document.getElementById('redKills')
    this.$blueKills   = document.getElementById('blueKills')
    this.$scoreRed    = document.getElementById('scoreRed')
    this.$scoreBlue   = document.getElementById('scoreBlue')
    this.$roundBadge  = document.getElementById('roundBadge')
    this.$redLog      = document.getElementById('redLog')
    this.$blueLog     = document.getElementById('blueLog')
    this.$overlay      = document.getElementById('winnerOverlay')
    this.$winnerHeader = document.getElementById('winnerHeader')
    this.$winnerText   = document.getElementById('winnerText')
    this.$winnerSub    = document.getElementById('winnerSub')
    this.$timer        = document.getElementById('matchTimer')

    // Team labels — refreshed from settings on boot and on Apply.
    this.$redUnitLabel  = document.getElementById('redUnitLabel')
    this.$blueUnitLabel = document.getElementById('blueUnitLabel')
    this.$redLogTitle   = document.getElementById('redLogTitle')
    this.$blueLogTitle  = document.getElementById('blueLogTitle')
    this.$scoreRedLbl   = document.getElementById('scoreRedLbl')
    this.$scoreBlueLbl  = document.getElementById('scoreBlueLbl')
    this._teams = { red: { name: 'ALPHA' }, blue: { name: 'BRAVO' } }
    this._lastLogByFaction = {
      red: { msg: '', ts: 0 },
      blue: { msg: '', ts: 0 },
    }
  }

  /** Update all team-name + color driven UI from a settings object. */
  refreshTeamLabels(settings) {
    if (!settings?.teams) return
    this._teams = settings.teams
    const r = settings.teams.red.name
    const b = settings.teams.blue.name
    if (this.$redUnitLabel)  this.$redUnitLabel.textContent  = `${r} UNIT`
    if (this.$blueUnitLabel) this.$blueUnitLabel.textContent = `${b} UNIT`
    if (this.$redLogTitle)   this.$redLogTitle.textContent   = `${r} LOG`
    if (this.$blueLogTitle)  this.$blueLogTitle.textContent  = `${b} LOG`
    if (this.$scoreRedLbl)   this.$scoreRedLbl.textContent   = `${r} WINS`
    if (this.$scoreBlueLbl)  this.$scoreBlueLbl.textContent  = `${b} WINS`

    // Theme: push team colors into CSS variables so HP fills, borders,
    // labels, and the winner overlay all pick up the chosen colors.
    document.documentElement.style.setProperty('--red',  settings.teams.red.color)
    document.documentElement.style.setProperty('--blue', settings.teams.blue.color)
  }

  /**
   * @param {Tank} red
   * @param {Tank} blue
   */
  updateStats(red, blue) {
    const rp = (red.hp  / red.maxHp  * 100).toFixed(0)
    const bp = (blue.hp / blue.maxHp * 100).toFixed(0)

    this.$redHp.style.width  = rp + '%'
    this.$blueHp.style.width = bp + '%'
    this.$redHpVal.textContent  = `${red.hp.toFixed(0)}  (${red.hitsTaken}/${red.maxHits} HITS)`
    this.$blueHpVal.textContent = `${blue.hp.toFixed(0)}  (${blue.hitsTaken}/${blue.maxHits} HITS)`
    this.$redStatus.textContent  = red.alive  ? this._statusString(red)  : 'DESTROYED'
    this.$blueStatus.textContent = blue.alive ? this._statusString(blue) : 'DESTROYED'
    this.$redKills.textContent  = red.kills
    this.$blueKills.textContent = blue.kills
  }

  // Compose a richer status line for LLM-controlled tanks so the user can
  // visually confirm the LLM is live (call count increments every
  // interval, latency reflects real RTT, "THINKING" lights up during the
  // network request). For scripted / human we keep the old label.
  _statusString(tank) {
    if (tank.humanController) return 'HUMAN'
    const ai = tank.ai
    if (!ai?.isLLM) return ai?.state ?? 'STANDBY'
    const prov = (ai.providerId || '').slice(0, 3).toUpperCase()
    const n    = ai.callCount || 0
    const ms   = ai.lastLatencyMs ? `${Math.round(ai.lastLatencyMs)}ms` : '—'
    const flag = ai.inFlight ? ' ◌ THINKING' : ''
    return `${ai.state} · ${prov} #${n} · ${ms}${flag}`
  }

  updateScore(scoreRed, scoreBlue, round) {
    this.$scoreRed.textContent  = scoreRed
    this.$scoreBlue.textContent = scoreBlue
    this.$roundBadge.textContent = `ROUND ${round}`
  }

  /**
   * Update the match countdown shown in the scoreboard.
   * @param {number} ms milliseconds remaining
   */
  updateTimer(ms) {
    if (!this.$timer) return
    const total = Math.max(0, Math.ceil(ms / 1000))
    const m = Math.floor(total / 60)
    const s = total % 60
    this.$timer.textContent = `${m}:${s.toString().padStart(2, '0')}`
    this.$timer.classList.toggle('warning', ms <= 10_000)
  }

  /**
   * Append a message to the faction log.
   * @param {'red'|'blue'} faction
   * @param {string} msg
   * @param {string} type  css class suffix: 'red'|'blue'|'sys'|'hit'|'danger'
   */
  log(faction, msg, type = '') {
    const now = Date.now()
    const last = this._lastLogByFaction[faction]
    if (last && last.msg === msg && (now - last.ts) < 900) return
    if (last) {
      last.msg = msg
      last.ts = now
    }
    const el = faction === 'red' ? this.$redLog : this.$blueLog
    const entry = document.createElement('div')
    entry.className = `log-entry ${type || faction}`
    const t = new Date().toLocaleTimeString('en', { hour12: false })
    entry.textContent = `[${t}] ${msg}`
    el.appendChild(entry)
    if (el.children.length > 80) el.removeChild(el.firstChild)
    el.scrollTop = el.scrollHeight
  }

  /**
   * @param {'red'|'blue'|'draw'} winner
   * @param {string} [subtitle] optional subtitle text
   * @param {string} [header]   optional header (defaults to GAME OVER)
   */
  showWinner(winner, subtitle, header) {
    if (this.$winnerHeader) this.$winnerHeader.textContent = header || '◆ GAME OVER ◆'
    if (winner === 'draw') {
      this.$winnerText.textContent = '⚔ DRAW'
      this.$winnerText.className   = 'winner-text'
    } else {
      const teamName = winner === 'red'
        ? (this._teams?.red?.name  ?? 'ALPHA')
        : (this._teams?.blue?.name ?? 'BRAVO')
      this.$winnerText.textContent = `⚔ ${teamName} WINS`
      this.$winnerText.className   = `winner-text ${winner}`
    }
    this.$winnerSub.textContent = subtitle || 'TANK DESTROYED AFTER 10 HITS'
    this.$overlay.classList.add('show')
  }

  hideOverlay() {
    this.$overlay.classList.remove('show')
  }
}
