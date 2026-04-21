// Settings.js — Central, persistent configuration for the match, tanks,
// battlefield and teams. The whole app reads from `settings` directly; on
// Apply we mutate the same object in-place and call saveSettings() so the
// values stick across reloads.

const STORAGE_KEY = 'tankgame.settings.v1'

export const DEFAULTS = {
  match: {
    durationSec:   120,    // 2:00 auto-stop
    speedDefault:  1,      // 1 / 2 / 3 ×
    mode:          'deathmatch', // 'deathmatch' | 'king'
    kingHp:        30,     // hits the king can take in Protect-The-King mode
    autoNextRound: false,  // true = skip winner overlay and continue immediately
  },
  battlefield: {
    obstacleHp:    8,     // hits a block can absorb before crumbling
    layout:        'default', // 'default' | 'open' | 'crowded'
  },
  tank: {
    maxHits:       10,    // hits to destroy a tank
    hp:            100,
    speed:         1.5,
    bulletDamage:  10,
    bulletSpeed:   5.5,
    bulletRange:   320,
  },
  // Shared LLM transport (not per-team). Ollama URL matters when the game
  // is opened as a static/production build: there is no Vite proxy, so the
  // browser must call Ollama directly (usually your own PC at 127.0.0.1).
  llm: {
    ollamaBaseUrl: '', // empty = auto — see SettingsPanel / ollama.js
    openaiApiKey: '',
    claudeApiKey: '',
    geminiApiKey: '',
  },
  teams: {
    red: {
      name:       'ALPHA',
      color:      '#ff4444',
      accent:     '#7a1111',
      // Controller drives this team. 'human' plays via keyboard / joystick,
      // 'auto' uses the scripted FSM, the rest route through the LLM proxy.
      controller: 'auto', // 'human' | 'auto' | 'ollama' | 'openai' | 'claude' | 'gemini'
      // Each LLM provider keeps its own config block so switching the
      // controller dropdown doesn't blow away provider-specific model
      // names / intervals. Only the block matching `controller` is read
      // at runtime; the others sit dormant until selected.
      agents:     defaultAgents(),
      aggression: 0.70,    // 0..1
      retreatHp:  20,      // %
      fireRate:   55,      // frames between shots (lower = faster)
    },
    blue: {
      name:       'BRAVO',
      color:      '#44aaff',
      accent:     '#114477',
      controller: 'auto',
      agents:     defaultAgents(),
      aggression: 0.55,
      retreatHp:  30,
      fireRate:   65,
    },
  },
}

// Factory so each team gets its own fresh `agents` object (sharing would
// leak edits across teams). Called both for DEFAULTS and by the migrator.
//
// `systemPromptExtra` is a free-text field appended to the base LLM
// system prompt — it's how the user gives a team a personality:
//   "Be a cautious sniper. Prefer FLANK_RIGHT and HOLD over ADVANCE."
// Empty by default = stock behavior.
function defaultAgents() {
  return {
    ollama: { model: 'mistral:7b',               intervalSec: 3, showReasoning: true, systemPromptExtra: '' },
    openai: { model: 'gpt-4o-mini',              intervalSec: 3, showReasoning: true, systemPromptExtra: '' },
    claude: { model: 'claude-3-5-haiku-latest',  intervalSec: 3, showReasoning: true, systemPromptExtra: '' },
    gemini: { model: 'gemini-2.0-flash',         intervalSec: 3, showReasoning: true, systemPromptExtra: '' },
  }
}

const LLM_PROVIDERS = ['ollama', 'openai', 'claude', 'gemini']

