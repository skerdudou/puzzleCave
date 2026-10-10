# puzzleCave — design (2026-10-10)

## 1. Intent

Rebuild **puzzleCave**, a turn-based block-pushing puzzle game, with up-to-date technology. Playable in
the browser with the keyboard, and on smartphones (Android at minimum) with touch. Open source project.

**Streamlined** version: no enemies, no real time. The player pushes blocks, picks up keys, opens doors
and reaches the exit. Replayability comes from **medals** (moves, time, platinum).

v1 success criteria:
- the 5 original puzzleCave levels + the classic levels by author "moineau" are playable;
- a very fast keyboard player loses **no** move and suffers **no** latency;
- levels are created and tweaked in **Tiled**;
- everything is saved locally, with no server;
- installable on Android (PWA) and playable offline.

Source: `IdeaProjects/puzzleCave-legacy` (the original AS3/Flash puzzleCave, SVN history converted to git).
The initial level set also includes classic levels by "moineau", converted to Tiled.

## 2. Tech stack (versions checked on npm on 2026-10-10)

| Role | Choice |
|---|---|
| Runtime | Node 24 LTS (installed: 24.20.0), npm 11 |
| Monorepo | npm workspaces |
| Language | TypeScript 7.0.x (`strict`) |
| Rendering | Phaser 4.2.x |
| Build / dev | Vite 8.x |
| PWA | vite-plugin-pwa 2.x |
| Unit tests | Vitest 5.x |
| End-to-end tests | @playwright/test 1.64.x |
| XML (tools) | fast-xml-parser 5.x |
| Formatting | Prettier 3.x |

Rule: at install time, take the latest published version (`npm view <pkg> version`), not a version
from memory. The rules engine (`core`) has **no** runtime dependency.

## 3. Architecture

```
puzzleCave/
  levels/                 # content, edited in Tiled
    tileset.tsx           # shared tileset (16 px tiles, semantics via the `kind` property)
    tileset.png
    chapters.json         # chapter/level order, unlock rules
    *.tmx                 # one file per level (CSV tile layer + object layer)
    solutions/<id>.txt    # reference solutions (tests only, never shipped in the game)
  packages/
    core/                 # pure TS rules engine + model + medals + progress
    tiled/                # .tmx/.tsx -> LevelData conversion (fast-xml-parser), used by game and tools
    game/                 # Phaser 4 game + Vite + PWA
    tools/                # CLI: validate, solve
```

Dependencies: `game → core, tiled`; `tools → core, tiled`; `tiled → core` (types); `core → nothing`.

### 3.1 `core`

- `LevelData`: `{ id, name, author?, width, height, terrain: Terrain[] (row-major), objects: Obj[],
  start: {x,y}, initialKeys, platinum: boolean, thresholds }`.
- Immutable `GameState`: player position and orientation, current terrain, objects, keys, move count,
  status (`playing | won | drowned`), mode (`normal | platinum`).
- `step(state, dir) → { state, events }`: applies **one** move. `events` describes what happened
  (`moved`, `turned`, `pushed`, `blockSank`, `keyPicked`, `doorOpened`, `won`, `drowned`) so that
  the renderer can animate without recomputing the rules.
- `History`: state stack for undo; restart = go back to the initial state.
- `parseLevel(json) / validateLevel(level)`: exactly one start, consistent dimensions, known tiles,
  objects inside the map, no object on a wall/water, at least one exit.
- `replay(level, moves, mode) → result`: replays a sequence of moves (tests, solver, future server).
- `medals(thresholds, result)` and `resolveThresholds(level)` (see §5).
- `Progress`: computes unlocked levels/chapters from `chapters.json` and the save.
- `Solver` (phase 4): BFS over the state space (§8).

Coordinates: `x` column, `y` row, origin at the top left. Directions: `up | down | left | right`.

### 3.2 `tiled`

Reads a `.tmx` (`terrain` tile layer in CSV encoding; `objects` object layer with tile objects) and the
shared `.tsx`. A tile's semantics come from its custom `kind` property
(`floor | gravel | water | wall | exit | start | key | door | block`), not from its number: the tileset
can be reordered or redrawn without breaking levels. Tiled tile objects are anchored at the bottom left:
row = `y / tileheight - 1`. Map properties (`name`, `author`, `platinum`, `goldMoves`, `goldTime`,
`silverMoves`, …) feed `LevelData`. Rectangular maps are accepted.

