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
├── .nvmrc                    # Node 22 for CI / Cloudflare Pages
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
| `npm run fairness:test` | Run 100-round headless fairness check |

---

## Fairness test (100 rounds)

Use the headless simulator to sanity-check side bias after gameplay changes.

```bash
npm run fairness:test
```

Example output:

```text
Fairness test complete (100 rounds)
Layout: default, mode: deathmatch, duration: 120s
Red wins : 31 (31.0%)
Blue wins: 33 (33.0%)
Draws    : 36 (36.0%)
```

You can also run custom sweeps (round count, layout, and duration):

```bash
node scripts/fairness-test.mjs --rounds 300 --layout maze --duration 120
```

Tip: expect some variance, but over large samples red/blue should stay close.

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

---

## Deploy to Cloudflare Pages

Use [Pages Git integration](https://developers.cloudflare.com/pages/get-started/guide/) so every push to `main` rebuilds the site.

**Important:** the build step must emit static files and exit. Use **`npm run build`**, not `npm run dev`. If your build log shows `Executing user command: npm run dev`, the deploy will hang or fail because Vite’s dev server never finishes and does not populate `dist/`. In the Cloudflare project go to **Settings** → **Builds & deployments** → **Build configuration** and set the command to `npm run build` and the output directory to **`dist`**.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages), choose **Create application** → **Pages** → **Connect to Git**, then authorize GitHub and select [vijayasankar1986/ai-tankgame](https://github.com/vijayasankar1986/ai-tankgame).
2. Set the **production branch** to `main`.
3. Under **Set up builds and deployments** ([build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)):
   - **Framework preset**: **React (Vite)** (same as plain Vite: `npm run build` → `dist`), or **None** with the fields below.
   - **Build command**: `npm run build` (required)
   - **Build output directory**: `dist` (required)
   - **Root directory**: `/` (repository root)

Optional: in **Settings** → **Environment variables**, set **`NODE_VERSION`** to `22` if the builder does not already follow [`.nvmrc`](.nvmrc).

**Ollama on the hosted site:** Pages serves the game over **HTTPS**. Browsers block mixed content, so calls to `http://127.0.0.1:11434` or plain `http://` Ollama from that page will not work. **Auto** and **Human** work as usual. For **Ollama** in production you need an **HTTPS** endpoint (tunnel or proxy) and must set **Ollama base URL** in the in-game Settings.
