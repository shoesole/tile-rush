// Runs bot planning off the main thread so dragging tiles never stutters.
// In:  {id, snap (Game.toJSON), i, level, stuck}
// Out: {id, move, stuck}   (a rebuild's grid comes back as [[key, letter], ...])
import { Dictionary, Game } from "./engine.js";
import { Bot } from "./bot.js";

let dict = null;
const ready = fetch("words.txt").then((r) => r.text()).then((t) => {
  dict = new Dictionary(t);
  dict.counts; // build the letter-count index up front
});

self.onmessage = async (e) => {
  await ready;
  const { id, snap, i, level, stuck } = e.data;
  const game = Game.fromJSON(snap);
  const bot = new Bot(game, i, dict, level);
  bot.stuck = stuck;
  const move = bot.plan();
  if (move.grid) move.grid = [...move.grid];
  self.postMessage({ id, move, stuck: bot.stuck });
};
