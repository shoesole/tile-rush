import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TILE_COUNTS, makeBag, makeRng, Dictionary, Game, key, findWords, isConnected, validateGrid, START_HAND } from "../public/engine.js";

const dict = new Dictionary(readFileSync(new URL("../public/words.txt", import.meta.url), "utf8"));
const grid = (rows) => { const g = new Map(); rows.forEach((r, y) => [...r].forEach((l, x) => { if (l !== ".") g.set(key(x, y), l); })); return g; };
let n = 0; const t = (name, fn) => { fn(); n++; };

t("bag has 144 tiles in the standard mix", () => {
  assert.equal(Object.values(TILE_COUNTS).reduce((a, b) => a + b), 144);
  const bag = makeBag(makeRng(1));
  assert.equal(bag.length, 144);
  assert.equal(bag.filter((l) => l === "E").length, 18);
  assert.equal(makeBag(makeRng(1), 60).length, 60);
});

t("dictionary has 2-letter words and Q without U", () => {
  for (const w of ["AA", "QAT", "ZAX", "CAT", "KI", "QI", "ZA"]) assert.ok(dict.has(w), w);
  assert.ok(!dict.has("XQZ"));
});

t("findWords and validation", () => {
  const g = grid(["CAT.", "..O.", "..E."]);
  assert.deepEqual(findWords(g).map((w) => w.word).sort(), ["CAT", "TOE"]);
  assert.ok(validateGrid(g, dict).valid);
  const bad = grid(["CAT", ".XO"]); // XO valid? AX, TO cross-words
  const r = validateGrid(bad, dict);
  assert.deepEqual(r.invalid.map((w) => w.word).sort(), r.invalid.map((w) => w.word).filter((w) => !dict.has(w)).sort());
  const split = grid(["CAT..DOG"]);
  assert.ok(!isConnected(split));
  assert.ok(!validateGrid(split, dict).valid);
  assert.ok(!validateGrid(grid(["A"]), dict).valid);
  assert.ok(!validateGrid(grid(["CTA"]), dict).valid);
});

t("deal, peel, dump, finish", () => {
  const g = new Game({ players: 2, rng: makeRng(2) });
  assert.equal(g.players[0].hand.length, START_HAND);
  assert.equal(g.bag.length, 144 - 42);
  assert.ok(!g.canPeel(0)); // hand not empty
  const d = g.dump(0, g.players[0].hand[0]);
  assert.equal(d.length, 3);
  assert.equal(g.players[0].hand.length, 23);
  assert.equal(g.bag.length, 100);
  // Fake a finished grid and peel.
  g.players[0].hand = []; g.players[0].grid = grid(["CAT"]);
  assert.ok(g.peel(0));
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(g.players[1].hand.length, 22);
  assert.equal(g.bag.length, 98);
  // Pool too small: finish instead.
  g.bag = ["E"]; g.players[0].hand = [];
  assert.ok(!g.canPeel(0) && !g.canDump(0) && g.canFinish(0));
  assert.ok(g.finish(0, dict).valid);
  assert.equal(g.winner, 0);
});

t("rotten finish puts the player out and returns tiles", () => {
  const g = new Game({ players: 2, rng: makeRng(3) });
  g.bag = []; g.players[0].hand = []; g.players[0].grid = grid(["CTA"]);
  const r = g.finish(0, dict);
  assert.ok(!r.valid && g.players[0].out && !g.over);
  assert.equal(g.bag.length, 3);
});

t("save and restore", () => {
  const g = new Game({ players: 2, rng: makeRng(4) });
  g.players[0].grid.set(key(0, 0), "A");
  const h = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(h.players[0].grid.get(key(0, 0)), "A");
  assert.equal(h.bag.length, g.bag.length);
});

console.log(`engine: ${n} tests passed`);
