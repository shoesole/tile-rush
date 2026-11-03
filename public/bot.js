// Virtual opponents. The solver works out a move instantly; the pacing (how long a
// move "takes") comes from the level, so the bot plays at a human-ish speed.
// No DOM, so node tests can drive it with a virtual clock.

import { key, parseKey, isConnected, DUMP_MIN } from "./engine.js";

// Seconds. delay = think + perTile * tiles placed, ±25%.
// maxLen caps word length; pickTop = how many of the best options it picks among.
// TODO(adaptive): these are the knobs a skill ladder would tune per player.
export const LEVELS = {
  easy:   { think: 5.0, perTile: 4.2, maxLen: 5,  pickTop: 12, rebuild: 14, label: "Easy" },
  medium: { think: 3.2, perTile: 2.6, maxLen: 7,  pickTop: 5,  rebuild: 9,  label: "Medium" },
  hard:   { think: 1.8, perTile: 1.5, maxLen: 15, pickTop: 1,  rebuild: 6,  label: "Hard" },
};

// How awkward a letter is to place (dumped first, played early).
const AWKWARD = { Q: 10, J: 8, X: 7, Z: 7, K: 4, V: 5, W: 3, F: 2, Y: 2, B: 2, C: 1, H: 1, M: 1, P: 1, G: 1 };

const A = 65;
const toCounts = (letters) => {
  const c = new Uint8Array(26);
  for (const l of letters) c[l.charCodeAt(0) - A]++;
  return c;
};

// ---------- Placement ----------

// Try to lay `word` with its first letter at (x0,y0) going (dx,dy).
// Returns the new cells [[x,y,letter]] or null if illegal.
function tryPlace(grid, dict, hand, word, x0, y0, dx, dy) {
  if (grid.has(key(x0 - dx, y0 - dy))) return null;
  const n = word.length;
  if (grid.has(key(x0 + n * dx, y0 + n * dy))) return null;
  const need = new Uint8Array(26);
  const placed = [];
  let anchored = false;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * dx, y = y0 + i * dy;
    const have = grid.get(key(x, y));
    if (have) {
      if (have !== word[i]) return null;
      anchored = true;
    } else {
      const c = word.charCodeAt(i) - A;
      if (++need[c] > hand[c]) return null;
      placed.push([x, y, word[i]]);
    }
  }
  if (!placed.length || (grid.size && !anchored)) return null;
  // Every new tile's cross-word (perpendicular run) must be a word.
  const px = dy, py = dx;
  for (const [x, y, l] of placed) {
    let s = "", e = "";
    let cx = x - px, cy = y - py;
    while (grid.has(key(cx, cy))) { s = grid.get(key(cx, cy)) + s; cx -= px; cy -= py; }
    cx = x + px; cy = y + py;
    while (grid.has(key(cx, cy))) { e += grid.get(key(cx, cy)); cx += px; cy += py; }
    if ((s || e) && !dict.has(s + l + e)) return null;
  }
  return placed;
}

// Word indexes (into dict.words) that hand + at most one grid letter can spell.
// pool limits the search (used by rebuilds); otherwise the whole dictionary.
function candidates(dict, hand, anchorLetters, maxLen, pool) {
  const counts = dict.counts;
  const words = dict.words;
  const handSize = hand.reduce((a, b) => a + b, 0);
  const out = [];
  const scan = pool ?? words.keys();
  for (const i of scan) {
    const w = words[i];
    const len = w.length;
    if (len > maxLen || len > handSize + 1) continue;
    let missing = -1, bad = false;
    const base = i * 26;
    for (let k = 0; k < len; k++) {
      const c = w.charCodeAt(k) - A;
      // count deficit once per letter
      if (counts[base + c] > hand[c]) {
        const short = counts[base + c] - hand[c];
        if (short > 1 || (missing >= 0 && missing !== c)) { bad = true; break; }
        missing = c;
      }
    }
    if (bad) continue;
    if (anchorLetters === null) { if (missing < 0) out.push(i); continue; } // empty grid
    if (missing >= 0 ? anchorLetters.has(missing) : true) out.push(i);
  }
  return out;
}

function scoreWord(w, level, rng) {
  let s = w.length * 3;
  for (const l of w) s += AWKWARD[l] ?? 0;
  return s + rng() * (level.pickTop > 1 ? 6 : 1);
}

// Find a placement for some word. Returns {word, cells} or null.
function findMove(grid, dict, hand, level, rng, pool) {
  const handSize = hand.reduce((a, b) => a + b, 0);
  if (!handSize) return null;
  let anchors = null;
  let anchorLetters = null;
  if (grid.size) {
    anchors = [];
    anchorLetters = new Set();
    for (const [k, l] of grid) {
      const [x, y] = parseKey(k);
      anchors.push([x, y, l]);
      anchorLetters.add(l.charCodeAt(0) - A);
    }
  }
  const cand = candidates(dict, hand, anchorLetters, level.maxLen, pool)
    .map((i) => dict.words[i])
    .map((w) => [w, scoreWord(w, level, rng)])
    .sort((a, b) => b[1] - a[1]);

  if (!grid.size) {
    if (!cand.length) return null;
    const pick = cand[Math.floor(rng() * Math.min(level.pickTop, cand.length))][0];
    return { word: pick, cells: [...pick].map((l, i) => [i, 0, l]) };
  }

  // Best-scoring words first; each tried through every anchor in both directions.
  shuffleInPlace(anchors, rng);
  const budget = { tries: 40000 };
  const found = [];
  for (const [w] of cand) {
    const cells = firstPlacement(grid, dict, hand, w, anchors, rng, budget);
    if (cells) found.push({ word: w, cells });
    if (found.length >= level.pickTop || budget.tries <= 0) break;
  }
  return found.length ? found[Math.floor(rng() * found.length)] : null;
}

