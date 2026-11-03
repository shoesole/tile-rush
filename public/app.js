// UI: screens, board (pan / pinch / drag), rack, game flow, stats, save/resume.
import { Dictionary, Game, key, parseKey, validateGrid, isConnected, findWords, DUMP_MIN } from "./engine.js";
import { BotRunner, Clock } from "./botrunner.js";
import { LEVELS } from "./bot.js";

const APP_VERSION = "1.2"; // bump with VERSION in sw.js whenever public/ changes
const CELL = 44;           // board cell size in plane pixels (matches styles.css)
const OFF = 60;            // the plane spans cells -OFF..OFF in each direction
const BOT_NAMES = ["Juno", "Milo", "Ruby"];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------- Storage (never throws) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const DEFAULTS = { bots: "1", level: "medium", checkBots: "off", checkSolo: "on", pool: "144", pressure: "60", theme: "system", haptics: "on" };
const settings = { ...DEFAULTS, ...store.get("tr-settings", {}) };
const saveSettings = () => store.set("tr-settings", settings);

function applyTheme() {
  if (settings.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", settings.theme);
}
applyTheme();

// ---------- Haptics ----------
// Android: navigator.vibrate. iOS 18+: toggling a hidden <input switch> gives a light tick
// (only reliably inside a tap; elsewhere it does nothing).
function buzz(ms = 10) {
  if (settings.haptics !== "on") return;
  if (navigator.vibrate) navigator.vibrate(ms);
  else $("haptic").click();
}

// ---------- Screens ----------
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  if (id === "home") renderHome();
}
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());

// ---------- Dictionary ----------
let dict = null;
fetch("words.txt").then((r) => r.text()).then((t) => {
  dict = new Dictionary(t);
  $("status").hidden = true;
  ["play-bots", "play-solo", "play-pressure", "resume"].forEach((id) => { $(id).disabled = false; });
  renderHome();
}).catch(() => { $("status").textContent = "Couldn't load the dictionary. Check your connection and reopen."; });

// ---------- Stats ----------
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const bestKey = (mode, pool, pressure) => mode === "pressure" ? `pressure-${pool}-${pressure}` : `solo-${pool}`;

function recordGame(rec) {
  const hist = store.get("tr-history", []);
  hist.push(rec);
  store.set("tr-history", hist.slice(-300));
  if (rec.mode !== "bots" && rec.result === "win") {
    const best = store.get("tr-best", {});
    const k = bestKey(rec.mode, rec.pool, rec.pressure);
    const isBest = !best[k] || rec.ms < best[k];
    if (isBest) { best[k] = rec.ms; store.set("tr-best", best); }
    return isBest;
  }
  return false;
}

function renderHome() {
  const n = +settings.bots;
  $("bots-sub").textContent = `${n} ${LEVELS[settings.level].label} bot${n > 1 ? "s" : ""} · first to use every tile wins`;
  const best = store.get("tr-best", {});
  const bs = best[bestKey("solo", settings.pool)];
  $("solo-sub").textContent = `Empty a ${settings.pool}-tile pool${bs ? ` · best ${fmt(bs)}` : " against the clock"}`;
  const bp = best[bestKey("pressure", settings.pool, settings.pressure)];
  $("pressure-sub").textContent = `A new tile every ${settings.pressure}s, plus your peels${bp ? ` · best ${fmt(bp)}` : ""}`;
  $("settings-summary").textContent = `${n} bot${n > 1 ? "s" : ""} · ${LEVELS[settings.level].label} · ${settings.pool} tiles`;
  $("version").textContent = `Version ${APP_VERSION}`;

  const save = store.get("tr-save", null);
  $("resume").hidden = !save;
  if (save) $("resume-sub").textContent = `${modeName(save.mode)} · ${fmt(save.elapsed)} played`;

  const hist = store.get("tr-history", []);
  const stats = $("stats");
  stats.replaceChildren();
  if (!hist.length) return;
  const vs = hist.filter((h) => h.mode === "bots");
  if (vs.length) {
    stats.append(el("h3", null, "Against the bots"));
    const row = el("div", "stat-row");
    for (const lv of ["easy", "medium", "hard"]) {
      const g = vs.filter((h) => h.level === lv);
      const w = g.filter((h) => h.result === "win").length;
      row.append(el("div", "stat", `<b>${w}–${g.length - w}</b><span>${LEVELS[lv].label}</span>`));
    }
    stats.append(row);
  }
  const solo = Object.entries(best);
  if (solo.length) {
    stats.append(el("h3", null, "Best times"));
    const row = el("div", "stat-row");
    for (const [k, ms] of solo.sort()) {
      const [mode, pool, sec] = k.split("-");
      row.append(el("div", "stat", `<b>${fmt(ms)}</b><span>${mode === "solo" ? "Solo" : `Pressure ${sec}s`} · ${pool}</span>`));
    }
    stats.append(row);
  }
  const mine = hist.filter((h) => h.tpm);
  if (mine.length) {
    const recent = mine.slice(-10);
    const tpm = recent.reduce((a, h) => a + h.tpm, 0) / recent.length;
    const row = el("div", "stat-row");
    row.append(el("div", "stat", `<b>${hist.length}</b><span>Games</span>`));
    row.append(el("div", "stat", `<b>${tpm.toFixed(1)}</b><span>Tiles/min, last 10</span>`));
    row.append(el("div", "stat", `<b>${Math.max(...hist.map((h) => h.longest?.length ?? 0)) || "–"}</b><span>Longest word</span>`));
    stats.append(el("h3", null, "You"), row);
  }
}
const modeName = (m) => ({ bots: "Race the Bots", solo: "Solo Race", pressure: "Solo Pressure" }[m]);