// Back-compat migration. Walks each team and upgrades legacy shapes:
//   - `aiActive: bool`  → `controller: 'human'|'auto'`
//   - flat `llmModel`/`llmInterval`/`showReasoning` fields
//                       → nested `agents.<provider>.{model,intervalSec,showReasoning}`
// Anything missing is seeded from defaultAgents() so the UI always has a
// complete block to bind to, regardless of how old the saved blob is.
function migrateTeams(s) {
  for (const key of ['red', 'blue']) {
    const t = s?.teams?.[key]
    if (!t) continue

    if (typeof t.controller !== 'string') {
      t.controller = t.aiActive === false ? 'human' : 'auto'
    }
    delete t.aiActive

    if (!t.agents || typeof t.agents !== 'object') t.agents = {}
    const fresh = defaultAgents()
    for (const p of LLM_PROVIDERS) {
      if (!t.agents[p] || typeof t.agents[p] !== 'object') t.agents[p] = {}
      for (const [k, v] of Object.entries(fresh[p])) {
        if (t.agents[p][k] === undefined) t.agents[p][k] = v
      }
    }

    // Fold any legacy flat fields into the currently-selected controller's
    // block so the user's last-used values aren't lost on upgrade.
    const active = LLM_PROVIDERS.includes(t.controller) ? t.controller : 'ollama'
    if (t.llmModel !== undefined) {
      // The v1 default `llama3.1:8b` was rarely pre-pulled — quietly swap
      // it for the new default so Ollama works out of the box.
      t.agents[active].model = t.llmModel === 'llama3.1:8b' ? fresh.ollama.model : t.llmModel
    }
    if (t.llmInterval    !== undefined) t.agents[active].intervalSec  = t.llmInterval
    if (t.showReasoning  !== undefined) t.agents[active].showReasoning = t.showReasoning
    delete t.llmModel
    delete t.llmInterval
    delete t.showReasoning
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function deepMerge(target, source) {
  for (const key in source) {
    const sv = source[key]
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      target[key] = deepMerge(target[key] && typeof target[key] === 'object' ? target[key] : {}, sv)
    } else {
      target[key] = sv
    }
  }
  return target
}

function loadSettings() {
  const fresh = deepClone(DEFAULTS)
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) deepMerge(fresh, JSON.parse(saved))
  } catch {
    // localStorage may be unavailable (private mode, file://, etc.) — fall
    // back to defaults silently.
  }
  migrateTeams(fresh)
  if (!fresh.llm || typeof fresh.llm !== 'object') {
    fresh.llm = { ollamaBaseUrl: '', openaiApiKey: '', claudeApiKey: '', geminiApiKey: '' }
  }
  if (fresh.llm.ollamaBaseUrl === undefined) fresh.llm.ollamaBaseUrl = ''
  if (fresh.llm.openaiApiKey === undefined) fresh.llm.openaiApiKey = ''
  if (fresh.llm.claudeApiKey === undefined) fresh.llm.claudeApiKey = ''
  if (fresh.llm.geminiApiKey === undefined) fresh.llm.geminiApiKey = ''
  return fresh
}

export const settings = loadSettings()

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore — settings just won't persist this session
  }
}

export function resetToDefaults() {
  // Replace contents of `settings` in-place so any module holding the
  // imported reference still sees the new values.
  for (const k of Object.keys(settings)) delete settings[k]
  deepMerge(settings, deepClone(DEFAULTS))
  saveSettings()
}

// ── Layout presets ─────────────────────────────────────────────────────
// Picking a layout from the dropdown in the settings panel auto-fills the
// other inputs with values that play well on that map. Only the keys listed
// here are overwritten — everything else (team names, colors, AI active,
// etc.) is preserved from the user's current form values. Users can still
// tweak any field before clicking Apply.
export const LAYOUT_PRESETS = {
  default: {
    'battlefield.obstacleHp': 8,
    'match.durationSec':      120,
    'tank.speed':             1.5,
    'tank.bulletRange':       320,
    'teams.red.aggression':   0.70,
    'teams.blue.aggression':  0.55,
  },
  open: {
    'battlefield.obstacleHp': 5,
    'match.durationSec':      90,
    'tank.speed':             1.8,
    'tank.bulletRange':       380,
    'teams.red.aggression':   0.80,
    'teams.blue.aggression':  0.70,
  },
  crowded: {
    'battlefield.obstacleHp': 10,
    'match.durationSec':      150,
    'tank.speed':             1.3,
    'tank.bulletRange':       280,
    'teams.red.aggression':   0.60,
    'teams.blue.aggression':  0.50,
  },
  maze: {
    'battlefield.obstacleHp': 12,
    'match.durationSec':      150,
    'tank.speed':             1.3,
    'tank.bulletRange':       300,
    'teams.red.aggression':   0.60,
    'teams.blue.aggression':  0.55,
  },
  // Recommended for the procedural tight maze: slower tanks, longer match,
  // tougher walls so the maze shape holds through most of the fight, and
  // equal medium aggression on both teams for a tactical cat-and-mouse.
  tight: {
    'battlefield.obstacleHp': 15,
    'match.durationSec':      180,
    'tank.speed':             1.2,
    'tank.bulletRange':       260,
    'teams.red.aggression':   0.55,
    'teams.blue.aggression':  0.55,
  },
}

// Match-type presets. Picking a mode from the dropdown auto-fills any
// fields listed here. Deathmatch doesn't touch anything; king mode boosts
// bullet range (to let attackers threaten the king across the map) and
// sets a reasonable king HP.
export const MODE_PRESETS = {
  deathmatch: {},
  king: {
    'match.kingHp':       30,
    'tank.bulletRange':   420,   // kings sit at map edges, so reach matters
  },
}
