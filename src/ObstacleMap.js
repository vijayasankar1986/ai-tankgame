// ObstacleMap.js — Obstacle definitions, collision, and damage model

import { settings } from './Settings.js'

// Selectable battlefield layouts. Settings page picks one of these by name.
export const LAYOUTS = {
  default: [
    { x: 200, y: 120, w: 60, h: 20 },
    { x: 200, y: 300, w: 60, h: 20 },
    { x: 380, y: 120, w: 60, h: 20 },
    { x: 380, y: 300, w: 60, h: 20 },
    { x: 290, y: 200, w: 20, h: 60 },
    { x: 100, y: 200, w: 15, h: 80 },
    { x: 540, y: 200, w: 15, h: 80 },
  ],
  open: [
    { x: 310, y: 200, w: 40, h: 60 },
    { x: 130, y: 100, w: 40, h: 15 },
    { x: 490, y: 345, w: 40, h: 15 },
  ],
  crowded: [
    { x: 150, y:  90, w: 60, h: 20 },
    { x: 430, y:  90, w: 60, h: 20 },
    { x: 150, y: 350, w: 60, h: 20 },
    { x: 430, y: 350, w: 60, h: 20 },
    { x: 290, y: 130, w: 20, h: 50 },
    { x: 290, y: 280, w: 20, h: 50 },
    { x: 130, y: 200, w: 50, h: 18 },
    { x: 480, y: 200, w: 50, h: 18 },
    { x: 305, y: 215, w: 50, h: 30 },
  ],
  // Maze (tight, procedural) — dense recursive-backtracker maze on a
  // 12×8 grid (50 px cells, 10 px walls → 40 px corridors). Regenerated
  // every time createObstacles() runs, so each reset gets a fresh layout.
  // See generateTightMaze() below.
  tight: generateTightMaze,
  // Maze (open, symmetric) — hand-crafted corridor network. Wider paths,
  // both spawn lanes clear, same layout every round.
  maze: [
    // Top row
    { x: 110, y:  60, w: 110, h: 14 },
    { x: 290, y:  60, w: 110, h: 14 },
    { x: 470, y:  60, w: 110, h: 14 },
    // Upper row with vertical pillars
    { x:  50, y: 150, w:  90, h: 14 },
    { x: 210, y: 150, w: 110, h: 14 },
    { x: 390, y: 150, w: 110, h: 14 },
    { x: 570, y: 150, w:  40, h: 14 },
    { x: 210, y: 170, w:  14, h: 60 },
    { x: 390, y: 170, w:  14, h: 60 },
    // Middle columns (keep spawn lanes clear at x<120 / x>540)
    { x: 135, y: 225, w:  14, h: 30 },
    { x: 300, y: 215, w:  14, h: 50 },
    { x: 395, y: 215, w:  14, h: 50 },
    { x: 525, y: 225, w:  14, h: 30 },
    // Lower row with vertical pillars (mirror of upper)
    { x: 210, y: 290, w:  14, h: 60 },
    { x: 390, y: 290, w:  14, h: 60 },
    { x:  50, y: 310, w:  90, h: 14 },
    { x: 210, y: 310, w: 110, h: 14 },
    { x: 390, y: 310, w: 110, h: 14 },
    { x: 570, y: 310, w:  40, h: 14 },
    // Bottom row (mirror of top)
    { x: 110, y: 400, w: 110, h: 14 },
    { x: 290, y: 400, w: 110, h: 14 },
    { x: 470, y: 400, w: 110, h: 14 },
  ],
}

/** Default obstacle HP if Settings hasn't been loaded yet (legacy import). */
export const OBSTACLE_MAX_HP = 8

/**
 * Build a fresh obstacle array (fresh HP values) for a new round / reset.
 * Reads layout name and HP from Settings. A layout entry may be either an
 * array of {x,y,w,h} or a function returning such an array (for procedural
 * layouts like the tight maze).
 * @returns {Array<{x:number,y:number,w:number,h:number,hp:number,maxHp:number}>}
 */
export function createObstacles() {
  const layoutName = settings.battlefield.layout
  const raw = LAYOUTS[layoutName] || LAYOUTS.default
  const layout = typeof raw === 'function' ? raw() : raw
  const hp = settings.battlefield.obstacleHp
  return layout.map(o => ({ ...o, hp, maxHp: hp }))
}