// ---------- Settings screen ----------
function renderSettings() {
  document.querySelectorAll(".seg").forEach((seg) => {
    const name = seg.dataset.setting;
    seg.replaceChildren();
    for (const opt of seg.dataset.options.split(",")) {
      const [val, label = val] = opt.split(":");
      const b = el("button", settings[name] === val ? "on" : "", label);
      b.addEventListener("click", () => {
        settings[name] = val; saveSettings(); applyTheme(); renderSettings();
      });
      seg.append(b);
    }
  });
}
$("open-settings").addEventListener("click", () => { renderSettings(); show("settings"); });
$("open-rules").addEventListener("click", () => show("rules"));
$("reset-stats").addEventListener("click", () => {
  store.del("tr-history"); store.del("tr-best");
  $("reset-stats").textContent = "Stats cleared";
  setTimeout(() => { $("reset-stats").textContent = "Reset stats"; }, 1500);
});

// ---------- Game session ----------
let S = null;
const me = () => S.game.players[0];

function newGame(mode) {
  const bots = mode === "bots" ? +settings.bots : 0;
  const names = ["You", ...BOT_NAMES.slice(0, bots)];
  const game = new Game({ players: 1 + bots, bagSize: mode === "bots" ? 144 : +settings.pool, names });
  startSession({ mode, game, level: settings.level, pool: +settings.pool, pressure: +settings.pressure, elapsed: 0 });
}

function startSession({ mode, game, level, pool, pressure, elapsed, nextDrawIn, view }) {
  if (S) stopSession();
  const clock = new Clock();
  clock.set(elapsed);
  S = {
    mode, game, level, pool, pressure, clock,
    check: (mode === "bots" ? settings.checkBots : settings.checkSolo) === "on",
    runner: null, cursor: null, selected: null, undo: [], recent: null, forceCheck: false,
    view: view ?? { tx: 0, ty: 0, s: 1 }, nextDrawAt: mode === "pressure" ? elapsed + (nextDrawIn ?? pressure * 1000) : null,
    ended: false, lastSave: 0,
  };
  game.on(onGameEvent);
  if (mode === "bots") { 
    S.runner = new BotRunner(game, dict, level, clock);
    S.runner.onError = () => toast("The bots couldn't start. Give up and try again.", 6000);
    S.runner.start();
  }
  show("game");
  $("pressure-bar").hidden = true;
  $("rivals").classList.toggle("many", game.players.length > 2);
  if (!view) centerView();
  applyView();
  render();
  clock.start();
  S.ticker = setInterval(tick, 200);
  tick();
}

function stopSession() {
  if (!S) return;
  clearInterval(S.ticker);
  S.runner?.stop();
  S.clock.pause();
  S.ended = true;
}

function saveSession() {
  if (!S || S.ended) return;
  store.set("tr-save", {
    mode: S.mode, level: S.level, pool: S.pool, pressure: S.pressure,
    game: S.game.toJSON(), elapsed: S.clock.now(), view: S.view,
    nextDrawIn: S.nextDrawAt != null ? S.nextDrawAt - S.clock.now() : null,
  });
  S.lastSave = performance.now();
}

