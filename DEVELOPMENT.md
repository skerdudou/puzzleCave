# puzzleCave — development

Technical notes for building, testing, creating levels and running the solver. For the game itself
and its rules, see the [README](README.md).

## Running

Requirements: Node 24+.

    npm install
    npm run dev        # game on http://localhost:5173 (author mode enabled)
    npm test           # unit tests (the GPU ones only run if a compatible adapter is present)
    npm run test:slow  # slow tests (~6 min): compact solver against the old v2 engine
    npx playwright install chromium   # once, before npm run e2e
    npm run e2e        # end-to-end test (Playwright)
    npm run build      # publishable build in packages/game/dist (PWA)

## Publishing

The game is published on GitHub Pages at https://skerdudou.github.io/puzzleCave/ by
`.github/workflows/pages.yml`, only when a release is published or a version tag is pushed
(`git tag v1.0.0 && git push origin v1.0.0`). The workflow runs the typecheck, `validate` and the
tests before building; pushes to `main` do not deploy anything.

### How a release reaches players

The game is a PWA: a service worker (Workbox `generateSW`, `vite-plugin-pwa` in `prompt` mode,
registered by `packages/game/src/pwa.ts` through `virtual:pwa-register`) precaches the whole build,
so the game starts from the cache, offline included. A new release therefore cannot show on the
very first launch after a deploy; it arrives this way:

1. **Detection**: the browser fetches `sw.js` again at start-up (the registration), every 30
   minutes while the game stays open, and when it comes back to the screen (at most once a minute;
   an installed app left open in the background is covered). The service worker script is fetched
   past the HTTP cache, and Workbox fetches the files it lists past it too (hashed names, or a
   `__WB_REVISION__` parameter for `index.html` and the manifest): GitHub Pages' `max-age=600`
   does not delay an update.
2. **Download**: the new service worker precaches the new files in the background, then waits
   (it does not take over a page by itself).