### 3.3 `game`

- `levels` Vite plugin: exposes a virtual module `virtual:levels` (list of `LevelData` + chapters)
  built from `levels/`; validates everything at build time (an invalid level fails the build with a
  clear message); in dev, saving in Tiled reloads the game.
- Phaser scenes: `Boot` (assets), `Menu` (Play, Options), `Options` (sound, swipe sensitivity,
  repeat rate, fr/en language), `Select` (chapters → level grid, padlocks, medals),
  `Game` (board + HUD), `Result` (medals, records, Replay / Next, author button in dev mode).
- The game contains no rules: it calls `core.step` and animates the `events`.

### 3.4 `tools`

- `validate [ids…]`: validates levels and replays `levels/solutions/<id>.txt` if it exists.
- `solve <id> [--timeout s]` (phase 4): optimal solution in moves, writes it to
  `levels/solutions/<id>.txt` and prints the suggested `goldMoves`.

Converting the classic levels by "moineau" to Tiled was done with a **one-shot conversion script** that
is **not part of the repo**. Only the resulting `.tmx` files are committed.

## 4. Game rules

### Terrain

| Terrain | Player | Pushed block onto it |
|---|---|---|
| `floor` | can walk | yes |
| `gravel` | can walk | no |
| `water` | cannot walk (normal mode) / drowns (platinum mode) | yes: the block disappears, the tile becomes `floor` |
| `wall` | cannot walk | no |
| `exit` | can walk → victory | no |

### Objects

- `start`: starting position (exactly one per level, removed from the board on load).
- `key`: picked up by walking on it, `keys + 1`.
- `door`: if `keys > 0`, the door opens (`keys − 1`) and the player moves onto it; otherwise it blocks.
  Initial keys may be negative (enough keys must then be picked up before opening).
- `block`: pushed if the tile behind it is `floor` or `water` **and** contains no object.

Leaving the map is impossible. A blocked move only turns the player and **does not count**.
Reaching `exit` ends the level (`won`).

### Moves, time, undo

- A move = a successful displacement (pushing included).
- The timer starts at the first move and only stops on victory. No time limit.
- `U` undoes a move (the move counter goes down, the timer keeps running). `R` restarts (moves and
  timer reset to zero). A drowning cannot be undone: the level must be restarted.

### Platinum mode

Available on a level if the property `platinum: true` is set. Chosen explicitly before playing
("Platinum challenge"), never by surprise. The only rule difference: entering water **drowns** the
player (`drowned`, game lost). A win in platinum mode also counts for the normal medals.

## 5. Medals

Two independent medals per level, plus the optional platinum:

- **Moves**: gold if `moves ≤ goldMoves`, silver if `≤ silverMoves`, bronze if `≤ bronzeMoves`.
- **Time**: same with `goldTime`, `silverTime`, `bronzeTime` (seconds, to the hundredth).
- **Platinum**: win in platinum mode with `time ≤ platinumTime` (default `goldTime`).

Default thresholds (every value can be overridden through a Tiled property):

| | Silver | Bronze |
|---|---|---|
| Moves | `ceil(gold × 1.10)`, at least `gold + 2` | `ceil(gold × 1.25)`, at least `gold + 5` |
| Time | `gold × 1.25`, at least `gold + 3 s` | `gold × 1.50`, at least `gold + 6 s` |

Without a gold threshold for a criterion, no medal is awarded for that criterion: only the record is
shown. Gold is set by hand or from a test run: in **author mode** (dev build or `?dev` in the URL),
the result screen offers "Copy Tiled properties" (moves and time of the run). The solver (phase 4)
suggests `goldMoves`.

## 6. Input and responsiveness

- **Keyboard**: directions read via `KeyboardEvent.code` (physical position): arrows + `KeyW/KeyA/KeyS/KeyD`
  (= ZQSD on AZERTY, WASD on QWERTY). Help labels via `navigator.keyboard.getLayoutMap()` if
  available, otherwise "ZQSD / WASD". `U` (undo), `R` (restart), `Escape` (menu) read via
  `KeyboardEvent.key`. No `Ctrl+Z`.
- **Repeat**: holding a direction repeats the move at an adjustable rate (default 10 moves/s);
  the OS auto-repeat (`event.repeat`) is ignored.