$("resume").addEventListener("click", () => {
  const s = store.get("tr-save", null);
  if (!s || !dict) return;
  startSession({ ...s, game: Game.fromJSON(s.game) });
});
$("play-bots").addEventListener("click", () => newGame("bots"));
$("play-solo").addEventListener("click", () => newGame("solo"));
$("play-pressure").addEventListener("click", () => newGame("pressure"));

function tick() {
  if (!S || S.ended) return;
  const now = S.clock.now();
  $("clock").textContent = fmt(now);
  if (S.mode === "pressure") {
    const bar = $("pressure-bar");
    if (S.game.bag.length && S.clock.running) {
      if (now >= S.nextDrawAt) {
        S.game.draw(0);
        S.nextDrawAt += S.pressure * 1000;
      }
      bar.hidden = false;
      bar.firstElementChild.style.width = `${100 * (1 - (S.nextDrawAt - now) / (S.pressure * 1000))}%`;
    } else bar.hidden = true;
  }
  if (performance.now() - S.lastSave > 3000) saveSession();
}

function onGameEvent(ev) {
  if (!S) return;
  const who = S.game.players[ev.player]?.name;
  switch (ev.type) {
    case "peel":
      if (ev.player === 0) toast(S.mode === "bots" ? "Peel! Everyone draws a tile" : "Peel! +1 tile");
      else { toast(`${who} peeled · +1 tile`); flashRival(ev.player); buzz(15); }
      break;
    case "dump":
      if (ev.player !== 0) { toast(`${who} dumped a tile`); }
      break;
    case "draw": toast("+1 tile"); buzz(15); break;
    case "win":
      if (ev.player !== 0) return endGame("lose", ev.player);
      return endGame("win", 0);
  }
  render();
}

function endGame(result, winner) {
  if (!S || S.ended) return;
  const ms = S.clock.now();
  stopSession();
  store.del("tr-save");
  const p = me();
  const longest = longestWord(p.grid);
  const placed = p.grid.size;
  const rec = {
    date: new Date().toISOString(), mode: S.mode, level: S.mode === "bots" ? S.level : null,
    bots: S.game.players.length - 1, pool: S.mode === "bots" ? 144 : S.pool, pressure: S.mode === "pressure" ? S.pressure : null,
    result, ms, tiles: placed, dumps: p.dumps, peels: p.peels, longest,
    tpm: ms > 20000 ? +(placed / (ms / 60000)).toFixed(2) : null,
  };
  const isBest = recordGame(rec);
  showResults(result, winner, ms, isBest);
}

const longestWord = (grid) => findWords(grid).map((w) => w.word).filter((w) => dict.has(w))
  .reduce((a, w) => (w.length > a.length ? w : a), "");

// ---------- Rendering ----------
function render() {
  if (!S) return;
  renderBoard();
  renderRack();
  renderBar();
}

function renderBoard() {
  const p = me();
  const plane = $("plane");
  const size = (2 * OFF + 1) * CELL;
  plane.style.width = plane.style.height = `${size}px`;
  const bad = new Set();
  if (S.check || S.forceCheck) {
    for (const w of validateGrid(p.grid, dict).invalid) for (const [x, y] of w.cells) bad.add(key(x, y));
  }
  const kids = [];
  for (const [k, l] of p.grid) {
    const [x, y] = parseKey(k);
    const t = el("div", "tile", `<i>${l}</i>`);
    t.dataset.key = k;
    if (bad.has(k)) t.classList.add("bad");
    if (k === S.recent) t.classList.add("recent");
    if (S.drag?.from === "board" && S.drag.key === k) t.classList.add("lifted");
    t.style.transform = `translate(${(x + OFF) * CELL}px, ${(y + OFF) * CELL}px)`;
    kids.push(t);
  }
  if (S.cursor) {
    const c = el("div", "cursor", S.cursor.dir === "across" ? "→" : "↓");
    c.style.transform = `translate(${(S.cursor.x + OFF) * CELL}px, ${(S.cursor.y + OFF) * CELL}px)`;
    if (p.grid.has(key(S.cursor.x, S.cursor.y))) c.classList.add("on-tile");
    kids.push(c);
  }
  if (S.hint) {
    const h = el("div", "drop-hint");
    h.style.transform = `translate(${(S.hint.x + OFF) * CELL}px, ${(S.hint.y + OFF) * CELL}px)`;
    kids.push(h);
  }
  plane.replaceChildren(...kids);
  S.recent = null;
}

