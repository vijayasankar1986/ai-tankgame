// theme.js — Light (default) / dark UI; persisted in localStorage.

const STORAGE_KEY = 'iron-warfare-theme'

/** @returns {'light' | 'dark'} */
function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* ignore */
  }
  return 'light'
}

/**
 * Apply theme to <html data-theme="…"> and persist. Wires #btnTheme if present.
 */
export function initTheme() {
  const root = document.documentElement
  const btn = document.getElementById('btnTheme')

  function apply(theme) {
    const t = theme === 'dark' ? 'dark' : 'light'
    root.dataset.theme = t
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
    if (btn) {
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')
      btn.setAttribute('title', t === 'dark' ? 'Light theme' : 'Dark theme')
    }
  }

  apply(readStored())

  btn?.addEventListener('click', () => {
    apply(root.dataset.theme === 'dark' ? 'light' : 'dark')
  })
}