// ── Procedural tight-maze generator ──────────────────────────────────────
// Recursive-backtracker maze on a 12×8 grid of 50×50 cells with 10 px
// walls (corridor = 40 px, tank radius = 14 so 26 px total slack). A few
// extra walls are punched out after carving so matches aren't pure
// dead-end hunts, and the walls immediately around each spawn cell are
// removed so tanks never spawn trapped.
function generateTightMaze() {
  const COLS = 12, ROWS = 8
  const CELL = 50, WALL = 10
  const OFFX = 20, OFFY = 20

  // hWall[c][r] = wall between (c,r) and (c,r+1)  — horizontal segment
  // vWall[c][r] = wall between (c,r) and (c+1,r)  — vertical segment
  const hWall = Array.from({ length: COLS },     () => Array(ROWS - 1).fill(true))
  const vWall = Array.from({ length: COLS - 1 }, () => Array(ROWS).fill(true))
  const visited = Array.from({ length: COLS },   () => Array(ROWS).fill(false))

  // Recursive-backtracker carve from (0,0).
  const stack = [[0, 0]]
  visited[0][0] = true
  while (stack.length) {
    const [c, r] = stack[stack.length - 1]
    const nbrs = []
    if (c > 0          && !visited[c - 1][r]) nbrs.push([c - 1, r, 'L'])
    if (c < COLS - 1   && !visited[c + 1][r]) nbrs.push([c + 1, r, 'R'])
    if (r > 0          && !visited[c][r - 1]) nbrs.push([c, r - 1, 'U'])
    if (r < ROWS - 1   && !visited[c][r + 1]) nbrs.push([c, r + 1, 'D'])
    if (!nbrs.length) { stack.pop(); continue }

    const [nc, nr, dir] = nbrs[Math.floor(Math.random() * nbrs.length)]
    if (dir === 'L') vWall[c - 1][r]     = false
    if (dir === 'R') vWall[c][r]         = false
    if (dir === 'U') hWall[c][r - 1]     = false
    if (dir === 'D') hWall[c][r]         = false
    visited[nc][nr] = true
    stack.push([nc, nr])
  }

  // Knock out some extra walls so there are loops / multiple routes.
  const extra = 18
  for (let i = 0; i < extra; i++) {
    if (Math.random() < 0.5) {
      const c = Math.floor(Math.random() * COLS)
      const r = Math.floor(Math.random() * (ROWS - 1))
      hWall[c][r] = false
    } else {
      const c = Math.floor(Math.random() * (COLS - 1))
      const r = Math.floor(Math.random() * ROWS)
      vWall[c][r] = false
    }
  }

  // Guarantee spawn cells are reachable by clearing walls immediately
  // around them. Red spawns at (80, 230) → cell (1, 4); Blue at
  // (580, 230) → cell (11, 4).
  const openAround = (c, r) => {
    if (c > 0)        vWall[c - 1][r] = false
    if (c < COLS - 1) vWall[c][r]     = false
    if (r > 0)        hWall[c][r - 1] = false
    if (r < ROWS - 1) hWall[c][r]     = false
  }
  openAround(1,  4)
  openAround(11, 4)

  // Emit obstacles.
  const obs = []
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 1; r++) {
      if (hWall[c][r]) {
        obs.push({ x: OFFX + c * CELL, y: OFFY + (r + 1) * CELL - WALL / 2, w: CELL, h: WALL })
      }
    }
  }
  for (let c = 0; c < COLS - 1; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (vWall[c][r]) {
        obs.push({ x: OFFX + (c + 1) * CELL - WALL / 2, y: OFFY + r * CELL, w: WALL, h: CELL })
      }
    }
  }

  // Spawn-body + king safety: tanks (radius 14) and king castles
  // (radius 18) need their spawn footprint clear of walls, plus a small
  // margin so they can move / be seen. Removing these walls is cheap and
  // far more robust than trying to enumerate adjacent-cell walls.
  const zones = [
    { x:  80, y: 230, r: 20 },   // red tank spawn
    { x: 580, y: 230, r: 20 },   // blue tank spawn
    { x:  35, y: 230, r: 24 },   // red king
    { x: 625, y: 230, r: 24 },   // blue king
  ]
  const clips = (o, s) =>
    o.x < s.x + s.r &&
    o.x + o.w > s.x - s.r &&
    o.y < s.y + s.r &&
    o.y + o.h > s.y - s.r
  return obs.filter(o => !zones.some(s => clips(o, s)))
}

// Kept for backwards-compat imports in case anything references it.
export const OBSTACLE_DEFS = createObstacles()

/**
 * Check if a circular object at (nx, ny) with given radius collides with any obstacle.
 */
export function collidesWithObstacles(nx, ny, radius, obstacles) {
  for (const o of obstacles) {
    if (o.hp <= 0) continue
    if (
      nx + radius > o.x &&
      nx - radius < o.x + o.w &&
      ny + radius > o.y &&
      ny - radius < o.y + o.h
    ) return true
  }
  return false
}

/**
 * Find the first live obstacle that a point (nx, ny) with given radius overlaps.
 * @returns {object|null}
 */
export function findObstacleAt(nx, ny, radius, obstacles) {
  for (const o of obstacles) {
    if (o.hp <= 0) continue
    if (
      nx + radius > o.x &&
      nx - radius < o.x + o.w &&
      ny + radius > o.y &&
      ny - radius < o.y + o.h
    ) return o
  }
  return null
}