function renderRack() {
  const rack = $("rack");
  const hand = me().hand;
  if (!hand.length) {
    rack.replaceChildren(el("div", "rack-empty", peelState().empty));
    return;
  }
  // Shrink tiles as the hand grows so it fits in about 3 rows (min 32px); beyond that the rack scrolls.
  const w = rack.clientWidth - 2 * 16;
  let size = 42;
  while (size > 30 && Math.ceil(hand.length / Math.floor((w + 5) / (size + 5))) > 3) size -= 2;
  rack.style.setProperty("--rt", `${size}px`);
  rack.replaceChildren(...hand.map((l, i) => {
    const t = el("div", "tile", `<i>${l}</i>`);
    t.dataset.idx = i;
    if (S.selected === i) t.classList.add("selected");
    if (S.drag?.from === "rack" && S.drag.idx === i) t.classList.add("lifted");
    return t;
  }));
}

// What the big button does right now.
function peelState() {
  const g = S.game, p = me();
  if (p.hand.length) return { label: `${p.hand.length} left`, ready: false, empty: "" };
  const peel = g.bag.length >= g.activePlayers.length;
  return {
    label: peel ? "Peel" : "Done!",
    ready: true,
    action: peel ? "peel" : "finish",
    empty: peel ? "All placed. Peel when your grid is ready!" : "All placed. Tap Done! to finish",
  };
}

function renderBar() {
  const g = S.game;
  $("pool-count").textContent = g.bag.length;
  const ps = peelState();
  const btn = $("peel-btn");
  btn.textContent = ps.label;
  btn.disabled = !ps.ready;
  btn.classList.toggle("ready", ps.ready);
  const dump = $("dump-btn");
  dump.disabled = g.bag.length < DUMP_MIN;
  dump.classList.toggle("armed", S.selected != null || !!S.dumpArmed);
  $("back-btn").disabled = !S.undo.length;

  const rivals = $("rivals");
  const bots = g.players.map((p, i) => [p, i]).filter(([p]) => p.isBot);
  if (rivals.children.length !== bots.length) {
    rivals.replaceChildren(...bots.map(([p, i]) => {
      const r = el("div", "rival", `<b>${p.name}</b><span class="meter"><i></i></span><span class="hand"></span>`);
      r.dataset.i = i;
      return r;
    }));
  }
  for (const [p, i] of bots) {
    const r = rivals.querySelector(`[data-i="${i}"]`);
    const total = p.grid.size + p.hand.length;
    r.querySelector("i").style.width = `${total ? (100 * p.grid.size) / total : 0}%`;
    r.querySelector(".hand").textContent = g.players.length > 2 ? `${p.hand.length}` : p.hand.length ? `${p.hand.length} left` : "all placed";
  }
}

function flashRival(i) {
  const r = $("rivals").querySelector(`[data-i="${i}"]`);
  if (!r) return;
  r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
}

let toastTimer = null;
function toast(msg, ms = 1800) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- View (pan / zoom) ----------
function applyView() {
  const { tx, ty, s } = S.view;
  $("plane").style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}

function centerView() {
  const rect = $("board").getBoundingClientRect();
  const keys = [...me().grid.keys()].map(parseKey);
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  if (keys.length) {
    minX = Math.min(...keys.map((k) => k[0])); maxX = Math.max(...keys.map((k) => k[0]));
    minY = Math.min(...keys.map((k) => k[1])); maxY = Math.max(...keys.map((k) => k[1]));
  }
  const w = (maxX - minX + 3) * CELL, h = (maxY - minY + 3) * CELL;
  const s = Math.max(0.35, Math.min(1, rect.width / w, rect.height / h));
  const cx = ((minX + maxX + 1) / 2 + OFF) * CELL, cy = ((minY + maxY + 1) / 2 + OFF) * CELL;
  S.view = { s, tx: rect.width / 2 - cx * s, ty: rect.height / 2 - cy * s };
}

function zoomAt(clientX, clientY, newS) {
  const rect = $("board").getBoundingClientRect();
  const { tx, ty, s } = S.view;
  newS = Math.max(0.3, Math.min(2, newS));
  const px = clientX - rect.left, py = clientY - rect.top;
  S.view = { s: newS, tx: px - ((px - tx) / s) * newS, ty: py - ((py - ty) / s) * newS };
  applyView();
}