function firstPlacement(grid, dict, hand, w, anchors, rng, budget) {
  for (const [ax, ay, al] of anchors) {
    for (let i = 0; i < w.length; i++) {
      if (w[i] !== al) continue;
      for (const [dx, dy] of rng() < 0.5 ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]]) {
        if (--budget.tries <= 0) return null;
        const cells = tryPlace(grid, dict, hand, w, ax - i * dx, ay - i * dy, dx, dy);
        if (cells) return cells;
      }
    }
  }
  return null;
}

function shuffleInPlace(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// Build a fresh grid from scratch using `letters`. Best of a few randomized tries.
// Returns {grid, left: [letters]}.
export function buildGrid(letters, dict, level, rng, attempts = 6) {
  const total = toCounts(letters);
  const pool = candidates(dict, total, null, 15, null); // words spellable from all letters
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const hand = total.slice();
    const grid = new Map();
    const lvl = { ...level, maxLen: 15, pickTop: a === 0 ? 1 : 4 };
    for (;;) {
      const move = findMove(grid, dict, hand, lvl, rng, pool);
      if (!move) break;
      for (const [x, y, l] of move.cells) { grid.set(key(x, y), l); hand[l.charCodeAt(0) - A]--; }
    }
    const left = [];
    hand.forEach((n, c) => { for (let i = 0; i < n; i++) left.push(String.fromCharCode(A + c)); });
    if (!best || left.length < best.left.length) best = { grid, left };
    if (!left.length) break;
  }
  return best;
}

// True if `pool` (array of letters) contains every letter of `need` (with repeats).
function hasAll(pool, need) {
  const c = toCounts(pool);
  for (const l of need) if (--c[l.charCodeAt(0) - A] < 0) return false;
  return true;
}

// ---------- Bot ----------

export class Bot {
  constructor(game, index, dict, levelName = "medium", rng = Math.random) {
    this.game = game;
    this.i = index;
    this.dict = dict;
    this.levelName = levelName;
    this.level = LEVELS[levelName];
    this.rng = rng;
    this.stuck = 0;
  }
  get me() { return this.game.players[this.i]; }

  jitter(sec) { return sec * (0.75 + this.rng() * 0.5); }

  // Decide the next move. Returns {type, delay (seconds), ...}. Nothing is changed yet.
  plan() {
    const g = this.game, me = this.me, L = this.level;
    if (g.over || me.out) return { type: "idle", delay: 1 };
    if (!me.hand.length) {
      if (g.canPeel(this.i)) return { type: "peel", delay: this.jitter(0.8) };
      if (g.canFinish(this.i)) return { type: "finish", delay: this.jitter(1.2) };
      return { type: "wait", delay: 1 };
    }
    const hand = toCounts(me.hand);
    const move = findMove(me.grid, this.dict, hand, L, this.rng);
    if (move) {
      this.stuck = 0;
      return { type: "place", ...move, delay: this.jitter(L.think + L.perTile * move.cells.length) };
    }
    // Stuck. Dump the most awkward letter, else rebuild everything.
    this.stuck++;
    // A really awkward letter (Q, J, X, Z) goes straight back; otherwise try a rebuild first.
    if (g.canDump(this.i) && this.stuck === 1) {
      const letter = [...me.hand].sort((a, b) => (AWKWARD[b] ?? 0) - (AWKWARD[a] ?? 0))[0];
      if ((AWKWARD[letter] ?? 0) >= 7) return { type: "dump", letter, delay: this.jitter(L.think + 1.5) };
    }
    if (this.stuck > 6) return { type: "wait", delay: this.jitter(10) }; // gives up for a while
    const all = [...me.grid.values(), ...me.hand];
    const built = buildGrid(all, this.dict, L, this.rng);
    if (built.left.length < me.hand.length) {
      return { type: "rebuild", grid: built.grid, left: built.left, delay: this.jitter(L.rebuild + 0.4 * all.length) };
    }
    if (g.canDump(this.i)) {
      const letter = me.hand[Math.floor(this.rng() * me.hand.length)];
      return { type: "dump", letter, delay: this.jitter(L.think + 1.5) };
    }
    return { type: "wait", delay: this.jitter(4) };
  }

  // Carry out a planned move. Returns true if it took effect.
  apply(move) {
    const g = this.game, me = this.me;
    if (g.over || me.out) return false;
    switch (move.type) {
      case "place": {
        // The hand may have grown since planning (a peel) but never shrinks, so the
        // letters are still there. Re-check the cells are free.
        for (const [x, y] of move.cells) if (me.grid.has(key(x, y))) return false;
        if (!hasAll(me.hand, move.cells.map((c) => c[2]))) return false;
        for (const [x, y, l] of move.cells) {
          me.grid.set(key(x, y), l);
          me.hand.splice(me.hand.indexOf(l), 1);
        }
        g.emit({ type: "place", player: this.i, word: move.word, tiles: move.cells.length });
        return true;
      }
      case "rebuild": {
        // Letters drawn since planning are kept in hand.
        const extra = [...me.hand];
        for (const l of [...me.grid.values()]) extra.push(l);
        if (!hasAll(extra, [...move.grid.values()])) return false;
        for (const l of move.grid.values()) extra.splice(extra.indexOf(l), 1);
        me.grid = move.grid;
        me.hand = extra;
        g.emit({ type: "rebuild", player: this.i });
        return true;
      }
      case "dump": return !!g.dump(this.i, move.letter);
      case "peel": return g.peel(this.i);
      case "finish": return !!g.finish(this.i, this.dict);
      default: return false;
    }
  }
}

export { isConnected, DUMP_MIN };
