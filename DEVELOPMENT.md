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

## Creating levels with Tiled

1. Create an orthogonal map, 16×16 tiles, tile layer data format **CSV**.
2. Add the tileset `levels/tileset.tsx`.
3. Paint the `terrain` layer (floor, gravel, water, wall, exit). Start, keys, doors and blocks are
   painted in that same layer (placed on floor) or in an object layer (for example to put a key on
   gravel).
4. Map properties: `name`, `author`, `initialKeys` (int, can be negative), `platinum` (bool),
   `goldMoves`, `goldTime` (seconds) and, if needed, `silverMoves`, `bronzeMoves`, `silverTime`,
   `bronzeTime`, `platinumTime`.
5. Save as `levels/<id>.tmx` and add `<id>` to `levels/chapters.json`.
6. `npm run validate`, then `npm run solve -- <id> --apply` to compute the optimal solution and `goldMoves`.
   A start placed on water is allowed (the player can leave it but never come back); `validate`
   reports it with a warning so that it is a deliberate choice.

In author mode (`npm run dev` or `?dev` in the URL), all levels are unlocked and the result screen
lets you copy `goldMoves`/`goldTime` and the solution you played.

### Providing your own solution (levels too large for the exact solver)

1. Play the level in author mode until the exit.
2. On the result screen, "Copy solution".
3. Paste it into `levels/solutions/<id>.txt`.
4. `npm run improve -- <id> --apply`: the solution is shortened if possible, saved with its status
   on the first line, and `goldMoves` is lowered if it is shorter.

## Solutions (spoilers!)

`levels/solutions/` contains reference solutions (all 22 current levels, including 10 best known but not proven optimal: pc-04, pc-07, pc-08, pc-09, pc-11, pc-13, pc-14, pc-16, pc-17, pc-18; the others are proven optimal; the first line of each file gives its status), replayed by `npm run validate` and the tests. The solver found some of them directly; the hardest ones (pc-07, pc-08, pc-09, pc-11, pc-13, pc-14, pc-16, pc-17, pc-18) were built by chaining small sub-goal searches (one key or one filled water cell at a time, other blocks frozen as walls), then shortened with `improve`. New ones can be added with `npm run solve -- <id> --apply`, or by playing in author mode and saving the solution from the result screen. They are not included in the published game, but they are readable in the repository.

Current solver limits: exact A* search bounded by time (60 s by default, `--timeout <s>`) and by memory (`--max-memory <MB>` per process, computed by default, see below); `--max-states <n>` adds a state limit (none by default). The compact engine stores a macro-state in ~60–110 bytes (typed arrays outside the V8 heap, which it caps itself) and processes one in ~1–6 µs. When memory or the state limit stops it before the deadline, it restarts for the remaining time with partial expansion (slower, but deeper for the same memory) and keeps the best bound. Large levels with many pushable objects exceed these limits and stay without an optimal solution: `improve` (below) then starts from the designer's solution or looks for a non-optimal one. When a limit is hit, `solve` prints a **proven lower bound** (`≥ L moves`: no solution is shorter) and reports an error if the level's `goldMoves` is below that bound (unreachable threshold).

`--apply` writes the solution and `goldMoves` of a level that has none; an existing `goldMoves` is only replaced (together with its solution) by a proven optimum that is strictly shorter, or always with `--force`. An existing solution is not rewritten otherwise.

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

Without `--apply`, nothing is written. With `--apply`, the solution is written with a first comment line (ignored when reading): `# optimal (proven)` or `# best known — not proven optimal (proven lower bound ≥ L)`. `goldMoves` follows the `solve` rule: an existing `goldMoves` is only lowered by a strictly shorter solution, or always with `--force`. `npm run validate` checks that all solutions win and warns about a `goldMoves` longer than the saved solution.

A saved solution that is unreadable or does not win is never overwritten without `--force`: it is kept and reported, the solution found is written next to it in `levels/solutions/<id>.found.txt`, and `goldMoves` is left untouched; that `.found.txt` is deleted as soon as the saved solution is valid again (or with `--force`). `solve --apply` also writes the `# optimal (proven)` header. `solve` and `improve` replay every solution before writing it: a solution that does not win is an error and nothing is written. The `improve` watchdog kills a child process past `--timeout` plus 60 s.

### Long run on one level: `longrun`

    npm run longrun -- <id> [--work-dir d] [--max-disk GB] [--max-memory MB] [--threads n] [--partitions n]
                            [--timeout s] [--bound n] [--watch file]… [--gpu auto|on|off]
                            [--compress none|gen|all] [--resume] [--apply]