function cellAt(clientX, clientY) {
  const rect = $("board").getBoundingClientRect();
  const { tx, ty, s } = S.view;
  return {
    x: Math.floor((clientX - rect.left - tx) / s / CELL) - OFF,
    y: Math.floor((clientY - rect.top - ty) / s / CELL) - OFF,
  };
}
const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

// ---------- Moves (the human's grid and hand) ----------
// Undo history: a snapshot of the grid (and cursor) before each change, up to UNDO_MAX.
// Undo restores the grid; the hand becomes "everything else you hold", so tiles that
// arrived since (peels, pressure draws) stay in your rack. A dump clears the history.
const UNDO_MAX = 100;
function remember() {
  S.undo.push({ grid: [...me().grid], cursor: S.cursor && { ...S.cursor } });
  if (S.undo.length > UNDO_MAX) S.undo.shift();
}

function undo() {
  const snap = S.undo.pop();
  if (!snap) return toast("Nothing to undo");
  const p = me();
  const left = new Map();
  for (const l of [...p.hand, ...p.grid.values()]) left.set(l, (left.get(l) ?? 0) + 1);
  for (const [, l] of snap.grid) {
    if (!left.get(l)) { S.undo = []; render(); return toast("Can't undo past that"); }
    left.set(l, left.get(l) - 1);
  }
  // Keep the rack order you had; tiles coming off the board go on the end.
  const hand = [];
  for (const l of p.hand) if (left.get(l)) { hand.push(l); left.set(l, left.get(l) - 1); }
  for (const l of p.grid.values()) if (left.get(l)) { hand.push(l); left.set(l, left.get(l) - 1); }
  p.grid = new Map(snap.grid);
  p.hand = hand;
  S.cursor = snap.cursor;
  S.selected = null;
  buzz();
  changed();
}

function changed(k) {
  if (k) S.recent = k;
  S.forceCheck = false;
  render();
  saveSession();
}

function placeFromRack(idx, x, y) {
  const p = me();
  const k = key(x, y);
  const l = p.hand[idx];
  if (l == null) return;
  remember();
  p.hand.splice(idx, 1);
  if (p.grid.has(k)) p.hand.push(p.grid.get(k)); // swap the old tile back to the rack
  p.grid.set(k, l);
  S.selected = null;
  buzz();
  changed(k);
}

function moveOnBoard(from, x, y) {
  const p = me();
  const to = key(x, y);
  if (from === to || !p.grid.has(from)) return;
  remember();
  const l = p.grid.get(from);
  if (p.grid.has(to)) p.grid.set(from, p.grid.get(to)); else p.grid.delete(from);
  p.grid.set(to, l);
  buzz();
  changed(to);
}

function returnToRack(k) {
  const p = me();
  if (!p.grid.has(k)) return;
  remember();
  p.hand.push(p.grid.get(k));
  p.grid.delete(k);
  changed();
}

function dumpLetter(source) {
  const g = S.game;
  if (!g.canDump(0)) return toast(`Dump needs ${DUMP_MIN}+ tiles in the pool`);
  const p = me();
  let letter;
  if (source.from === "board") {
    letter = p.grid.get(source.key);
    if (!letter) return;
    p.grid.delete(source.key);
    p.hand.push(letter);
  } else letter = p.hand[source.idx];
  // Engine dumps the first matching letter; move this one to the front so it's the one used.
  const at = source.from === "board" ? p.hand.length - 1 : source.idx;
  p.hand.splice(at, 1);
  p.hand.unshift(letter);
  const drawn = g.dump(0, letter);
  S.undo = []; // the dumped tile is gone, so earlier grids can't come back
  S.selected = null;
  buzz(20);
  toast(`Dumped ${letter} · drew ${drawn.join(" ")}`);
  changed();
}

// Type-a-word: place rack tile `idx` at the cursor, skipping squares already filled.
function placeAtCursor(idx) {
  const c = S.cursor;
  const p = me();
  const [dx, dy] = c.dir === "across" ? [1, 0] : [0, 1];
  let { x, y } = c;
  while (p.grid.has(key(x, y))) { x += dx; y += dy; }
  const l = p.hand[idx];
  remember();
  p.hand.splice(idx, 1);
  const k = key(x, y);
  p.grid.set(k, l);
  S.cursor = { x: x + dx, y: y + dy, dir: c.dir };
  buzz();
  changed(k);
}

