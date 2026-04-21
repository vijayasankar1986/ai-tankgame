// SettingsPanel.js — Wires the settings modal in index.html to the live
// `settings` object. On Apply we persist to localStorage and tell main.js to
// rebuild the world.

import { LAYOUT_PRESETS, MODE_PRESETS } from './Settings.js'
import { listModelsFor }                from './llm/providers/index.js'

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

function setPath(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const parent = keys.reduce((o, k) => (o[k] = o[k] ?? {}), obj)
  parent[last] = value
}

function coerce(input, raw) {
  if (input.type === 'checkbox') return !!raw
  if (input.type === 'number')   return Number.isFinite(+raw) ? +raw : 0
  return raw
}

/**
 * @param {object} opts
 * @param {object}   opts.settings        live settings object
 * @param {Function} opts.saveSettings    persist to localStorage
 * @param {Function} opts.resetToDefaults reset settings in-place
 * @param {Function} opts.onApply         called after Apply is committed
 */
export function mountSettingsPanel({ settings, saveSettings, resetToDefaults, onApply }) {
  const overlay   = document.getElementById('settingsOverlay')
  const openBtn   = document.getElementById('btnSettings')
  const closeBtn  = document.getElementById('settingsClose')
  const cancelBtn = document.getElementById('settingsCancel')
  const applyBtn  = document.getElementById('settingsApply')
  const defBtn    = document.getElementById('settingsDefaults')

  if (!overlay || !openBtn) return

  const inputs = Array.from(overlay.querySelectorAll('[data-setting]'))

  // Snapshot of settings when the panel was opened so Cancel restores them.
  let snapshot = null

  function loadFromSettings() {
    // Rebind BEFORE reading values so the llm-only fields point at the
    // correct per-provider path first.
    rebindAgentFields('red')
    rebindAgentFields('blue')

    inputs.forEach(input => {
      const path = input.dataset.setting
      const v = getPath(settings, path)
      if (v === undefined) return
      if (input.type === 'checkbox') input.checked = !!v
      else                           input.value   = v
    })
    syncControllerVisibility()
    // Populate the model dropdowns for any team currently in LLM mode.
    // We kick these off in parallel and don't await — the panel shows
    // immediately; options appear a moment later.
    refreshModelOptions('red')
    refreshModelOptions('blue')
  }

  // Reflects the currently-selected controller on each team card so CSS
  // can hide the LLM-only fields when the controller is human/auto. We
  // poke this on open, on Defaults, and every time the dropdown changes.
  function syncControllerVisibility() {
    for (const teamKey of ['red', 'blue']) {
      const select = overlay.querySelector(`[data-setting="teams.${teamKey}.controller"]`)
      const card   = select?.closest('.team-card')
      if (!select || !card) continue
      card.dataset.controller = select.value
    }
  }

  // Each LLM provider has its own agent config under
  // settings.teams.<team>.agents.<provider>.{model,intervalSec,showReasoning}.
  // When the user flips the controller dropdown we rewrite the three
  // llm-only fields' data-setting attributes so they read/write the
  // currently-selected provider's block — switching Ollama→OpenAI no
  // longer stomps on the Ollama config.
  const LLM_PROVIDER_IDS = ['ollama', 'openai', 'claude', 'gemini']

  // The four llm-only fields rebound per provider. systemPromptExtra is
  // a <textarea> — the generic coerce/setPath pipeline treats it like any
  // other text input (type === 'textarea', not 'checkbox' or 'number').
  const AGENT_FIELDS = ['model', 'intervalSec', 'showReasoning', 'systemPromptExtra']

  function rebindAgentFields(teamKey) {
    const ctrlSel    = overlay.querySelector(`[data-setting="teams.${teamKey}.controller"]`)
    const card       = ctrlSel?.closest('.team-card')
    if (!ctrlSel || !card) return
    const controller = LLM_PROVIDER_IDS.includes(ctrlSel.value) ? ctrlSel.value : 'ollama'
    for (const field of AGENT_FIELDS) {
      const el = card.querySelector(`[data-llm-field="${field}"]`)
      if (!el) continue
      el.dataset.setting = `teams.${teamKey}.agents.${controller}.${field}`
    }
  }

  // Re-read values for the llm-only fields in a given team card from
  // settings. Called after rebindAgentFields when the controller changes,
  // so the UI reflects the per-provider config immediately.
  function reloadAgentFields(teamKey) {
    const ctrlSel = overlay.querySelector(`[data-setting="teams.${teamKey}.controller"]`)
    const card    = ctrlSel?.closest('.team-card')
    if (!card) return
    for (const field of AGENT_FIELDS) {
      const el = card.querySelector(`[data-llm-field="${field}"]`)
      if (!el) continue
      const v = getPath(settings, el.dataset.setting)
      if (v === undefined) continue
      if (el.type === 'checkbox') el.checked = !!v
      else                        el.value   = v ?? ''
    }
  }

  // Populate the LLM-model <select> for a team based on the chosen
  // provider. Ollama is queried live via /api/tags; stub providers return
  // their static lists. We always include the currently-saved model as a
  // fallback option so the user doesn't silently lose their value when
  // the list doesn't contain it.
  async function refreshModelOptions(teamKey) {
    const select = overlay.querySelector(`[data-model-select="teams.${teamKey}"]`)
    const hint   = overlay.querySelector(`[data-model-source="teams.${teamKey}"]`)
    if (!select) return

    const providerId = overlay.querySelector(`[data-setting="teams.${teamKey}.controller"]`)?.value
    const currentVal = select.value || getPath(settings, `teams.${teamKey}.llmModel`) || ''

    if (!providerId || providerId === 'human' || providerId === 'auto') {
      // LLM fields are hidden by CSS anyway; no need to populate.
      return
    }

    if (hint) hint.textContent = '— loading…'
    const { models, source, loadError } = await listModelsFor(providerId)

    // Always surface the saved value even if the live list doesn't contain
    // it (e.g. user typed a custom model previously, or Ollama is offline).
    const full = [...new Set([currentVal, ...models].filter(Boolean))]
    select.innerHTML = ''
    for (const m of full) {
      const opt = document.createElement('option')
      opt.value = m
      opt.textContent = m === currentVal && !models.includes(currentVal)
        ? `${m} (saved)`
        : m
      select.appendChild(opt)
    }
    select.value = full.includes(currentVal) ? currentVal : (full[0] || '')

    if (hint) {
      if (source === 'live') {
        hint.textContent = `— ${models.length} installed via Ollama`
      } else if (source === 'static') {
        hint.textContent = '— common models'
      } else if (providerId === 'ollama') {
        const detail = loadError
          ? (loadError.length > 140 ? `${loadError.slice(0, 140)}…` : loadError)
          : ''
        hint.textContent = detail
          ? `— could not list models: ${detail}`
          : '— could not list models — from https:// pages set Ollama base URL to an https:// tunnel (or host /api/llm/ollama-tags → Ollama); http:// game + empty URL uses this PC at :11434'
      } else {
        hint.textContent = '— offline, keep previous value'
      }
    }
  }

  function commitToSettings() {
    inputs.forEach(input => {
      const path = input.dataset.setting
      const raw = input.type === 'checkbox' ? input.checked : input.value
      setPath(settings, path, coerce(input, raw))
    })
  }

  function open() {
    snapshot = JSON.parse(JSON.stringify(settings))
    loadFromSettings()
    overlay.classList.add('show')
  }

  function close() {
    overlay.classList.remove('show')
  }

  function cancel() {
    if (snapshot) {
      // Restore from snapshot (keep object identity)
      for (const k of Object.keys(settings)) delete settings[k]
      Object.assign(settings, snapshot)
    }
    close()
  }

  function apply() {
    commitToSettings()
    saveSettings()
    close()
    onApply?.()
  }

  function defaults() {
    resetToDefaults()
    loadFromSettings()
  }

  openBtn.addEventListener('click', open)
  closeBtn?.addEventListener('click', cancel)
  cancelBtn?.addEventListener('click', cancel)
  applyBtn?.addEventListener('click', apply)
  defBtn?.addEventListener('click', defaults)

  // Generic preset auto-filler used by both the Layout and Match-Type
  // dropdowns — picking a value auto-fills the recommended preset values
  // for the other inputs (match duration, tank speed, block HP,
  // aggression, etc). We only touch the form fields — the user still has
  // to click Apply to commit, and is free to tweak any field before doing
  // so.
  function applyPreset(selectEl, presetMap) {
    const preset = presetMap[selectEl.value]
    if (!preset) return
    for (const [path, value] of Object.entries(preset)) {
      const input = overlay.querySelector(`[data-setting="${path}"]`)
      if (!input) continue
      if (input.type === 'checkbox') input.checked = !!value
      else                           input.value   = value
    }
    selectEl.classList.add('preset-pulse')
    setTimeout(() => selectEl.classList.remove('preset-pulse'), 450)
  }

  const layoutInput = overlay.querySelector('[data-setting="battlefield.layout"]')
  layoutInput?.addEventListener('change', () => applyPreset(layoutInput, LAYOUT_PRESETS))

  const modeInput = overlay.querySelector('[data-setting="match.mode"]')
  modeInput?.addEventListener('change', () => applyPreset(modeInput, MODE_PRESETS))

  // Toggle LLM-only rows, rebind to the new provider's agent block,
  // reload the field values from that block, and refresh the model
  // dropdown — all in order, whenever a controller dropdown changes.
  for (const teamKey of ['red', 'blue']) {
    const sel = overlay.querySelector(`[data-setting="teams.${teamKey}.controller"]`)
    sel?.addEventListener('change', () => {
      syncControllerVisibility()
      rebindAgentFields(teamKey)
      reloadAgentFields(teamKey)
      refreshModelOptions(teamKey)
    })
  }

  // Close when clicking outside the inner panel
  overlay.addEventListener('click', e => {
    if (e.target === overlay) cancel()
  })

  // Esc to cancel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) cancel()
  })
}
