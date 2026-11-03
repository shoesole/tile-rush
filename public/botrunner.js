// Drives the bots in a live game: asks the worker for each bot's next move, then
// applies it when its delay (on the pausable game clock) has passed.
import { Bot, LEVELS } from "./bot.js";

export class Clock {
  constructor() { this.base = 0; this.since = null; }
  get running() { return this.since !== null; }
  now() { return this.base + (this.running ? performance.now() - this.since : 0); }
  start() { if (!this.running) this.since = performance.now(); }
  pause() { if (this.running) { this.base = this.now(); this.since = null; } }
  set(ms) { this.base = ms; if (this.running) this.since = performance.now(); }
}

export class BotRunner {
  constructor(game, dict, level, clock) {
    this.game = game;
    this.clock = clock;
    this.level = LEVELS[level] ? level : "medium";
    this.bots = new Map();
    game.players.forEach((p, i) => { if (p.isBot) this.bots.set(i, new Bot(game, i, dict, this.level)); });
    this.queue = [];        // [{i, due, move}]
    this.pending = new Map(); // id -> {i, asked}
    this.seq = 0;
    this.worker = new Worker("bot-worker.js", { type: "module" });
    this.worker.onmessage = (e) => this.received(e.data);
    this.onError = null; // set by the UI to show a visible message
    this.worker.onerror = (e) => { console.error("bot worker", e.message); this.onError?.(e); };
    this.timer = setInterval(() => this.tick(), 100);
  }

  start() { for (const i of this.bots.keys()) this.ask(i); }

  ask(i) {
    if (this.game.over) return;
    const id = ++this.seq;
    this.pending.set(id, { i, asked: this.clock.now() });
    this.worker.postMessage({ id, snap: this.game.toJSON(), i, level: this.level, stuck: this.bots.get(i).stuck });
  }

  received({ id, move, stuck }) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.bots.get(p.i).stuck = stuck;
    if (move.grid) move.grid = new Map(move.grid);
    this.queue.push({ i: p.i, due: p.asked + move.delay * 1000, move });
  }

  tick() {
    if (this.game.over || !this.clock.running) return;
    const now = this.clock.now();
    const due = this.queue.filter((q) => q.due <= now);
    if (!due.length) return;
    this.queue = this.queue.filter((q) => q.due > now);
    for (const q of due) {
      if (this.game.over) return;
      this.bots.get(q.i).apply(q.move);
      this.ask(q.i);
    }
  }

  stop() { clearInterval(this.timer); this.worker.terminate(); this.queue = []; this.pending.clear(); }
}