function tapCell(x, y) {
  if (S.selected != null) return placeFromRack(S.selected, x, y);
  const c = S.cursor;
  if (c && c.x === x && c.y === y) {
    S.cursor = c.dir === "across" ? { ...c, dir: "down" } : null;
  } else {
    S.cursor = { x, y, dir: c?.dir ?? "across" };
  }
  render();
}

function tapRack(idx) {
  if (S.dumpArmed) { S.dumpArmed = false; return dumpLetter({ from: "rack", idx }); }
  if (S.cursor) return placeAtCursor(idx);
  S.selected = S.selected === idx ? null : idx;
  render();
}

// ---------- Pointer handling ----------
// Captured on the board / rack element (not the tile), so re-rendering mid-drag is safe.
const pointers = new Map();
let press = null; // {kind: 'tile'|'pan', from, idx, key, x0, y0, moved}
let pinch = null;
let ghost = null;

function onDown(e) {
  if (!S || S.ended) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    // Second finger: switch to pinch (unless a tile is already being dragged).
    if (press?.kind === "tile" && press.moved) return;
    endDrag();
    press = null;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: S.view.s };
    return;
  }
  if (pointers.size > 2) return;
  const tile = e.target.closest(".tile");
  const inBoard = $("board").contains(e.target);
  if (tile) {
    press = tile.dataset.key != null
      ? { kind: "tile", from: "board", key: tile.dataset.key, x0: e.clientX, y0: e.clientY, moved: false }
      : { kind: "tile", from: "rack", idx: +tile.dataset.idx, x0: e.clientX, y0: e.clientY, moved: false };
  } else if (inBoard) {
    press = { kind: "pan", x0: e.clientX, y0: e.clientY, tx0: S.view.tx, ty0: S.view.ty, moved: false };
  } else press = null;
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.s * d) / pinch.d);
    return;
  }
  if (!press) return;
  const dx = e.clientX - press.x0, dy = e.clientY - press.y0;
  if (!press.moved && Math.hypot(dx, dy) < 7) return;
  press.moved = true;
  if (press.kind === "pan") {
    S.view.tx = press.tx0 + dx; S.view.ty = press.ty0 + dy;
    applyView();
  } else dragTo(e.clientX, e.clientY);
}

function onUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) { pinch = null; press = null; } return; }
  const p = press;
  press = null;
  if (!p || !S || S.ended) return endDrag();
  if (e.type === "pointercancel") return endDrag();
  if (!p.moved) {
    if (p.kind === "tile" && p.from === "rack") tapRack(p.idx);
    else if (p.kind === "tile") { const [x, y] = parseKey(p.key); tapCell(x, y); }
    else { const c = cellAt(e.clientX, e.clientY); tapCell(c.x, c.y); }
    return;
  }
  if (p.kind === "tile") drop(p, e.clientX, e.clientY);
}

function dragTo(x, y) {
  if (!S.drag) {
    const letter = press.from === "rack" ? me().hand[press.idx] : me().grid.get(press.key);
    S.drag = { ...press, letter };
    ghost = el("div", "ghost", `<i>${letter}</i>`);
    document.body.append(ghost);
    S.selected = null;
    render();
  }
  const size = Math.max(38, CELL * S.view.s);
  ghost.style.width = ghost.style.height = `${size}px`;
  ghost.firstElementChild.style.fontSize = `${size * 0.55}px`;
  ghost.style.transform = `translate(${x - size / 2}px, ${y - size * 0.9}px)`;
  const target = dropTarget(x, y - size * 0.4);
  $("dump-btn").classList.toggle("hot", target.kind === "dump");
  const hint = target.kind === "cell" ? target : null;
  if (hint?.x !== S.hint?.x || hint?.y !== S.hint?.y) { S.hint = hint; renderBoard(); }
}

function dropTarget(x, y) {
  if (inside($("dump-btn").getBoundingClientRect(), x, y)) return { kind: "dump" };
  const rackR = $("rack").getBoundingClientRect();
  const actR = $("game").querySelector(".actions").getBoundingClientRect();
  if (y >= actR.top || inside(rackR, x, y)) return { kind: "rack" };
  if (inside($("board").getBoundingClientRect(), x, y)) return { kind: "cell", ...cellAt(x, y) };
  return { kind: "none" };
}

