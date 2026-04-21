# IRON WARFARE — AI vs AI Tank Battle

A modular, browser-based tank battle built with **Vite** and **vanilla JavaScript**. Two teams fight on a 2D canvas with destructible obstacles, optional **Protect the King** rules, and per-team controllers: scripted AI, human input, or a **local LLM (Ollama)** layered on top of the same AI core.

The codebase is structured so sensor-driven control (for example **ROS 2** or **MQTT**) can eventually replace the in-browser inputs without rewriting combat logic.

---

## Features

- **Match modes**: Fight (deathmatch) or **Protect the King** (destroy the enemy king to win).
- **Controllers** (per team, in Settings): **Auto** (finite-state AI), **Human** (keyboard + on-screen joystick), **Ollama** (async LLM directives blended with the scripted AI).
- **Battlefield**: Multiple layouts (default, open, crowded, maze variants), block HP, match duration, king HP.
- **Persistence**: Match and team settings are saved in `localStorage` and survive reloads.
- **Dev experience**: Vite dev server with proxy to Ollama so the browser never needs direct access to `:11434` during development.

---

## Project structure

```
ai-tankgame/
├── index.html                 # Shell: canvas, HUD, settings modal
├── package.json
├── vite.config.js             # Dev server (port 3000) + Ollama proxy
└── src/
    ├── main.js                # Game loop, collisions, match flow
    ├── style.css
    ├── Tank.js                # Tank physics, turret, shooting
    ├── Bullet.js
    ├── Particle.js
    ├── King.js                # King entity (king mode)
    ├── ObstacleMap.js         # Layouts, obstacles, ground draw
    ├── UI.js                  # HP bars, logs, scoreboard, overlays
    ├── AIController.js        # Scripted AI (SEEK / ADVANCE / ATTACK / …)
    ├── HumanController.js     # Keyboard + virtual joystick
    ├── LLMController.js       # Non-blocking LLM overlay on scripted AI
    ├── Settings.js            # Defaults, load/save, migrations
    ├── SettingsPanel.js       # Settings modal wiring
    └── llm/
        ├── prompt.js          # System / user prompts
        ├── schema.js          # Directive parsing
        └── providers/         # Ollama client + stubs / registry
```

---

## Quick start

This project is a **public Git** repository: [vijayasankar1986/ai-tankgame](https://github.com/vijayasankar1986/ai-tankgame). Clone it, then install dependencies:

```bash
git clone https://github.com/vijayasankar1986/ai-tankgame.git
cd ai-tankgame
npm install
npm run dev
```

The dev server listens on **http://localhost:3000** (see `vite.config.js`).

| Script            | Purpose                          |
|-------------------|----------------------------------|
| `npm run dev`     | Development server + HMR         |
| `npm run build`   | Production bundle → `dist/`      |
| `npm run preview` | Serve the built `dist/` locally  |

---

## Ollama (local LLM)

1. Install and run [Ollama](https://ollama.com/) locally and pull a model (the default in settings is `mistral:7b`; change it in **Settings** to whatever you have).
2. In **dev**, API calls go through Vite’s proxy to `http://localhost:11434` (no CORS hassle).
3. For a **static / production** build opened from disk or another host, set **Ollama base URL** in Settings if Ollama is not on the same machine. Mixed content applies: an **https** game page cannot call **http://localhost**; use an https-capable proxy or serve the game over **http** for local testing.

LLM decisions run **asynchronously**; the game loop never blocks on network I/O. If the model errors or returns invalid output, the tank falls back to scripted AI and the side log shows a warning.

---

## Scripted AI (Auto)

Each **Auto** tank uses `AIController` with states such as SEEK, ADVANCE, ATTACK, STRAFE, and RETREAT. Knobs include aggression, retreat HP threshold, and engagement ranges (wired from team / tank settings in `main.js` and `Settings.js`).

The same `decide(...)` style interface is suitable for future **MQTT** or **ROS 2** bridges: feed pose, HP, and aim state instead of reading from the canvas simulation.

---

## Build for production

```bash
npm run build
```

Output is in `dist/`. Deploy as static files, or run `npm run preview` to verify the build locally.
