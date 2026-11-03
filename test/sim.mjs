// Simulates bot-only games on a virtual clock. Every finished grid must be valid,
// and no game may hang. Usage: node test/sim.mjs [games] [level]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Dictionary, Game, makeRng, validateGrid } from "../public/engine.js";
import { Bot } from "../public/bot.js";

const dict = new Dictionary(readFileSync(new URL("../public/words.txt", import.meta.url), "utf8"));
const GAMES = +(process.argv[2] ?? 40);
const onlyLevel = process.argv[3];

export function simulate(players, level, seed, bagSize = 144) {
  const rng = makeRng(seed);
  const game = new Game({ players, rng, bagSize });
  const bots = game.players.map((_, i) => new Bot(game, i, dict, level, rng));
  const next = bots.map((b) => ({ at: 0, move: null }));
  let now = 0, steps = 0, worstMs = 0;
  const firstGridDone = new Array(players).fill(null);
  while (!game.over && now < 3 * 3600) {
    let k = 0;
    for (let i = 1; i < players; i++) if (next[i].at < next[k].at) k = i;
    now = next[k].at;
    if (next[k].move) {
      bots[k].apply(next[k].move);
      const total = game.bag.length + game.players.filter((p) => !p.out)
        .reduce((a, p) => a + p.hand.length + p.grid.size, 0);
      assert.equal(total, bagSize, "tiles created or lost");
    }
    if (firstGridDone[k] === null && !game.players[k].hand.length) firstGridDone[k] = now;
    const t0 = performance.now();
    // Plan through a JSON snapshot, the way the browser's worker does.
    const snap = Game.fromJSON(JSON.parse(JSON.stringify(game.toJSON())), rng);
    const planner = new Bot(snap, k, dict, level, rng);
    planner.stuck = bots[k].stuck;
    const m = planner.plan();
    bots[k].stuck = planner.stuck;
    if (m.grid) m.grid = new Map(JSON.parse(JSON.stringify([...m.grid])));
    worstMs = Math.max(worstMs, performance.now() - t0);
    next[k] = { at: now + m.delay, move: m };
    steps++;
  }
  const w = game.winner;
  if (w !== null) assert.ok(validateGrid(game.players[w].grid, dict).valid, "winner grid invalid");
  for (const p of game.players) assert.ok(validateGrid(p.grid, dict).connected || p.grid.size === 0);
  return { winner: w, time: now, steps, worstMs, first21: firstGridDone[0], tiles: game.players[0].grid.size,
    dumps: game.players.reduce((a, p) => a + p.dumps, 0) };
}

const levels = onlyLevel ? [onlyLevel] : ["easy", "medium", "hard"];
for (const level of levels) {
  for (const players of (process.env.P ?? "1,2,4").split(",").map(Number)) {
    const rs = [];
    for (let s = 0; s < GAMES; s++) rs.push(simulate(players, level, s * 7919 + players));
    const done = rs.filter((r) => r.winner !== null);
    const avg = (a) => (a.reduce((x, y) => x + y, 0) / (a.length || 1));
    const first = rs.map((r) => r.first21).filter((x) => x !== null);
    console.log(`${level.padEnd(6)} ${players}p: finished ${done.length}/${rs.length}, ` +
      `game ${(avg(done.map((r) => r.time)) / 60).toFixed(1)} min, first hand ${avg(first).toFixed(0)} s, ` +
      `dumps ${avg(rs.map((r) => r.dumps)).toFixed(1)}, worst plan ${Math.max(...rs.map((r) => r.worstMs)).toFixed(0)} ms`);
  }
}