function drop(p, x, y) {
  const size = Math.max(38, CELL * S.view.s);
  const t = dropTarget(x, y - size * 0.4);
  const d = S.drag;
  endDrag();
  if (!d) return;
  if (t.kind === "dump") return dumpLetter(d);
  if (t.kind === "rack") { if (d.from === "board") returnToRack(d.key); return; }
  if (t.kind === "cell") {
    if (d.from === "rack") placeFromRack(d.idx, t.x, t.y);
    else moveOnBoard(d.key, t.x, t.y);
  }
}

function endDrag() {
  ghost?.remove();
  ghost = null;
  if (S) { S.drag = null; S.hint = null; render(); }
  $("dump-btn").classList.remove("hot");
}

for (const id of ["board", "rack"]) {
  const n = $(id);
  n.addEventListener("pointerdown", onDown);
  n.addEventListener("pointermove", onMove);
  n.addEventListener("pointerup", onUp);
  n.addEventListener("pointercancel", onUp);
}
$("board").addEventListener("wheel", (e) => {
  if (!S) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, S.view.s * Math.exp(-e.deltaY / 200));
  else { S.view.tx -= e.deltaX; S.view.ty -= e.deltaY; applyView(); }
}, { passive: false });

// ---------- Buttons ----------
$("dump-btn").addEventListener("click", () => {
  if (S.selected != null) return dumpLetter({ from: "rack", idx: S.selected });
  if (!S.game.canDump(0)) return toast(`Dump needs ${DUMP_MIN}+ tiles in the pool`);
  S.dumpArmed = !S.dumpArmed;
  renderBar();
  if (S.dumpArmed) toast("Tap the rack tile to dump");
});
$("shuffle-btn").addEventListener("click", () => {
  const h = me().hand;
  for (let i = h.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [h[i], h[j]] = [h[j], h[i]]; }
  S.selected = null; render();
});
$("sort-btn").addEventListener("click", () => { me().hand.sort(); S.selected = null; render(); });
$("back-btn").addEventListener("click", undo);
$("center-btn").addEventListener("click", () => { centerView(); applyView(); });
$("peel-btn").addEventListener("click", () => {
  const ps = peelState();
  const g = S.game, p = me();
  if (!ps.ready) return;
  if (!isConnected(p.grid)) {
    if (S.mode !== "bots") { S.forceCheck = true; render(); }
    return toast("Join all your tiles into one grid first");
  }
  if (ps.action === "peel") {
    g.peel(0);
    buzz(15);
    return;
  }
  // Finish.
  const v = validateGrid(p.grid, dict);
  if (S.mode !== "bots" && !v.valid) {
    S.forceCheck = true;
    render();
    const bad = [...new Set(v.invalid.map((w) => w.word))];
    return toast(`Not words: ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}`, 3000);
  }
  const r = g.finish(0, dict);
  if (r && !r.valid) endGame("rotten");
});

// Pause menu
function pauseGame() {
  if (!S || S.ended) return;
  S.clock.pause();
  saveSession();
  $("pause").hidden = false;
}
$("menu-btn").addEventListener("click", pauseGame);
$("resume-btn").addEventListener("click", () => { $("pause").hidden = true; S.clock.start(); });
$("quit-btn").addEventListener("click", () => { $("pause").hidden = true; endGame("quit"); });
$("save-exit-btn").addEventListener("click", () => {
  $("pause").hidden = true;
  saveSession();
  stopSession();
  S = null;
  show("home");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && S && !S.ended && $("game").classList.contains("active")) pauseGame();
});

// Keyboard (hardware keyboards / desktop)
document.addEventListener("keydown", (e) => {
  if (!S || S.ended || !$("game").classList.contains("active") || !$("pause").hidden) return;
  const k = e.key;
  if (/^[a-z]$/i.test(k) && !e.metaKey && !e.ctrlKey) {
    if (!S.cursor) return toast("Tap a square first");
    const idx = me().hand.indexOf(k.toUpperCase());
    if (idx < 0) return toast(`No ${k.toUpperCase()} in your rack`);
    placeAtCursor(idx);
  } else if (k === "Backspace" || ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "z")) { e.preventDefault(); undo(); }
  else if (k === " " && S.cursor) { e.preventDefault(); S.cursor.dir = S.cursor.dir === "across" ? "down" : "across"; render(); }
  else if (k.startsWith("Arrow") && S.cursor) {
    e.preventDefault();
    const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    S.cursor.x += dx; S.cursor.y += dy; render();
  } else if (k === "Enter") $("peel-btn").click();
  else if (k === "Escape") { S.cursor = null; S.selected = null; render(); }
});