- **Touch**: swipe (adjustable threshold, default 30 px) and virtual directional pad; undo /
  restart / menu buttons in the HUD.
- **The logic never waits for the display**: every input calls `core.step` immediately. The
  counter and the timer follow the logic.
- **Animation**: a slide lasts `min(100 ms, interval since the previous move)` (100 ms for the
  first move or after a pause). If a move arrives before the previous animation ends, the latter
  jumps to its end. The display is therefore at most one move behind, for at most 100 ms.

## 7. Display, style, sound

- 16 px tiles from the original puzzleCave (`levels/textures/*.png` of the legacy repo), gathered into
  `tileset.png`. Walls auto-tiled with a 4-neighbour mask (N=1, W=2, E=4, S=8 → 16 `WALL_*` variants).
  Character `player.png` (16×18), oriented by horizontal flipping.
- Board centered, scaled by an **integer factor** computed in physical pixels (`devicePixelRatio`),
  `pixelArt` rendering (no smoothing). Portrait and landscape handled.
- Music: the two re-encoded MP3s from the original puzzleCave, with `CREDITS.md` (Eric Matyas,
  soundimage.org); sound can be toggled, paused when the tab/app goes to the background.
- fr/en texts (simple JSON files), browser language by default.

## 8. Solver (phase 4)

BFS over the state `(player position, set of blocks, keys picked up, doors opened, filled water,
key count)` encoded as a string/hash, in normal mode. Configurable time and state limits;
result `solved(moves) | unsolvable | timeout`. Serves as an author tool (gold threshold, solvability
check), not in the game.

## 9. Local save

A single `localStorage` entry `puzzlecave.save.v1`:
`{ version: 1, settings: { sound, lang, swipeThreshold, repeatRate }, levels: { [id]: { completed,
bestMoves?, bestTime?, medals: { moves?, time?, platinum? } } } }`. Level id = `.tmx` file name
without extension (stable). Every read/write is guarded (`try/catch`): if storage is unavailable,
the game works without persistence; if the save is unreadable, it is copied to
`puzzlecave.save.corrupt` and the game starts over with a blank save.

## 10. Progress

`chapters.json`: `[{ id, name: {fr, en}, unlockAfter, levels: [ids…] }]`. The first level of the first
chapter is open. Within a chapter, completing a level unlocks the next one. A chapter opens when
`unlockAfter` levels of the previous chapter are completed.

Initial content:
- **Chapter 1 — puzzleCave**: the 5 original levels (`level_1`, `level_2`, `level_3`, `level_3_1`,
  `level_4`) converted to the new format.
- **Chapter 2 — classic levels**: the levels by author "moineau" (19 after removing 4 "test" maps),
  18×18, converted to Tiled with this tile mapping: empty → `floor`, bush and grate →
  `wall`, fake bush → `gravel`, block → `floor` + `block`, water → `water`, stairs → `exit`,
  key → `floor` + `key`, door → `floor` + `door`; start position → `start`, key count → `initialKeys`.
  The original time limit is dropped. The original names are kept.

## 11. Errors

- Invalid level → build failure (`levels` plugin) and `tools validate` failure, with the file and the reason.
- Missing asset at load → readable error screen rather than a black screen.
- Storage unavailable or corrupt → see §9.

## 12. Tests

- **core** (Vitest, TDD): every rule of the §4 table, doors and negative keys, water in normal and
  platinum mode, undo/restart, thresholds and medals (defaults and overrides), progress,
  `replay`, and a burst of 50 moves yielding exactly the expected state.
- **tiled**: reading a test `.tmx` (object anchoring, properties, non-square map).
- **levels**: every level in `levels/` loads and validates; every solution in
  `levels/solutions/` leads to victory.
- **game**: unit test of the input controller (burst, repeat, `code` vs `key`) and of the
  save (missing storage, corrupt); Playwright: launch the game, finish `level_1` with the keyboard,
  check the result screen.

## 13. Phases

1. `core` + `tiled` + content (conversion of the 5 levels, conversion of the moineau levels, `chapters.json`).
2. Game playable with the keyboard (scenes, rendering, animation, medals, save, author mode).
3. Mobile: touch, PWA, portrait/landscape scaling.
4. Solver and `tools solve`, then filling in the levels' `goldMoves`.

## 14. Out of scope

Server, accounts, online leaderboards, in-game editor, Play Store release (Capacitor),
enemies, sound effects (music is enough in v1).
