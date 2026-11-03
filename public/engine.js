// Core rules: tile bag, dictionary, grid validation, peel / dump / finish.
// No DOM, so node tests can import it.

export const APP_NAME = "Tile Rush";

// The standard 144-tile set used by Bananagrams-style games.
export const TILE_COUNTS = {
  A: 13, B: 3, C: 3, D: 6, E: 18, F: 3, G: 4, H: 3, I: 12, J: 2, K: 2, L: 5, M: 3,
  N: 8, O: 11, P: 3, Q: 2, R: 9, S: 6, T: 9, U: 6, V: 3, W: 3, X: 2, Y: 3, Z: 2,
};
export const START_HAND = 21; // 2 to 4 players (you plus up to 3 bots); solo uses 21 too
export const DUMP_MIN = 3;    // the pool needs 3+ tiles to dump 1 for 3

// ---------- Random ----------
// Small seedable PRNG so tests and simulations can be repeated.
export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Bag ----------
// size < 144 builds a smaller pool with the same letter mix (for quick solo games).
export function makeBag(rng = Math.random, size = 144) {
  const full = [];
  for (const [l, n] of Object.entries(TILE_COUNTS)) for (let i = 0; i < n; i++) full.push(l);
  shuffle(full, rng);
  return full.slice(0, size);
}

// ---------- Dictionary ----------
export class Dictionary {
  constructor(text) {
    this.words = text.split(/\r?\n/).map((w) => w.trim().toUpperCase()).filter((w) => w.length >= 2);
    this.set = new Set(this.words);
    this._counts = null;
  }
  has(w) { return this.set.has(w.toUpperCase()); }
  // Letter counts for every word, packed: counts[i*26 + c]. Built lazily for the bot.
  get counts() {
    if (!this._counts) {
      const c = new Uint8Array(this.words.length * 26);
      this.words.forEach((w, i) => { for (let k = 0; k < w.length; k++) c[i * 26 + w.charCodeAt(k) - 65]++; });
      this._counts = c;
    }
    return this._counts;
  }
}

// ---------- Grid ----------
// A grid is an open-ended Map "x,y" -> letter (Bananagrams has no board edges).
export const key = (x, y) => `${x},${y}`;
export const parseKey = (k) => k.split(",").map(Number);

// All runs of 2+ letters, across and down: [{word, cells:[[x,y],...], dir}]
export function findWords(grid) {
  const out = [];
  for (const k of grid.keys()) {
    const [x, y] = parseKey(k);
    for (const [dx, dy, dir] of [[1, 0, "across"], [0, 1, "down"]]) {
      if (grid.has(key(x - dx, y - dy))) continue; // not the start of a run
      if (!grid.has(key(x + dx, y + dy))) continue; // single letter
      let word = "";
      const cells = [];
      let cx = x, cy = y;
      while (grid.has(key(cx, cy))) {
        word += grid.get(key(cx, cy));
        cells.push([cx, cy]);
        cx += dx; cy += dy;
      }
      out.push({ word, cells, dir });
    }
  }
  return out;
}