// ---------- Results ----------
let lastMode = "bots";
function showResults(result, winner, ms, isBest) {
  const g = S.game;
  lastMode = S.mode;
  const solo = S.mode !== "bots";
  const title = {
    win: solo ? "Pool cleared!" : "You win!",
    lose: `${g.players[winner]?.name} wins`,
    rotten: "Rotten!",
    quit: "Game over",
  }[result];
  $("result-title").textContent = title;
  const subs = [`${fmt(ms)}`];
  if (isBest) subs.push("new best time");
  if (result === "rotten") subs.push("bad words when you called it");
  if (!solo) subs.push(`${LEVELS[S.level].label}, ${g.players.length - 1} bot${g.players.length > 2 ? "s" : ""}`);
  $("result-sub").textContent = subs.join(" · ");

  const p = me();
  const longest = longestWord(p.grid);
  $("result-stats").replaceChildren(
    el("div", "stat", `<b>${p.grid.size}</b><span>Tiles placed</span>`),
    el("div", "stat", `<b>${longest.length || "–"}</b><span>Longest${longest ? ` · ${longest}` : ""}</span>`),
    el("div", "stat", `<b>${p.peels}</b><span>Peels</span>`),
    el("div", "stat", `<b>${p.dumps}</b><span>Dumps</span>`),
  );

  const tabs = $("result-tabs");
  const pick = (i) => {
    tabs.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === i));
    renderMini(g.players[i]);
  };
  tabs.replaceChildren(...g.players.map((pl, i) => {
    const b = el("button", null, pl.name + (i === winner ? " ★" : ""));
    b.addEventListener("click", () => pick(i));
    return b;
  }));
  tabs.hidden = g.players.length < 2;
  show("results");
  pick(result === "lose" ? winner : 0);
}

function renderMini(p) {
  const wrap = $("mini-wrap");
  const v = validateGrid(p.grid, dict);
  const bad = new Set();
  for (const w of v.invalid) for (const [x, y] of w.cells) bad.add(key(x, y));
  const keys = [...p.grid.keys()].map(parseKey);
  if (!keys.length) { wrap.replaceChildren(el("p", "rack-empty", "No tiles placed")); $("result-words").textContent = ""; return; }
  const minX = Math.min(...keys.map((k) => k[0])), maxX = Math.max(...keys.map((k) => k[0]));
  const minY = Math.min(...keys.map((k) => k[1])), maxY = Math.max(...keys.map((k) => k[1]));
  const cols = maxX - minX + 1, rows = maxY - minY + 1;
  const avail = Math.min(wrap.clientWidth || 340, 520) - 20;
  const size = Math.max(12, Math.min(28, Math.floor(avail / cols) - 2));
  const grid = el("div", "mini");
  grid.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
  grid.style.gridAutoRows = `${size}px`;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const k = key(x, y);
      const l = p.grid.get(k);
      const s = el("span", l ? (bad.has(k) ? "t bad" : "t") : "", l ?? "");
      s.style.fontSize = `${size * 0.6}px`;
      grid.append(s);
    }
  }
  wrap.replaceChildren(grid);
  const words = v.words.map((w) => w.word);
  const badWords = [...new Set(v.invalid.map((w) => w.word))];
  const left = p.hand.length ? ` · ${p.hand.length} still in hand` : "";
  $("result-words").innerHTML = `${words.length} word${words.length === 1 ? "" : "s"}${left}` +
    (badWords.length ? ` · not words: <b>${badWords.join(", ")}</b>` : "") +
    (v.connected ? "" : " · grid not joined up");
  void rows;
}

$("again").addEventListener("click", () => { S = null; newGame(lastMode); });
$("home-btn").addEventListener("click", () => { S = null; show("home"); });

// Test hook for local smoke tests only.
if (location.hostname === "localhost") window.__tr = () => S;

// ---------- Offline ----------
if ("serviceWorker" in navigator && location.hostname !== "localhost") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
renderHome();