Exact search of a single level with the whole machine: worker threads, the GPU, RAM, then the disk. It only
looks for solutions strictly shorter than the saved one (`levels/solutions/<id>.txt`, re-read before
each layer, as are the `--watch` files: a shorter winning solution saved meanwhile lowers the bound;
`--bound n` replaces them). States are processed by layers of moves (uniform cost), partitioned by
hash into files, duplicates removed per partition against the states already expanded (delayed
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
  (header `# optimal (proven)`, `goldMoves` lowered); an exhausted search marks the saved solution
  `# optimal (proven)`; a stopped one raises the lower bound in its header.
- Measurement options: `--dead-pruning` (dead-state test before expanding), `--gen-strong s`
  (strong bound on successors whose weak f is within `s` of the bound).

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

    npm run explore -- <id…> [--timeout s per level] [--variants n] [--improve-top k] [--screen f] [--seed n] [--max-memory MB] [--from dir] [--save dir] [--apply]

`improve` only shortens windows towards the same state, so it keeps the order of the events. `explore` starts from the saved solution, cuts it into its events (as `subgoal --from-solution`: one stage per key, water, door, exit, with its blocks and its end pins) and rebuilds **variants of that plan** with the exact per-stage searches of `subgoal`:

- stages swapped, moved up to 8 places, sub-sequences reversed, adjacent blocks of stages exchanged;
- adjacent stages merged (one search reaches both goals in the best order; at most 4 movable blocks) or split again;
- end pins dropped per stage (`player`, `at`);
- an extra stage that fills a water the solution leaves unfilled with a nearby block it never pushes (shortcut, as in pc-11's planner solution), or removes it.

Blocks are named by identity (the block that started on a cell), so a moved stage still frees the same blocks wherever they stand; a block that has already sunk is simply not free. Every stage search is memoised (start state, stage, block cells): variants share most stages, so a level rebuilds from ~5 variants per second (pc-18, 1,500 moves) to several thousand (pc-11, pc-16). A local search accepts variants that are not longer and restarts from a kept one after 150 steps without progress; the `--improve-top` (3) shortest distinct variants, never the saved solution itself, then get improve's windows and spare keys pass (no proof: its time goes to the variants). A round takes `--screen` (0.3) of the time for the screening and at most (1 − screen) / k per improved variant; rounds repeat until `--timeout` (300 s), each from the best solution so far, with another seed and never the same variant twice. `--variants` caps the variants per round (default: time only).

The line per level gives saved → best length, rounds, variants (feasible), the rebuild of the plan as is, the best variant of the first round and each improve run. Rounds start from the shortest solution so far, and a screened variant shorter than it is kept even if improve does not shorten it. `--from dir` starts from the shortest winning `dir/<id>-<n>.txt` when it beats the saved solution (to chain runs); the saved solution stays the reference for writing. Without `--apply` or `--save`, nothing is written; `--save dir` writes each shorter solution as `dir/<id>-<length>.txt` (moves only); `--apply` writes it with the rules of `plan --apply` (only if it wins and is strictly shorter, goldMoves lowered only when shorter, the proven lower bound of the saved header kept). It is a separate command rather than an `improve` flag: it needs a winning solution, has its own knobs, and `improve` stays the reference pipeline with its proof. Measurements in `docs/solver-study.md`.

## Designer tools in the game (`npm run dev` only)

In author mode (development server; the `?dev` option alone is not enough since there is no server behind it):

- **Save solution**: on the result screen, after finishing a level, this button sends your moves to the server, which replays them (refused if they do not win), writes them to `levels/solutions/<id>.txt` (header `# designer solution (not optimized)`) and then runs `improve <id> --apply` in the background. The game shows the progress (current step, elapsed time) then the result: "Optimized: X → Y moves (proven optimal | best known, lower bound ≥ L)", "Already optimal" or "No improvement". If a saved solution that is as short or shorter already exists, saving is refused and the "Replace anyway" button appears.
- **Replay my solution / Replay optimized solution**: animated replay (8 moves/s at the start). Space: pause/play; ←/→: previous/next move; +/−: speed (1 to 20 moves/s); Home: back to the start; Esc: back. On-screen buttons do the same.
- On the selection screen of a level that has a saved solution: "Replay solution" button (or S key).

Settings: `PC_IMPROVE_TIMEOUT=<seconds>` (default 120) sets the maximum duration of an optimization; one job at a time per level; children are stopped when the server stops. The optimization may rewrite `goldMoves` in the `.tmx` (same rule as the CLI): the page is then not reloaded automatically, reload it to see the new threshold. The `/__pc/*` routes do not exist in the build, and nothing from `levels/solutions` is bundled in it.

Details: a short `PC_IMPROVE_TIMEOUT` may show "best known" on a level proven optimal with a longer budget; forcibly replacing a proven solution never degrades it, though (the old one is kept in `<id>.prev.txt` during the work, then restored if the new run proves nothing). A stuck job is killed by the server after the timeout + 90 s. The write routes rely on Vite's host checks: do not start the server with `--host` or `allowedHosts: true`.

## Layout

- `packages/core` — rules, medals, progress, exact solver, the "best known" pipeline (`src/improve`) and the event planner, stages and explore (`src/planner`) (pure TypeScript, no dependencies)
- `packages/tiled` — reading/writing Tiled maps
- `packages/gpu` — exact GPU engine (WebGPU), loaded on demand by `--gpu`
- `packages/tools` — `validate` / `solve` / `improve` / `plan` / `subgoal` / `explore` CLI
- `packages/game` — Phaser 4 + Vite + PWA game

Credits: see `CREDITS.md`.