export function isConnected(grid) {
  if (grid.size <= 1) return true;
  const start = grid.keys().next().value;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const [x, y] = parseKey(stack.pop());
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      if (grid.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  return seen.size === grid.size;
}

// {valid, connected, words, invalid:[{word,cells}], lonely} — lonely = a lone tile with no word
export function validateGrid(grid, dict) {
  const words = findWords(grid);
  const invalid = words.filter((w) => !dict.has(w.word));
  const connected = isConnected(grid);
  // A connected grid of 2+ tiles puts every tile in a word.
  const valid = grid.size >= 2 && connected && invalid.length === 0;
  return { valid, connected, words, invalid };
}

// ---------- Game ----------
// Players: index 0 is the human (or the only player), 1..3 are bots.
// Each player: {name, hand: [letters], grid: Map, isBot, dumps, peels, out}
export class Game {
  constructor({ players = 1, rng = Math.random, bagSize = 144, names } = {}) {
    this.rng = rng;
    this.bag = makeBag(rng, bagSize);
    this.players = [];
    for (let i = 0; i < players; i++) {
      this.players.push({
        name: names?.[i] ?? (i === 0 ? "You" : `Bot ${i}`),
        hand: this.bag.splice(0, START_HAND),
        grid: new Map(),
        isBot: i > 0,
        dumps: 0, peels: 0, out: false,
      });
    }
    this.winner = null;   // player index
    this.over = false;
    this.log = [];        // [{type, player, ...}]
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { this.log.push(ev); for (const fn of this.listeners) fn(ev); }

  get activePlayers() { return this.players.filter((p) => !p.out); }

  // Can this player peel right now? (hand empty, grid connected, pool has enough)
  canPeel(i) {
    const p = this.players[i];
    return !this.over && !p.out && p.hand.length === 0 && p.grid.size > 0 && isConnected(p.grid)
      && this.bag.length >= this.activePlayers.length;
  }

  // Can this player call the finish? (hand empty, pool too small to peel)
  canFinish(i) {
    const p = this.players[i];
    return !this.over && !p.out && p.hand.length === 0 && p.grid.size > 0 && isConnected(p.grid)
      && this.bag.length < this.activePlayers.length;
  }

  canDump(i) {
    return !this.over && !this.players[i].out && this.bag.length >= DUMP_MIN;
  }

  // Every active player draws one tile.
  peel(i) {
    if (!this.canPeel(i)) return false;
    this.players[i].peels++;
    const drawn = [];
    for (const p of this.activePlayers) {
      const t = this.bag.pop();
      p.hand.push(t);
      drawn.push(t);
    }
    this.emit({ type: "peel", player: i, left: this.bag.length });
    return true;
  }

  // One tile straight from the pool to one player (solo "pressure" mode's timed draw).
  draw(i) {
    if (this.over || !this.bag.length) return null;
    const t = this.bag.pop();
    this.players[i].hand.push(t);
    this.emit({ type: "draw", player: i, letter: t, left: this.bag.length });
    return t;
  }

  // Return one tile (from hand), draw three. Tile goes back into a random spot.
  dump(i, letter) {
    if (!this.canDump(i)) return null;
    const p = this.players[i];
    const at = p.hand.indexOf(letter);
    if (at < 0) return null;
    p.hand.splice(at, 1);
    const drawn = this.bag.splice(this.bag.length - DUMP_MIN, DUMP_MIN);
    this.bag.splice(Math.floor(this.rng() * (this.bag.length + 1)), 0, letter);
    p.hand.push(...drawn);
    p.dumps++;
    this.emit({ type: "dump", player: i, letter, drawn, left: this.bag.length });
    return drawn;
  }

  // Call the finish (grid must be connected). Valid words win; invalid grid ("rotten") puts the player out:
  // their tiles go back to the pool and the others play on.
  finish(i, dict) {
    if (!this.canFinish(i)) return null;
    const p = this.players[i];
    const result = validateGrid(p.grid, dict);
    if (result.valid) {
      this.over = true;
      this.winner = i;
      this.emit({ type: "win", player: i });
    } else {
      p.out = true;
      for (const l of p.grid.values()) this.bag.splice(Math.floor(this.rng() * (this.bag.length + 1)), 0, l);
      p.grid = new Map(p.grid); // keep a copy for the results screen
      this.emit({ type: "rotten", player: i, invalid: result.invalid });
      if (this.activePlayers.length === 0) { this.over = true; this.emit({ type: "nowinner" }); }
    }
    return result;
  }

  // Ends the game with no winner (e.g. the human quits or everyone is stuck).
  end() { this.over = true; this.emit({ type: "ended" }); }

  // Plain-JSON snapshot for save/resume.
  toJSON() {
    return {
      bag: this.bag, winner: this.winner, over: this.over,
      players: this.players.map((p) => ({ ...p, grid: [...p.grid] })),
    };
  }
  static fromJSON(s, rng = Math.random) {
    const g = new Game({ players: 0, rng });
    g.bag = s.bag; g.winner = s.winner; g.over = s.over;
    g.players = s.players.map((p) => ({ ...p, grid: new Map(p.grid) }));
    return g;
  }
}