3. **Switch** (`UpdateGate`, `packages/game/src/updateGate.ts`): if the player is on the main
   menu, the level list, the options or a result screen, the game lets the new worker take over
   and reloads at once (nothing is lost: progress and settings are saved in `localStorage` as soon
   as they change). During a level (or a replay), nothing is interrupted: a short notice ("Update
   available — it will be applied on the next menu") shows for a few seconds, and the reload
   happens when the player next opens the main menu, the level list or the options (not the
   result screen of that level, nor a level chained with Next).
4. The previous version's precache is deleted (`cleanupOutdatedCaches`).

In practice, a player who opens the game after a deploy sees the new version a few seconds after
the start-up (one reload on the menu). On the dev server the service worker is disabled
(`registerSW` does nothing).

## Creating levels with Tiled

1. Create an orthogonal map, 16×16 tiles, tile layer data format **CSV**.
2. Add the tileset `levels/tileset.tsx`.
3. Paint the `terrain` layer (floor, gravel, water, wall, exit). Start, keys, doors and blocks are
   painted in that same layer (placed on floor) or in an object layer (for example to put a key on
   gravel).
4. Map properties: `name`, `author`, `initialKeys` (int, can be negative), `goldMoves`,
   `platinumMoves` and, if needed, `silverMoves`, `bronzeMoves`, `goldTime` (seconds),
   `silverTime`, `bronzeTime`. An old `platinum` or `platinumTime` property is ignored.
5. Save as `levels/<id>.tmx` and add `<id>` to `levels/chapters.json`.
6. `npm run validate`, then `npm run solve -- <id> --apply` (or `improve`, `plan`, … `--apply`,
   or "Save solution" in author mode) to compute the solution: on a level without `goldMoves` it
   writes `goldMoves` and `goldTime` from that same solution (see “Time medals” below).
   `validate` warns about a level without `goldTime`.
   A start placed on water is allowed (the player can leave it but never come back); `validate`
   reports it with a warning so that it is a deliberate choice.

### Medal thresholds and master mode

- `goldMoves`: a "good honest" solution, chosen by the designer. Silver and bronze derive from it
  (`max(⌈1.1 g⌉, g + 2)` and `max(⌈1.25 g⌉, g + 5)`) unless `silverMoves` / `bronzeMoves` are set.
- `platinumMoves`: the best known solution length (master class, often another route), the
  **grand master** move limit (the "platinum limit" of the tools below); `goldMoves` when it is
  absent. It must not exceed `goldMoves`.
- On levels with master mode, gold never demands the optimum: `goldMoves` is either the length
  of a **natural solution** (another well-optimised solution following a genuinely different,
  plausible strategy — another block-to-water assignment, door order, a simpler route —, kept
  roughly between optimum + 3 and optimum + 25 %), or, when no such solution exists,
  `max(optimum + 3, ⌈1.1 × optimum⌉)`; `platinumMoves` is the optimum (or best known).
- Levels without a proven optimum (Hard and Expert chapters): `goldMoves` stays within
  `[⌈1.1 p⌉, ⌊1.25 p⌋]` of the best known `p = platinumMoves` — a natural solution in that window
  (often an earlier, plainer solution of the level), else `max(p + 3, ⌈1.1 p⌉)`. When a shorter
  platinum solution is found, `goldMoves` is re-evaluated only once the gap leaves that window.
- Gold reference solution: when `goldMoves` comes from a real solution that differs from the saved
  (platinum) one, that solution is kept in `levels/solutions/gold/<id>.txt`; `validate` replays it
  and errors unless it wins in exactly `goldMoves` moves. `goldTime` comes from it
  (`npm run times -- <id> --from levels/solutions/gold --apply --force`). For a level on the
  `+10 %` rule there is no such file: `goldTime` stays the time of the optimal route.
- Master mode (`Mode` `'master'` in `@puzzlecave/core`): water drowns the player and there is no
  undo (`Session.canUndo` is false; a restart cannot be undone either). It unlocks on a level
  once the save holds gold (moves) there — or a master medal earned without gold (a platinum of an
  older save) — and author mode does not bypass that. Master mode has two medals
  (`MasterMedal`, `masterMedalFor(th, moves, timeMs)`): **master** = a master finish within
  `goldMoves` (`Thresholds.masterMoves`), whatever its time; **grand master** = within
  `platinumMoves` (`Thresholds.grandMasterMoves`) and, on a level with `goldTime`, within the
  silver time (`grandMasterTimeMs`, the same test as the silver time medal), which implies
  master; the save keeps the better one (`medals.master`). A grand master saved before the time
  condition existed is kept (nothing recomputes saved medals). Where the two move limits are
  equal (no `platinumMoves`, or equal to `goldMoves`) such a finish is grand master if fast
  enough; the third line then shows grand master alone only on a level without `goldTime`. A
  master finish also earns the move and time medals it qualifies for. On a level with
  `goldTime`, master mode also has a time limit, the bronze time (`masterTimeLimitMs`): past it
  the attempt fails like drowning (the game's `RunClock` and `countdown`; the clock starts at the
  first move and does not count while the page is hidden — the same clock measures the time
  medals). A platinum route is often longer to find than to play, but it must be played within
  the silver time for grand master: keep `silverTime` (or `goldTime`) above the time the platinum
  solution takes. The master row of the threshold lines (`thresholdRows`) reads "Master ≤ 610 ·
  Grand master ≤ 538 & ≤ 1:46.25 · limit ≤ 2:07.50"; where that does not fit (`drawThresholdLine`)
  it falls back to "Master ♛ ≤ 610 ✦ ≤ 538 & …", then, on a narrow phone, to the marks alone
  ("♛ ≤ 610 ✦ ≤ 538 & ≤ 1:46.25 · limit ≤ 2:07.50"). The save keeps the best master run apart
  (`masterBestMoves`, `masterBestTimeMs`, two separate minima, maybe of different runs), shown on
  its own line (`masterLineText`) under the name of the medal saved ("Grand master: 538 moves ·
  1:40.12"), never one worked out from those minima, or of the mode without a medal ("Master
  mode: …"): in every language the mode's name is also the first medal's, so a line about the
  mode always says "Master mode" (`masterModeName`), never the bare "Master".
- Medal marks (`paintMedal`), for the colour-blind as well: bronze plain, silver an inner ring,
  gold a star, master a crown on violet, grand master a white sparkle on light blue. The result
  screen reveals master with one ring and sparkles, grand master with two rings and more.
- Saves: version 2 replaced `medals.platinum: true` with `medals.master` (`'master'` or
  `'grandMaster'`). The migration from version 1 (`MIGRATIONS[1]` in `save.ts`) turns a platinum
  into grand master and also awards, from the level's current thresholds (`SaveContext`, from
  `levels.ts`), the medal that `masterBestMoves` qualifies for — master at most on a level with
  `goldTime`, since the time of that run is unknown.
- Chapters: `"masterMode": false` in `levels/chapters.json` removes master mode and its medals from
  a chapter's levels (the Easy chapter); absent means true. The loader rejects a non-boolean.

The solver tools never touch a designer's `goldMoves`: when they find a shorter solution, they
set or lower `platinumMoves`; they write `goldMoves` only for a level that has none. `validate`
errors on `platinumMoves > goldMoves` and on a platinum limit below the proven optimum or the
proven lower bound written in the saved solution's header; it warns when the saved solution is
longer than the platinum limit, or shorter (the limit should then be lowered).

In author mode (`npm run dev` only; the published build never enables it), all levels are unlocked and the result screen
lets you copy `goldMoves`/`goldTime` and the solution you played.

### Providing your own solution (levels too large for the exact solver)

1. Play the level in author mode until the exit.
2. On the result screen, "Copy solution".
3. Paste it into `levels/solutions/<id>.txt`.
4. `npm run improve -- <id> --apply`: the solution is shortened if possible, saved with its status
   on the first line, and `platinumMoves` is lowered if it is shorter (see "Medal thresholds").

## Solutions (spoilers!)

`levels/solutions/` contains reference solutions (all 22 current levels, including 10 best known but not proven optimal: pc-04, pc-07, pc-08, pc-09, pc-11, pc-13, pc-14, pc-16, pc-17, pc-18; the others are proven optimal; the first line of each file gives its status), replayed by `npm run validate` and the tests. The solver found some of them directly; the hardest ones (pc-07, pc-08, pc-09, pc-11, pc-13, pc-14, pc-16, pc-17, pc-18) were built by chaining small sub-goal searches (one key or one filled water cell at a time, other blocks frozen as walls), then shortened with `improve`. New ones can be added with `npm run solve -- <id> --apply`, or by playing in author mode and saving the solution from the result screen. They are not included in the published game, but they are readable in the repository.

Current solver limits: exact A* search bounded by time (60 s by default, `--timeout <s>`) and by memory (`--max-memory <MB>` per process, computed by default, see below); `--max-states <n>` adds a state limit (none by default). The compact engine stores a macro-state in ~60–110 bytes (typed arrays outside the V8 heap, which it caps itself) and processes one in ~1–6 µs. When memory or the state limit stops it before the deadline, it restarts for the remaining time with partial expansion (slower, but deeper for the same memory) and keeps the best bound. Large levels with many pushable objects exceed these limits and stay without an optimal solution: `improve` (below) then starts from the designer's solution or looks for a non-optimal one. When a limit is hit, `solve` prints a **proven lower bound** (`≥ L moves`: no solution is shorter) and reports an error if the level's platinum limit (`platinumMoves`, else `goldMoves`) is below that bound (unreachable threshold).

`--apply` writes the solution and `goldMoves` of a level that has none; on a level with a `goldMoves`, a proven optimum strictly shorter than the platinum limit sets `platinumMoves` (and replaces the solution); `--force` always writes it (and raises a `goldMoves` below it). `goldMoves` itself is never lowered. An existing solution is not rewritten otherwise.

Parallel solving: with `--all` or several identifiers, each level is solved in a separate Node process, `--jobs <n>` at a time. A single identifier without `--all` is solved in the current process and `--jobs` is then ignored.

By default, the number of processes is the smallest of three values: the number of levels, half the logical cores, and what memory allows. The memory budget is 70% of RAM minus what is already in use at launch. Each process needs at least 1.5 GB without a state limit (with `--max-states n`: ~120 bytes per state plus 150 MB; with `--max-memory M`: M MB plus 150 MB). For example, on 32 GB of which 37% is already taken (budget ~10.5 GB), the default gives 7 processes. If the budget is not enough for even one process, `solve` says so and starts only one.

Each process gets at least that requirement, and its share of the budget if there is room; its solver is capped at that share minus 150 MB (Node, tsx, the pack) and stops cleanly at that cap (lower bound printed). Sequentially (a single identifier), the default cap is the whole budget. The V8 heap of the processes is limited to 512 MB: the solver keeps almost nothing in it.

An explicit `--jobs` is honored, with a warning if it exceeds the budget. A process that runs out of memory, crashes or stops responding is reported without stopping the others: past the `--timeout` deadline plus 30 s, a watchdog kills it. Child processes are stopped with the parent (end, Ctrl+C).

### Exact search on the GPU: `--gpu`

    npm run solve -- <id…>|--all [--gpu auto|on|off] [--max-vram <MB>]
    npm run improve -- <id…>|--all [--gpu auto|on|off] [--max-vram <MB>]

The exact search can run on the graphics card (WebGPU, package `@puzzlecave/gpu`, loaded only if `--gpu` ≠ `off`). Same contract as the compact engine: optimal solution in moves, `upperBound` ("nothing shorter"), proven lower bound when a limit is hit. On an RTX 4070 it stores 2.5–7 M states/s (versus ~0.1–0.25 M on one core) in 76–108 bytes of VRAM per state, and goes deeper in a few seconds than the CPU in two minutes (measurements in `docs/solver-study.md`).

- `auto` (default): GPU if a compatible adapter is present and free, otherwise the compact engine with a single message ("GPU unavailable (reason) — exact searches on the CPU").
- `on`: GPU required; without a compatible adapter, a clear error and exit code 2. If another puzzleCave process holds the card, waits until it is released.
- `off`: compact engine, nothing is loaded.
- `--max-vram <MB>`: VRAM of each search (4096 by default). The search starts small (256 MB) and restarts ×8 larger if it overflows, without exceeding this cap. On a 12 GB card, stay under ~6–7 GB: beyond that, Windows moves some buffers to shared memory (measured: 8 GB of VRAM → up to 2.2 GB of RAM for the process, versus ~380 MB up to 7 GB).

The GPU is only used for global searches: `solve`, and in `improve` the frozen blocks and the proof. The small re-optimization windows and the solution search stay on the CPU.

Safeguards: every GPU solution is replayed (`replay`) before being accepted — if it does not win, does not have the announced length or is not shorter than the requested bound, it is discarded with a message and the level is taken over by the compact engine. A level larger than 32 × 32 cells goes to the CPU (message). If the GPU fails (device lost, no response), a message is printed and the process finishes on the CPU.

Only one process at a time on the card: a machine lock (file `puzzlecave-gpu.lock` in the temp folder, taken over if its process has disappeared). In parallel (`--all`), the parent checks the card once, then one of the lanes becomes the GPU lane (one child at a time, heaviest levels first) while the others continue on the CPU.

Requirements: a WebGPU adapter with subgroups of at least 32 threads (`subgroups`) and 15 storage buffers per stage — for example a recent NVIDIA card (D3D12 on Windows). The `webgpu` npm package (Dawn) provides the Windows, Linux and macOS binaries. `PUZZLECAVE_GPU=none` simulates the absence of an adapter.

Limits: maps of at most 32 × 32; weaker lower bound than the CPU's (distance to the exit only, without the "distinct doors" bound) — on the keys/doors family, the GPU stores more states for the same depth; the search stops when VRAM is full (proven bound), without continuing on the CPU; ~0.3 s of compilation at the first level of a given state size; horizon of 65,534 moves.

### Best known solution: `improve`

    npm run improve -- <id…>|--all [--timeout <s per level>] [--max-memory MB] [--max-states n] [--jobs n] [--apply] [--force]
                       [--from-scratch] [--find-timeout s] [--find-memory MB] [--key-closure]

Same memory and parallelism rules as `solve` (same plan: processes, per-process cap; the whole budget when sequential). The steps of a level run one after another, a single search at a time, each capped at that budget; all use the compact engine's structures (packed state, typed table and heap). Without `--max-states`, there is no state limit (at most 2 M states per window).

`solve` remains the exact search alone. `improve` looks for the best possible solution and says whether it is **proven optimal** or only **best known**. For each level, within the `--timeout` time:

1. **Starting point**: the solution in `levels/solutions/<id>.txt` if it wins (the designer's solution, takes priority); otherwise a non-optimal solution search (best-first by novelty, BFWS), with 30 % of the time; if it finds nothing, the event planner (see `plan` below) gets the next 30 % (`planFallback`, on by default: it only runs when the search failed, so it costs nothing otherwise; `planShare` sets its share). The later stages then share the time left. The report says `solution planned` when the start comes from the planner.
2. **Windows**: the solution is cut at interactions (key, door, push); each window of 8, 16, 24… interactions is replaced by the exact shortest path to the same state, if it is shorter.
3. **Spare keys**: the windows keep keys in hand and on the ground identical, so they never drop a useless key pickup. A pickup is droppable when, from it to the end, the keys in hand never fall below 1; windows of 2, 4, 8… 32 interactions around it then look for a shorter path to the same state but with that key left on the ground and one key fewer in hand. The best saving is applied (one key at a time), and the windows run again on the new solution if time remains.
4. **Frozen blocks**: blocks the solution never pushes become walls, then an exact search on that restricted level (and greedy removal of other blocks if it does not finish). Optimum for that set of blocks only.
5. **Proof**: global exact search bounded by the current length (only strictly shorter solutions are searched). If it finishes, the solution is proven optimal; otherwise its proven lower bound is kept. Like `solve`, it switches to partial expansion if memory stops it before the deadline.

Solution search options (step 1, used only when no saved solution wins):

- `--from-scratch`: ignore the saved solution and start from the solution search. With `--apply`, the result replaces the saved solution only if it is strictly shorter (or with `--force`).
- `--find-timeout <s>`: duration of the search (default: 30% of `--timeout`). When given, it comes on top of `--timeout`: the later steps keep their usual 70% of `--timeout` after the search, and the watchdog waits that much longer.
- `--find-memory <MB>`: memory cap of the search (default: the cap of every search, `--max-memory` or computed). It is not counted in the parallel memory plan: with several levels, set `--jobs` accordingly. The search needs ~65–76 bytes per stored state (measured), so 1 GB ≈ 15 M states, 5.5 GB ≈ 75–88 M; beyond ~3 GB no extra level was solved (`docs/solver-study.md`).
- `--key-closure`: after each interaction, the player also picks up every key reachable by walking (one macro step). The search stays complete but is not optimal; off by default because the measured gains are inconsistent (`docs/solver-study.md`).

For measurements, `npx tsx packages/tools/src/findBench.ts <id…> [--memory MB] [--timeout s] [--key-closure [--no-closure-filter]] [--save dir]` runs the search alone from scratch and prints its progress (states, memory, time when the peak crosses 1/2/4/8 GB) as JSON lines.

Each step replays the solution: it always wins and is never longer than the input. One line per level gives the start (designer's or found solution), the length before → after, the status, the lower bound and the duration, followed by the detail of the steps.

Without `--apply`, nothing is written. With `--apply`, the solution is written with a first comment line (ignored when reading): `# optimal (proven)` or `# best known — not proven optimal (proven lower bound ≥ L)`. The thresholds follow the `solve` rule: `goldMoves` only for a level without one, otherwise `platinumMoves`, only lowered by a strictly shorter solution, or always with `--force`. `npm run validate` checks that all solutions win and compares the platinum limit with the saved solution (see "Medal thresholds").

A saved solution that is unreadable or does not win is never overwritten without `--force`: it is kept and reported, the solution found is written next to it in `levels/solutions/<id>.found.txt`, and the thresholds are left untouched; that `.found.txt` is deleted as soon as the saved solution is valid again (or with `--force`). `solve --apply` also writes the `# optimal (proven)` header. `solve` and `improve` replay every solution before writing it: a solution that does not win is an error and nothing is written. The `improve` watchdog kills a child process past `--timeout` plus 60 s.

### Long run on one level: `longrun`

    npm run longrun -- <id> [--work-dir d] [--max-disk GB] [--max-memory MB] [--threads n] [--partitions n]
                            [--timeout s] [--bound n] [--watch file]… [--gpu auto|on|off]
                            [--dominance off|player|keys] [--compress none|gen|all] [--resume] [--apply]

Exact search of a single level with the whole machine: worker threads, the GPU, RAM, then the disk. It only
looks for solutions strictly shorter than the saved one (`levels/solutions/<id>.txt`, re-read before
each layer, as are the `--watch` files: a shorter winning solution saved meanwhile lowers the bound;
`--bound n` replaces the saved solution, the `--watch` files can still lower it). States are
processed by layers of moves (uniform cost), partitioned by the hash of their blocks, waters and
doors into files, duplicates removed per partition against the states already expanded (delayed
duplicate detection). Design and measurements in `docs/solver-study.md`: it proved pc-12 optimal at
122 moves (662 M states, 20–35 min on 8 threads, 35–90 GB of disk); the keys/doors levels grow far
too fast for it.

- Work dir: `.oneshot/longrun/<id>/` by default (git-ignored): `manifest.json` (checkpoint after
  each layer), `progress.log` (one line per layer: states, disk, pending records, lower bound),
  `runs/` and `gen/`. `--resume` continues from the last finished layer (Ctrl+C drops the current
  layer and keeps the checkpoint); without it, the work dir is emptied.
- `--threads` (default: half the logical cores), `--max-memory` (all threads, default
  min(8 GB, half the free RAM)), `--partitions` (power of two, 256 by default), `--max-disk`
  (100 GB by default, never more than the free space minus 5 GB): the disk limit stops the run
  cleanly at the last checkpoint.
- `--gpu` (auto by default, same lock as `solve`): the walk BFS and the successors of each batch
  of states are computed by the card, the rest stays on the CPU (≤ 32 × 32 maps; ~1.3× faster
  end to end on pc-12). `--compress`: records packed (~2× smaller) in the transient successor
  files (`gen`, default), also in the run files (`all`: less disk, but they are unpacked at every
  layer), or `none`.
- Results: `solved` (an optimal solution shorter than the bound, saved in the work dir as
  `solution.txt`), `exhausted` (no shorter solution: the saved one is proven optimal, `proof.txt`),
  or `stopped` (time, disk, Ctrl+C) with a proven lower bound.
- `--apply` follows the `improve` rules: a shorter solution is written only if it wins
  (header `# optimal (proven)`, `platinumMoves` lowered); an exhausted search marks the saved solution
  `# optimal (proven)`; a stopped one raises the lower bound in its header.
- `--dominance` (`keys` by default): a state is dropped when a state expanded at an earlier
  layer, with the same blocks, waters and doors, reaches it by walking at no greater cost and
  holds at least as many useful keys (`player`: same keys on the ground and in hand only; `off`).
  Sound (proof in `expander.ts`); −6–8 % states on pc-12, −14 % on pc-11 by layer 124, −40 % on pc-03 and pc-19; it
  costs a candidate per closed state of a live core in the closed phase (a wash in time on pc-12).
  Checkpoints of the previous format (manifest version 4) are refused.
- On a level whose proof is out of reach, `--bound n` (below the saved solution) is the cheap way
  to raise the lower bound: successors with g + h ≥ n are never written, which removes most of
  the pending records (on pc-11 they span 40 layers ahead), and an exhausted run proves "no
  solution under n".
- Measurement options: `--dead-pruning` (dead-state test before expanding), `--gen-strong s`
  (strong bound on successors whose weak f is within `s` of the bound).

### Certifying a long-run checkpoint: `certify`

    npm run certify -- <work-dir> [--level id] [--threads n] [--target T] [--progress s] [--skip-fingerprint]

Reads a `longrun` checkpoint (version 4, or 5 with dominance pruning) **read-only** (manifest and pending `gen` files; nothing is written,
the run can be resumed afterwards) and reports a proven lower bound: the minimum of g + h over the
pending records, h = `StrongBound.value` (compact bound and timed relaxation, see
`packages/core/src/strongBound.ts`). Every optimal solution passes through a pending record at
its optimal cost (proof at the top of `packages/tools/src/longrun/certify.ts`), so the minimum is a
bound, usually well above the checkpoint's own (g + exit distance). Segments are scanned by
increasing min f and the scan stops once nothing can lower the minimum.

- `--target T`: only look for records with g + h < T; prints "≥ T" when there is none (much
  faster: the relaxation stops at T − g).
- `--threads`: worker threads (half the logical cores by default). Cost: 30–150 µs per record on
  the 36-block levels (pc-11: ~60 k records/s on 8 threads).
- `--skip-fingerprint`: accept a checkpoint whose level fingerprint differs (medal thresholds are
  part of it) when its start state matches the level's; only use it when the rules did not change.
- Pruning in an external search: `new StrongBound(model)`, then `layer + bound.value(best − layer)
  ≥ best` drops a loaded state (admissible, not consistent: fine for the layered search, not for
  the in-RAM A*).

### Fallback for large levels: `plan`

    npm run plan -- <id…> [--timeout s] [--keys auto|explicit] [--max-free n] [--fill-free n] [--exit-free n] [--tries n] [--sub-states n] [--alternatives k] [--widen n] [--all-doors level] [--side-keys on|off] [--improve s] [--max-memory MB] [--apply]

When `improve` finds no starting solution, the event planner builds one from sub-goals: take a key, fill a water cell, open a door, move a block to enlarge the reachable area, reach the exit. Each event is checked by a small exact search where everything not allowed is a wall (blocks are unfrozen one at a time), and a best-first search chains the events. `--improve s` then runs the `improve` pipeline from the plan; `--apply` saves the result only if it wins and is shorter than the saved solution. It solved pc-11 with no hints (346 moves, 310 after `improve`), but it is incomplete and weak on key-and-door grids: use it after `findSolution`, not instead of it. The static dead-state test (`deadPruning`, `keyDominance`) is sound but off by default: it never fired on the real levels and slows the search. Details in `docs/solver-study.md`.

Limits (defaults in brackets): blocks unfrozen per key event `--max-free` [3], per fill `--fill-free` [1], for the exit `--exit-free` [2]; restricted searches per event `--tries` [60] and macro-states per search `--sub-states` [5,000] (and 8,000 per event attempt); end states kept per event `--alternatives` [1]. With `--widen n` [1], a state where a cap stopped an event is queued again one level higher, behind the states of the same estimate and lower novelty: each level adds one unfrozen block, doubles tries and macro-states, and, from level `--all-doors` [1] on, allows every door (not only those on a route with the fewest doors or with a key behind; `--all-doors 0` helps pc-09, where a door only gives access to blocks, but lengthens pc-11). Keys are taken only by their own event unless `--side-keys on` (a key taken on the way multiplies the restricted search). Cheap relaxed tests skip impossible events (key unreachable, water no block can reach, exit behind water or behind more doors than keys); a fill may open the doors next to its water. Failing runs print, per event kind, which cap stopped how many events.

### Hand-written stages: `subgoal`

    npm run subgoal -- <id> <stages-file> [--from-solution] [--timeout s] [--max-states N] [--max-memory MB] [--improve s] [--apply]

The same restricted searches as `plan`, but the event order is written by hand. A stages file has one stage per line (`#` starts a comment); a stage is a list of clauses, each a keyword followed by cells `x,y`:

| Clause | Meaning |
| --- | --- |
| `key x,y…` / `water x,y…` / `door x,y…` | goal: those keys taken / waters filled / doors opened |
| `at x,y…` | goal: a block stands on each cell |
| `reach x,y…` | goal: the player can walk to each cell |
| `player x,y` | goal: the stage ends with the player on that cell (cell of its last push, key or door) |
| `exit` | goal: win (alone on its line) |
| `blocks x,y…` | blocks allowed to move, named by their cell at the start of the stage |
| `doors x,y…` / `waters x,y…` / `waters all` | doors that may be opened / waters a block may fill (besides those of the goals) |
| `max N` | macro-state limit of this stage (default `--max-states`, 200 000) |

All goals of a line must hold together. Everything not allowed is frozen as a wall: other blocks and doors, other waters. Example: `water 14,8 blocks 13,8`, `key 0,0`, `door 6,4`, `exit`. Each stage is a shortest search from the end of the previous one (a stage already satisfied costs 0); the output gives the moves of each stage, or the failing stage, its line and why (unreachable, with the frozen blocks the player could push; state limit; `--timeout` per stage, default 60 s). The chained moves are replayed with the real rules and must win. `--improve` and `--apply` work as in `plan`.

`--from-solution` first writes the stages of the saved solution into the stages file (never overwritten): one stage per event, with the blocks moved in the segment, `at`/`player` pins on its end state and its length in a comment, so it rebuilds a solution at most as long. Edit it (reorder stages, drop the pins, free other blocks) to get starting points `improve` cannot reach by local changes (pc-11 went from 326 to 310 moves with another event order). Relative paths are resolved from the directory `npm` was started from.

### Other starting points: `explore`

    npm run explore -- <id…> [--timeout s per level] [--variants n] [--improve-top k] [--screen f] [--pass f] [--merge-window k] [--merge-neighbours n] [--merge-widen n] [--merge-states N] [--merge-timeout s] [--stage-states N] [--stage-states-max N] [--stage-timeout s] [--large-memory MB] [--seed n] [--max-memory MB] [--workers n] [--total-memory MB] [--from dir] [--save dir] [--apply]

`improve` only shortens windows towards the same state, so it keeps the order of the events. `explore` starts from the saved solution, cuts it into its events (as `subgoal --from-solution`: one stage per key, water, door, exit, with its blocks and its end pins) and rebuilds **variants of that plan** with the exact per-stage searches of `subgoal`:

- stages swapped, moved (mostly up to 8 places, else anywhere), chains of 2–6 stages moved anywhere, sub-sequences reversed, adjacent blocks of stages exchanged;
- adjacent stages merged (one search reaches both goals in the best order; at most 4 movable blocks) or split again;
- any stage but the exit dropped (its event is no longer required: a useless fill, a door or a key the rest does without), and restored later;
- end pins dropped per stage (`player`, `at`);
- an extra stage that fills a water the solution leaves unfilled with a nearby block it never pushes (shortcut, as in pc-11's planner solution), or removes it.

Each round starts with a systematic **structural pass** on the best solution (`--pass`, 0.3 of the round; 0 turns it off). Its candidates are rebuilt from the end of the plan backwards (a late change only rebuilds a short suffix), first improvement kept (the pass then starts again from the shorter solution); at each stage: the stage dropped; the stages from there to the exit merged with it when they are at most `--merge-window` (6), door goals optional; every window of 2…6 consecutive stages starting there merged into one **wide search**: all blocks the window moves are free, plus the `--merge-neighbours` (2) closest blocks it does not move (≤ 4 cells from its goals and blocks), every water may be filled, up to `--merge-states` (2,000,000) macro-states and `--merge-timeout` (60 s); each window is tried with its end pinned, free, free with optional doors, and free with the neighbours. When every candidate failed, the pass widens (`--merge-widen` levels, 5): level i merges windows of up to window + 2i stages with neighbours + 4i blocks up to 4 + 2i cells away, with ¼, ½, then all of the merge limits (levels 0, 1, 2 and up: a quick first sweep; a window already tried with smaller limits is tried again with larger ones). Candidates already rebuilt are never rebuilt again (later rounds go on where the pass stopped). A shorter pass result gets improve's windows and spare keys right away (a door made useless by a merge frees a key pickup).

Stage limits: each stage search has `--stage-states` (200,000) macro-states and `--stage-timeout` (10 s). The rebuild of the plan as is and the structural pass retry a stage stopped by one of those caps with 4× the cap and the time, up to `--stage-states-max` (3,200,000), so a 3-block stage of pc-18 no longer makes the plan unbuildable; random variants do not retry (their failures are cheap and frequent). Each search has its own memory budget: `--max-memory` for ordinary stages (256 MB if not given; it also caps improve's windows), `--large-memory` (1,024 MB) for retried and wide searches; one search at a time per thread.

Threads: the structural pass rebuilds its candidates on `--workers` worker threads (default: the cores minus 2, at most 16; `--workers 1`: in the main thread, as before), each with its own memo of the current solution's stages; the screening and improve stay in the main thread. Each worker counts `max(--large-memory, --max-memory)` + 512 MB (its V8 heap is capped there), the main thread `--max-memory` + 512 MB; `--total-memory` (default: free memory − 4 GB) lowers the number of workers to fit (with not even one worker, one is kept with smaller large searches); the line `structural pass on N thread(s)` gives the choice. Determinism: candidates start in the order of the sequential pass and their results are committed in that order, so the gain kept is always the one with the lowest candidate index, as with one thread; a gain cancels the candidates after it (stopped within moments, nothing of them is memoised or counted as tried), the earlier ones still finish and win if they improve too. Only the search time limits can make a run differ from `--workers 1` (a thread slowed down by the others may stop a search that would have finished).

Blocks are named by identity (the block that started on a cell), so a moved stage still frees the same blocks wherever they stand; a block that has already sunk is simply not free. Every stage search is memoised (start state, stage, block cells): variants share most stages, so a level rebuilds from ~5 variants per second (pc-18, 1,500 moves) to several thousand (pc-11, pc-16). A local search accepts variants that are not longer and restarts from a kept one after 150 steps without progress; the `--improve-top` (3) shortest distinct variants, never the saved solution itself, then get improve's windows and spare keys pass (no proof: its time goes to the variants). A round takes `--screen` (0.3) of the time for the screening and at most (1 − screen) / k per improved variant; rounds repeat until `--timeout` (300 s), each from the best solution so far, with another seed and never the same variant twice. `--variants` caps the variants per round (default: time only).

The line per level gives saved → best length, rounds, the gains of the structural pass, variants (feasible, stage retries), the rebuild of the plan as is, the best variant of the first round and each improve run. Rounds start from the shortest solution so far, and a screened variant shorter than it is kept even if improve does not shorten it. `--from dir` starts from the shortest winning `dir/<id>-<n>.txt` when it beats the saved solution (to chain runs); the saved solution stays the reference for writing. Without `--apply` or `--save`, nothing is written; `--save dir` writes each shorter solution as `dir/<id>-<length>.txt` (moves only); `--apply` writes it with the rules of `plan --apply` (only if it wins and is strictly shorter, platinumMoves lowered only when shorter, the proven lower bound of the saved header kept). It is a separate command rather than an `improve` flag: it needs a winning solution, has its own knobs, and `improve` stays the reference pipeline with its proof. Measurements in `docs/solver-study.md`.

## Time medals: `times`

    npm run times -- [<id…>] [--from <dir>] [--apply] [--force]

Proposes `goldTime` (seconds) for each level from the shape of its saved solution (or of
`<dir>/<id>.txt` with `--from`, e.g. the gold reference when the saved solution is the shorter
platinum one); silver and bronze follow from it (×1.25 and ×1.5, with minimum gaps, see
`resolveThresholds`). Without `--apply` it only prints the table (moves, turns, interactions,
estimate, proposed and current goldTime); `--apply` writes goldTime into levels that have none,
`--force` also replaces an existing one.

New levels get it automatically: every tool that writes a solution (`solve`, `improve`, `plan`,
`subgoal`, `explore`, `longrun` with `--apply`, and "Save solution" in author mode, which runs
`improve --apply`) goes through the shared thresholds writer (`applyThresholds` in
`packages/tools/src/commands.ts`), which, for a level without `goldTime`, computes it from the
gold reference solution: the written one when the write sets `goldMoves`; otherwise the solution
saved before the write if it has `goldMoves` moves, else the written one if it has; else nothing
is guessed and the tool prints `goldTime missing: run npm run times -- <id> --apply [--from …]`.
An existing `goldTime` is never replaced there (only `times --force` does), and `validate` warns
about a level without one.

The rule (`TIME_RULE` in `packages/tools/src/times.ts`) is

    goldTime ≈ max(0.05 s × moves + 0.3 s × turns, 0.1 s × moves)

rounded to the second (to 5 s above one minute), where turns are the direction changes of the
solution. It comes from player statistics of an earlier version of the game (same rules, 18×18
boards, clock started by the player after studying the map): 238 maps with at least five
finishers, each solved, and the mean of the three best times fitted against the solution's
features. Moves and turns explain most of it (pushes, keys and doors add nothing measurable once
turns are counted); the fit is coarse — within ×1.2 on half the maps, ×1.5 on 80% — and the
coefficients were rounded up by 10–20%: a strong player (around the top three on most maps)
gets gold on ~60% of the maps and silver on most others, the median finisher at least bronze on
~60%. The levels of this game that existed in that earlier version are harder than the average
map (their recorded times are 0.9–2.3× the rule), so expect gold to be demanding on the long
puzzle levels; adjust a level by hand when play-testing says so (`times --apply` without
`--force` never overwrites it). Our game takes the next move while the previous one is still
animated, so the floor is the human input rate (10 moves/s), not the animation.

Touch play (continuous drag, or the D-pad with hold to repeat) is slower than the keyboard; the
thresholds are calibrated for the keyboard.

## Difficulty: `difficulty`

    npm run difficulty -- [<id…>] [--trap-points n] [--trap-states n] [--solver-states n] [--solver-timeout s]

Ranks the levels (all of them, by default) by a difficulty score computed from the level and its
saved solution, easiest first, with the chapter of each (`packages/tools/src/difficulty.ts`). The
move count says little about difficulty: a long walk is long, not hard. The tool measures what
asks for thought instead, along the saved solution:

- **episodes**: interactions grouped by the object handled — any number of pushes of the same
  block in a row (walking around it included) is one episode, each key and door one; how many
  times the player picks what to do next. **Actions** (push runs: the same block pushed on in the
  same direction) and **stages** (`deriveStages`: keys, waters, doors, exit) are shown too;
- **irreversible**: commitments — fills, doors opened, and push runs the player cannot push
  straight back right after;
- **branching**: the mean number of distinct interactions open at each decision point (the
  macro-state before each interaction of the solution);
- **traps**: at up to `--trap-points` (40) decision points evenly spaced, each alternative
  interaction is applied and tested: lost if the dead-state analysis says so, or if an exact
  search of at most `--trap-states` (5,000) macro-states (250 ms) proves it unwinnable. On large
  levels those small searches rarely conclude, so traps are mostly 0 there (a lower bound);
- **solver states**: macro-states the exact solver explores to find the optimum, capped at
  `--solver-states` (1,000,000) and `--solver-timeout` (30 s);
- **walk share**: moves without interaction.

The score is a weighted sum on log scales, so the 40th decision adds less than the 4th:

    score = 10·log2(1 + episodes) + 5·log2(1 + irreversible) + 4·log2(branching)
          + 2·log10(solver states) + 20·traps / (alternatives + 10) + 2·log2(1 + walking moves)

Calibration (2026-10-15): the Easy levels score 39–58, Medium 66–83, Hard and Expert 100–151;
Cubomatic (pc-10, 325 moves) scores 101, the lowest of the Hard and Expert levels, below
levels a third of its length. A score difference of a few points is noise; the tool ranks, the
designer decides (the tutorial pc-01 scores above most Easy levels: five one-shot lessons, every
wrong push fatal). The whole table takes about a minute.

## Designer tools in the game (`npm run dev` only)

In author mode (development server only):

- **Save solution**: on the result screen, after finishing a level, this button sends your moves to the server, which replays them (refused if they do not win), writes them to `levels/solutions/<id>.txt` (header `# designer solution (not optimized)`) and then runs `improve <id> --apply` in the background. The game shows the progress (current step, elapsed time) then the result: "Optimized: X → Y moves (proven optimal | best known, lower bound ≥ L)", "Already optimal" or "No improvement". If a saved solution that is as short or shorter already exists, saving is refused and the "Replace anyway" button appears.
- **Replay my solution / Replay optimized solution**: animated replay (8 moves/s at the start). Space: pause/play; ←/→: previous/next move; +/−: speed (1 to 20 moves/s); Home: back to the start; Esc: back. On-screen buttons do the same.
- On the selection screen of a level that has a saved solution: "Replay solution" button (or S key).

Settings: `PC_IMPROVE_TIMEOUT=<seconds>` (default 120) sets the maximum duration of an optimization; one job at a time per level; children are stopped when the server stops. The optimization may rewrite `platinumMoves` (or `goldMoves` and `goldTime` on a level without them; the result then shows the reference time) in the `.tmx` (same rule as the CLI): the page is then not reloaded automatically, reload it to see the new threshold. The `/__pc/*` routes do not exist in the build, and nothing from `levels/solutions` is bundled in it.

Details: a short `PC_IMPROVE_TIMEOUT` may show "best known" on a level proven optimal with a longer budget; forcibly replacing a proven solution never degrades it, though (the old one is kept in `<id>.prev.txt` during the work, then restored if the new run proves nothing). A stuck job is killed by the server after the timeout + 90 s. The write routes rely on Vite's host checks: do not start the server with `--host` or `allowedHosts: true`.

## Layout

- `packages/core` — rules, medals, progress, exact solver, the "best known" pipeline (`src/improve`) and the event planner, stages and explore (`src/planner`) (pure TypeScript, no dependencies)
- `packages/tiled` — reading/writing Tiled maps
- `packages/gpu` — exact GPU engine (WebGPU), loaded on demand by `--gpu`
- `packages/tools` — `validate` / `solve` / `improve` / `plan` / `subgoal` / `explore` CLI
- `packages/game` — Phaser 4 + Vite + PWA game

Credits: see `CREDITS.md`.