/**
 * Swept collision: find the closest live obstacle that a bullet's line segment
 * crosses while moving from (x1, y1) to (x2, y2). Uses slab method on the
 * obstacle AABB (inflated by `radius`) to prevent fast bullets from tunneling
 * through thin blocks.
 *
 * @returns {{ obstacle:object, x:number, y:number, t:number } | null}
 */
export function sweepObstacle(x1, y1, x2, y2, radius, obstacles) {
  const dx = x2 - x1
  const dy = y2 - y1

  let bestT = Infinity
  let bestO = null

  for (const o of obstacles) {
    if (o.hp <= 0) continue

    const minX = o.x - radius
    const minY = o.y - radius
    const maxX = o.x + o.w + radius
    const maxY = o.y + o.h + radius

    let tmin = 0
    let tmax = 1

    if (Math.abs(dx) < 1e-9) {
      if (x1 < minX || x1 > maxX) continue
    } else {
      const inv = 1 / dx
      let t1 = (minX - x1) * inv
      let t2 = (maxX - x1) * inv
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tmin) tmin = t1
      if (t2 < tmax) tmax = t2
      if (tmin > tmax) continue
    }

    if (Math.abs(dy) < 1e-9) {
      if (y1 < minY || y1 > maxY) continue
    } else {
      const inv = 1 / dy
      let t1 = (minY - y1) * inv
      let t2 = (maxY - y1) * inv
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tmin) tmin = t1
      if (t2 < tmax) tmax = t2
      if (tmin > tmax) continue
    }

    if (tmin < bestT) {
      bestT = tmin
      bestO = o
    }
  }

  if (!bestO) return null
  const t = Math.max(0, bestT)
  return { obstacle: bestO, x: x1 + dx * t, y: y1 + dy * t, t }
}

/**
 * Draw all obstacles, colored by remaining HP.
 */
export function drawObstacles(ctx, obstacles) {
  obstacles.forEach(o => {
    if (o.hp <= 0) return

    const ratio = o.hp / o.maxHp
    // Healthy block = cool steel; damaged block shifts toward warm red.
    const base   = ratio > 0.66 ? '#1a2030' : ratio > 0.33 ? '#3a2420' : '#4a1a15'
    const edge   = ratio > 0.66 ? '#2a3545' : ratio > 0.33 ? '#5a3a30' : '#6a2a22'
    const inner  = ratio > 0.66 ? '#111828' : ratio > 0.33 ? '#281410' : '#38100a'

    ctx.fillStyle = base
    ctx.strokeStyle = edge
    ctx.lineWidth = 1
    ctx.fillRect(o.x, o.y, o.w, o.h)
    ctx.strokeRect(o.x, o.y, o.w, o.h)
    ctx.fillStyle = inner
    ctx.fillRect(o.x + 4, o.y + 4, o.w - 8, o.h - 8)

    // Crack marks once damaged
    if (ratio <= 0.66) {
      ctx.strokeStyle = ratio > 0.33 ? 'rgba(255,180,120,0.55)' : 'rgba(255,90,60,0.8)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(o.x + 2, o.y + o.h / 2)
      ctx.lineTo(o.x + o.w / 2 - 2, o.y + 3)
      ctx.lineTo(o.x + o.w - 4, o.y + o.h - 3)
      ctx.stroke()
      if (ratio <= 0.33) {
        ctx.beginPath()
        ctx.moveTo(o.x + o.w - 3, o.y + 2)
        ctx.lineTo(o.x + o.w / 2, o.y + o.h / 2)
        ctx.lineTo(o.x + 3, o.y + o.h - 2)
        ctx.stroke()
      }
    }

    // Tiny HP pip above the block
    const pipW = Math.max(12, Math.min(o.w, 24))
    const pipX = o.x + (o.w - pipW) / 2
    const pipY = o.y - 5
    ctx.fillStyle = '#111'
    ctx.fillRect(pipX, pipY, pipW, 2)
    ctx.fillStyle = ratio > 0.66 ? '#8fdcff' : ratio > 0.33 ? '#ffc107' : '#ff4444'
    ctx.fillRect(pipX, pipY, pipW * ratio, 2)
  })
}

/**
 * Draw background grid and zone markers.
 */
export function drawGround(ctx, W, H) {
  ctx.strokeStyle = '#12161d'
  ctx.lineWidth = 1
  for (let x = 0; x < W; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = 0; y < H; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  ctx.strokeStyle = '#ff222218'
  ctx.lineWidth = 1
  ctx.strokeRect(5, 5, W / 3, H - 10)
  ctx.strokeStyle = '#2299ff18'
  ctx.strokeRect(W - W / 3 - 5, 5, W / 3, H - 10)
}
