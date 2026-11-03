# Tile Rush

A fast crossword-tile race for iPhone (installable web app), with no ads. Everyone builds
their own grid from a shared pool of 144 tiles: peel, dump, and be first to use every tile.

- **Race the Bots**: 1–3 virtual opponents (Easy / Medium / Hard). When a bot peels, you
  draw too. Calling Done with a bad word means you lose ("rotten").
- **Solo Race**: empty a 60 / 100 / 144-tile pool as fast as you can. Best times are kept
  per pool size. A bad word at the end just tells you what to fix.
- **Solo Pressure**: as Solo Race, but you also get a new tile every 30/45/60/90 s.

## Rules (as implemented in `engine.js`)

- Standard 144-tile set (A13 B3 C3 D6 E18 F3 G4 H3 I12 J2 K2 L5 M3 N8 O11 P3 Q2 R9 S6 T9
  U6 V3 W3 X2 Y3 Z2). Everyone starts with 21 tiles (2–4 players; solo too).
- **Peel**: hand empty and grid joined up, and the pool has at least one tile per player;
  every player draws one.
- **Dump**: return one tile, draw three; only while the pool has 3+.
- **Finish**: when the pool has fewer tiles than players, the first player with an empty
  hand and a joined-up grid calls it. All words valid wins; otherwise that player is out.
- Words: ENABLE (2+ letters) plus a few it lacks, listed in `scripts/extra_words.txt`
  (KI, QI, ZA). 168,554 words in all. To allow another word, add it there and rerun
  `python3 scripts/build_dict.py`.

## How the bots play (`bot.js`)

The bot builds a real grid: each move lays one word through a letter already on its grid,
and every word the move creates (the main word and each cross-word) must be in the
dictionary, so bot grids are always valid. When stuck it dumps an awkward letter
(Q, J, X, Z) or rebuilds its whole grid from all its letters.

Solving happens instantly in a Web Worker (`bot-worker.js`); pacing comes from the level
(`LEVELS` in `bot.js`): a move takes `think + perTile × tiles placed` seconds, ±25%.
Measured in simulation (`test/sim.mjs`), time for a bot to place its first 21 tiles:

| Level  | First 21 tiles | 2-player game | 4-player game |
|--------|----------------|---------------|---------------|
| Easy   | ~3 min         | ~11 min       | ~4.4 min      |
| Medium | ~85 s          | ~7 min        | ~2.6 min      |
| Hard   | ~40 s          | ~4.5 min      | ~1.5 min      |

Every game records your tiles per minute, dumps, peels and result (localStorage
`tr-history`), ready for a future adaptive opponent that tunes `LEVELS` to your pace.

## Layout

- `public/`: the whole app (static files, no build step)
  - `engine.js`: bag, dictionary, grid validation, peel / dump / finish, save (no DOM)
  - `bot.js`: bot solver and levels (no DOM)
  - `bot-worker.js`: runs bot planning off the main thread
  - `botrunner.js`: pausable game clock; asks the worker for moves and applies them on time
  - `app.js`: UI, board pan / pinch / drag, rack, type-a-word cursor, stats, save/resume
  - `words.txt`: dictionary (built, do not edit by hand)
  - `sw.js`: offline support (network-first). **Bump `VERSION` here and `APP_VERSION` in `app.js` whenever anything in `public/` changes.**
- `scripts/build_dict.py`: rebuilds `words.txt` from `data/enable1.txt` (gitignored) plus `scripts/extra_words.txt`
- `scripts/icon.svg`: source for the PNG icons
- `test/`: `node test/engine.test.mjs` (rules) and `node test/sim.mjs [games] [level]`
  (bot-only games on a virtual clock; checks every winning grid is valid and no tiles are
  lost; set `P=2,4` to choose player counts)

## Run locally

    python3 scripts/serve.py        # no-cache server for public/ on port 8001

Then open http://localhost:8001, or http://<Mac's Wi-Fi IP>:8001 on a phone on the same Wi-Fi.
On localhost, `window.__tr()` returns the live game session for testing.

## Deploy

`.github/workflows/pages.yml` publishes `public/` to GitHub Pages on every push to `main`.
