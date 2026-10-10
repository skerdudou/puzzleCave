# Solver study (2026-10-10) — Fable + Opus synthesis

> **Level changes after the measurements below.** `pc-11` now has the water put back on the start tile; its former 644-move solution no longer wins. The machine searches failed on it (lower bound ≥ 112); a 340-move solution was then built by decomposing the level into sub-goals (one key or one filled water cell at a time, other blocks frozen as walls, each sub-search under 1,000 states), and `improve` shortened it to 326 (`goldMoves` 326, lower bound ≥ 100 at 50 M states). The chapters are `easy`, `medium`, `hard`.

Two independent studies (Fable and Opus models), which then compared their results. Prototypes: branches `solver-study` (Fable, folder `study/`) and `solver-opus` (Opus, folder `study/`) of the repository.

## Findings
- **The v2 solver is correct** (A* over interactions, admissible and consistent bounds, complete state key): neither study found a bug. A relaxed reachability analysis shows that no level is unsolvable as encoded.
- **The bottleneck is combinatorial, not speed.** The bounds are very weak in depth (h(start)/optimum = 51/401 on pc-03), so the search behaves almost like Dijkstra; the number of states grows by ×1.18 to ×3.9 per extra move of depth. Even 1000× more capacity would not close the gap on the hard levels.
- Levers measured to have **no notable effect**: strengthened bounds (−0.2% states on pc-06), dead-state pruning (0%), weighted A* W=5 (no solution found), key dominance (0 states pruned), seeding with the upper bound.
- **Effective** levers:
  - freezing into walls the blocks a solution does not use (exact restriction): pc-03 1.21 M → 374 k states, pc-02 ×12.6;
  - "novelty" search (BFWS) to **find** a solution: pc-04 solved for the first time (1608 moves);
  - exact window re-optimization of an existing solution: pc-04 1608 → **902 moves** (replayed, wins). Proven lower bound: 54.
- Level families: keys/doors grids (pc-15/16/17: ~41 keys, ~123 doors); 36-block grids (pc-07 to pc-14, pc-18); 29 blocks + 20 doors (pc-04).

## Recommended plan (consensus)

Dropped by the owner (2026-10-10): the native port (Rust, HDA*) and secondary bounds beyond the "distinct doors" bound done in step 2 (no "water chains" bound).

1. **~1 day**: `solve --all` in parallel (one process per level, 6–8 at a time, ~6 M states each, < 70% of RAM); when a limit is hit, print the proven lower bound (f depth of the last state popped from the heap).
2. **~1 week, in TypeScript**: compact exact engine (packed integer state keys, typed hash table without the 16 M limit, direct expansion without `step()`, partial expansion for the keys/doors family). Expected gain 3–5× in speed, ~4× in memory. Will only solve levels whose optimum is close to the depth reached.
3. **1–2 weeks**: "best known" gold for the others, marked `proven: false` as long as lower bound ≠ upper bound: solution search (BFWS) → re-optimization by growing windows → greedy block removal → frozen blocks → restricted exact search. `npm run validate` remains the safeguard.
4. **Solution provided by the designer** (`levels/solutions/<id>.txt`, played in author mode and copied from the result screen): entry point of the step 3 pipeline. It proves the level is solvable, gives an upper bound, and serves as the start for window re-optimization and frozen blocks; the solver can then find a shorter solution and propose it (`goldMoves` lowered, new solution) — which is exactly what took pc-04 from 1608 to 902 moves. Only seeding the exact search with its length helps little on block levels (measured), a bit more on the keys/doors family.

Risks: the solution finder still fails on pc-15, pc-11 and pc-09; frozen blocks only prove optimality for the retained set of blocks; re-optimization is local (upper bound only).

## Step 1 done — measurements (2026-10-10)

`solve --all` in parallel (`--jobs`, one child process per level) and proven lower bound when a limit is hit (largest f = cost + lower bound popped from the heap; proof in a comment of `solve`). Machine: Ryzen 7 3700X, 32 GB, ~37% of RAM already used by other programs at launch.

Command: `npm run solve -- --all --apply --timeout 300 --max-states 6000000 --jobs 5` (heap ≤ 2089 MB per child; 8 processes would only have had ~1.3 GB each, too little for 6 M states, which need ~1.5–1.9 GB). Total duration **258 s**; machine RAM peak **55%**; no level reached 300 s: the state limit is the only constraint.

| level | status | moves / bound | states | duration | peak RSS |
|---|---|---|---|---|---|
| pc-01 | solved | 17 | 3 | 0.0 s | 66 MB |
| pc-02 | solved | 151 | 117,620 | 5.0 s | 154 MB |
| pc-03 | solved | 401 | 1,209,297 | 58.5 s | 644 MB |
| pc-04 | limit | ≥ 62 (gold: 902, not proven) | 6,000,000 | 78.4 s | 1860 MB |
| pc-11 | limit | ≥ 76 | 6,000,000 | 88.2 s | 1909 MB |
| pc-05 | solved | 52 | 2,242 | 0.1 s | 67 MB |
| pc-15 | limit | ≥ 36 | 6,000,000 | 38.0 s | 1523 MB |
| pc-06 | solved | 176 | 466,993 | 5.5 s | 302 MB |
| pc-16 | limit | ≥ 38 | 6,000,000 | 38.8 s | 1676 MB |
| pc-17 | limit | ≥ 38 | 6,000,000 | 40.2 s | 1665 MB |
| pc-12 | limit | ≥ 80 | 6,000,000 | 76.5 s | 1484 MB |
| pc-13 | limit | ≥ 82 | 6,000,000 | 89.2 s | 1770 MB |
| pc-09 | limit | ≥ 77 | 6,000,000 | 80.0 s | 1717 MB |
| pc-10 | solved | 325 | 1,499,507 | 75.7 s | 557 MB |
| pc-14 | limit | ≥ 84 | 6,000,000 | 87.2 s | 1870 MB |
| pc-08 | limit | ≥ 85 | 6,000,000 | 66.8 s | 1451 MB |
| pc-18 | limit | ≥ 72 | 6,000,000 | 56.7 s | 1772 MB |
| pc-07 | limit | ≥ 96 | 6,000,000 | 140.0 s | 1608 MB |

No new level solved (the 6 solved ones already had their solution and `goldMoves`, unchanged); no `goldMoves` is below its bound. The bounds remain far from the probable optima (pc-04: ≥ 62 versus 902 known), which confirms the finding: the f depth reached with 6 M states is low, and only a more compact engine (step 2) or the "best known" search (step 3) can move these levels forward.

## Step 2 done — compact exact engine (2026-10-10)

`solve` is now the compact engine (`packages/core/src/solver.ts`, `compactModel.ts`, `compactStore.ts`, `compactBound.ts`); the old engine remains as `solveV2` (test reference), together with `solveNaive`.

- **Packed state** in `Uint32` words: player and pocket keys, then a bit field — keys/doors present, filled waters, blocks on the candidate cells only (closure of the initial blocks under relaxed pushes). pc-03: 10 words.
- **Hash table** with open addressing (32-bit MurmurHash3 + full comparison, load ≤ 0.75, doubling), nodes in blocks of 4096 without copying (key, parent, 16-bit cost, edge "cell × 4 + direction", lower bound, flag), typed binary heap (32-bit priority = f · 2^16 + 65535 − cost). No object, string or `Map` per state; the walk is rebuilt by BFS at the end.
- **Direct expansion** on the packed state (walk and interactions in a single BFS): reimplementation of `step.ts` checked state by state against `step()` on 400 random levels, and by equivalence with the naive BFS.
- **"Distinct doors" lower bound** (Fable, bound2.ts), consistent (proof in `compactBound.ts`, checked on > 10,000 transitions). For ≥ 2 keys, the bound2.ts formula could be weaker than the v2 bound (case found by the tests); fixed to d(p,k1) + max(d(k1,k2), (need−1)·δ) + d(k2,E). The "doors to the exit" table is cached per set of remaining doors: ≈ 0 µs, except on the keys/doors family (125 doors, ~4 µs).
- **Memory**: the solver caps its own typed arrays (`maxMemoryMb`, outside the V8 heap) and stops cleanly at that cap, with the proven bound. `solve --all` gives each child its share of the budget, (0.7 × total − used) / jobs, and at least 1.5 GB. Explicit `--max-memory` possible; `--max-states` has no limit by default.
- **Partial expansion (PEA\*)**, measured. When the search completes, it stores barely fewer states (pc-03: 1,196,762 versus 1,197,830; almost all generated states have f ≤ C*) and costs ~1.7× the time. When a limit is hit, at equal memory, it goes deeper (300 MB: pc-15 ≥ 40 versus 36, pc-04 ≥ 68 versus 60), but ~6–10× slower per state. Hence the `auto` mode, used by the CLI: normal search, then, if memory stops it before the deadline, partial search in the same arrays for the remaining time; the better of the two results is kept.

Micro-bench (1 core, quiet machine, no state limit; pc-15: 2 M states):

| level | v2 µs/state | compact µs/state | v2 B/state (RSS) | compact B/state | v2 duration | compact duration |
|---|---|---|---|---|---|---|
| pc-03 (401) | 42.1 | 3.6 | 547 | 73 | 51.0 s | 4.3 s |
| pc-10 (325) | 46.0 | 4.1 | 311 | 63 | 69.0 s | 6.2 s |
| pc-15 (≥ 36) | 5.7 | 0.8 | 384 | 107 | 11.3 s | 1.5 s |

`npm run solve -- --all --apply --timeout 300`: the automatic plan started 5 processes, solver ≤ 1406 MB each. The machine was at ~46% RAM at launch; peak **67.5%**, with the other agents. Total duration **506 s**.

| level | status | moves / bound (step 1 → 2) | states | duration | peak RSS |
|---|---|---|---|---|---|
| pc-01 | solved | 17 | 3 | 0.0 s | 73 MB |
| pc-02 | solved | 151 | 117,620 | 0.5 s | 79 MB |
| pc-03 | solved | 401 | 1,197,830 | 5.1 s | 152 MB |
| pc-04 | limit | ≥ 62 → **≥ 76** (gold: 902, not proven) | 17,348,497 | 155.8 s | 1328 MB |
| pc-11 | limit | ≥ 76 → **≥ 92** | 17,987,458 | 163.2 s | 1343 MB |
| pc-05 | solved | 52 | 2,243 | 0.0 s | 74 MB |
| pc-15 | limit | ≥ 36 → **≥ 40** | 12,582,912 | 117.6 s | 1263 MB |
| pc-06 | solved | 176 | 459,025 | 0.7 s | 118 MB |
| pc-16 | limit | ≥ 38 → **≥ 42** | 12,582,912 | 111.8 s | 1264 MB |
| pc-17 | limit | ≥ 38 → **≥ 42** | 12,582,912 | 113.6 s | 1264 MB |
| pc-12 | limit | ≥ 80 → **≥ 98** | 17,624,661 | 162.0 s | 1385 MB |
| pc-13 | limit | ≥ 82 → **≥ 100** | 18,039,753 | 182.0 s | 1392 MB |
| pc-09 | limit | ≥ 77 → **≥ 87** | 16,959,709 | 124.7 s | 1423 MB |
| pc-10 | solved | 325 | 1,499,507 | 7.7 s | 159 MB |
| pc-14 | limit | ≥ 84 → **≥ 102** | 17,717,787 | 172.9 s | 1297 MB |
| pc-08 | limit | ≥ 85 → **≥ 95** | 17,131,528 | 108.1 s | 1310 MB |
| pc-18 | limit | ≥ 72 → **≥ 92** | 18,378,752 | 56.1 s | 1393 MB |
| pc-07 | limit | ≥ 96 → **≥ 116** | 17,400,842 | 266.0 s | 1315 MB |

No new level solved: memory (1.4 GB per process) stops all searches before 300 s. The bounds progress by +4 to +20 moves, but remain far from the probable optima (pc-04: ≥ 76 versus 902 known). The keys/doors family (pc-15/16/17) stops at 12,582,912 states: at the next doubling, the table no longer fits in the budget. The 6 solved levels are solved in ≤ 8 s (versus 76 s in step 1), with the same lengths; `npm run validate` is OK.

## Step 3 done — "best known" gold (2026-10-10)

`improveLevel` pipeline (`packages/core/src/improve/`), command `npm run improve`: starting point (designer's solution if it wins, otherwise `findSolution`, port of the study's BFWS) → `reoptimize` (windows of 8, 16, 24… interactions overlapping by half, exact shortest path to the identical state, fixed point at each size) → `spareKeys` (added later, see "Spare keys pass") → `freezeStage` (never-pushed blocks frozen into walls, restricted exact search, then greedy removal of used blocks) → proof (global exact search bounded by the current length). The exact engine is a parameter (`ExactEngine`, `solve` by default, with optional `upperBound`); the inner windows have their own engine (`WindowEngine`, `searchWindow` by default). Budget per level: search ≤ 30%, windows up to 60%, frozen blocks up to 80%, proof the rest.

Command: `npm run improve -- --all --apply --timeout 600 --max-states 6000000 --jobs 5` (step 1 v2 engine; rerun with the compact engine, see "Integration of steps 2 and 3"). Total duration **1310 s**; machine RAM peak 65% (shared with two other agents; ~1.9 GB per child at most).

| level | start | before → after | status | lower bound | duration |
|---|---|---|---|---|---|
| pc-01 | designer | 17 → 17 | proven | 17 | 0.0 s |
| pc-02 | designer | 151 → 151 | proven | 151 | 44.5 s |
| pc-03 | designer | 401 → 401 | proven | 401 | 246.0 s |
| pc-04 | designer | 902 → **502** | best known | ≥ 62 | 560.5 s |
| pc-11 | none (search: 180 s, 3.1 M states) | — | — | ≥ 76 | 277.8 s |
| pc-05 | designer | 52 → 52 | proven | 52 | 0.1 s |
| pc-15 | none | — | — | ≥ 36 | 224.2 s |
| pc-06 | designer | 176 → 176 | proven | 176 | 17.7 s |
| pc-16 | none | — | — | ≥ 38 | 225.6 s |
| pc-17 | none | — | — | ≥ 38 | 226.8 s |
| pc-12 | found | 532 → **126** | best known | ≥ 80 | 441.9 s |
| pc-13 | found | 2082 → **638** | best known | ≥ 82 | 571.6 s |
| pc-09 | none | — | — | ≥ 77 | 267.8 s |
| pc-10 | designer | 325 → 325 | proven | 325 | 449.2 s |
| pc-14 | none | — | — | ≥ 84 | 274.6 s |
| pc-08 | none | — | — | ≥ 85 | 254.4 s |
| pc-18 | none | — | — | ≥ 72 | 242.2 s |
| pc-07 | none | — | — | ≥ 96 | 337.4 s |

Findings:
- Two levels get a solution and a `goldMoves` for the first time (pc-12, pc-13); pc-04 goes from 902 to 502 moves (windows alone: 902 → 502 in 360 s; from the 1608-move BFWS solution, 510 in 300 s).
- Frozen blocks are decisive when the solution leaves many blocks unused: pc-12 268 → 126 (12 blocks out of 36 kept, optimum proven for those 12 blocks). This is not a global proof: the gaps to the bounds (126 versus ≥ 80) remain large.
- The solution search fails within 180 s on 9 levels (keys/doors families pc-15/16/17, 36-block grids pc-09/14/08/18/07 and pc-11): the time limit stops it, at 2–3 M states. For them, the designer's solution (author mode → "Copy solution" → `levels/solutions/<id>.txt` → `npm run improve -- <id> --apply`) is the only realistic entry point.
- The six proven levels remain identical (solutions already optimal); only the first status line was added.

## Integration of steps 2 and 3 — final state (2026-10-10)

The `improve` pipeline now runs entirely on the compact engine:

- **Exact engine**: `solve` honors `upperBound` (any node with f ≥ bound pruned; "unsolvable" = no strictly shorter solution, which proves the current solution optimal). Tested on the random sample in the three modes (bound = optimum → unsolvable, optimum + 1 → optimum, lower bound ≤ optimum when a limit is hit). The proof and the frozen blocks use it in `auto` mode; the final windows without partial expansion (it would eat all the windows' time).
- **Inner windows** (`searchWindow`) and **solution search** (`findSolution`, BFWS) rewritten on the packed state, direct expansion, typed table and heap; the heap, the string codec and the `macro.ts` tree are removed, the guide reads the loaded state. Identical results on the windows (same replacements, same savings):

  | windows of 8 / 16 / 32 interactions, 200 k states | before | compact |
  |---|---|---|
  | pc-04 (902 moves) | 27.8 / 45.5 / 25.3 s | 1.5 / 2.7 / 1.6 s |
  | pc-13 (638) | 2.7 / 39.6 / 41.0 s | 0.2 / 2.7 / 2.7 s |
  | pc-03 (401) | 0.2 / 1.4 / 10.6 s | 0.04 / 0.09 / 0.61 s |

  That is ~15×; hence 2 M states per window by default (instead of 200 k): pc-04 in windows of 16 then saves 528 moves instead of 86. `findSolution`, 60 s: pc-11 solved in 2.7 s (1008 moves; failed in 60 s before); 5–15 µs per state instead of 40–60, and 3–5× more states on levels still without a solution (pc-09: 6.9 M versus 1.3 M).
- **Memory**: every search of the pipeline is capped by the child's budget (`solve` plan, `--max-memory`), including the BFWS novelty tables and the cache of the lower bound's door tables (sized within the budget, absent if it does not fit). `solve` and `improve` in parallel share planning, runner and summary (`runLevels`).
- **Canonical pocket keys**: reduced to [−remaining keys, remaining doors] in the codec and the expansion (16 bits guaranteed, lengths unchanged). A first version with the level's fixed bound ([−keys, doors]) gave two keys for the same real state, which the search towards an exact state (windows) revealed; tested along real games.
- **Safeguards**: `solve` and `improve` replay the solution before writing solution and `goldMoves`; `improve --apply` removes the stale `.found.txt`.
- **PEA\*, lookup in the table before deferring a successor**: measured then rejected — same states and same bound (pc-15 ≥ 40, pc-04 ≥ 68 at 300 MB), but 33% (pc-15, 21.9 → 29.2 s) and 22% (pc-04, 27.2 → 33.3 s) slower: hashing each deferred successor costs more than the re-pushes avoided.

Command: `npm run improve -- --all --apply --timeout 900` (automatic plan: 5 processes, solver ≤ 1653 MB each; machine RAM 42% at launch, **peak 64.4%**). Total duration **1834 s**. Comparison with step 3 (v2 engine, 600 s per level, 6 M states):

| level | start | step 3 | integration | proven | lower bound (step 3 → final) | duration |
|---|---|---|---|---|---|---|
| pc-01 | saved | 17 | 17 | yes | 17 | 0.0 s |
| pc-02 | saved | 151 | 151 | yes | 151 | 3.2 s (44.5) |
| pc-03 | saved | 401 | 401 | yes | 401 | 44.7 s (246.0) |
| pc-04 | saved (502) | 502 | **430** | no | 62 → **78** | 877.4 s |
| pc-11 | found (1008) | — | **644** | no | 76 → **92** | 900.0 s |
| pc-05 | saved | 52 | 52 | yes | 52 | 0.0 s |
| pc-15 | — | — | — | — | 36 → **40** | 403.5 s |
| pc-06 | saved | 176 | 176 | yes | 176 | 1.2 s (17.7) |
| pc-16 | — | — | — | — | 38 → **42** | 407.3 s |
| pc-17 | found (502) | — | **244** | no | 38 → **42** | 761.1 s |
| pc-12 | saved (126) | 126 | 126 | no | 80 → **100** | 196.7 s |
| pc-13 | saved (638) | 638 | **514** | no | 82 → **100** | 900.0 s |
| pc-09 | — | — | — | — | 77 → **87** | 357.4 s |
| pc-10 | saved | 325 | 325 | yes | 325 | 97.5 s (449.2) |
| pc-14 | — | — | — | — | 84 → **106** | 506.2 s |
| pc-08 | — | — | — | — | 85 → **97** | 411.3 s |
| pc-18 | — | — | — | — | 72 → **94** | 337.7 s |
| pc-07 | — | — | — | — | 96 → **118** | 628.3 s |

Findings:
- Two levels get a solution and a `goldMoves` for the first time: pc-11 (BFWS 1008 → windows 644) and pc-17 (502 → 244). Three solutions get shorter: pc-04 502 → 430, pc-13 638 → 514 (pc-12 stays at 126). 11 saved solutions, 6 proven.
- The lower bounds rise by 4 to 22 moves, but the gaps remain large (pc-04: 430 versus ≥ 78): no new proof.
- Many levels finish before their deadline: the proof stops at the memory cap (~17–23 M states), including its partial expansion pass, which also hits memory. The remaining time is not used; only more memory per process (fewer processes, or `--max-memory`) would convert it into a bound.
- BFWS still fails on 7 levels (keys/doors families pc-15/16, 36-block grids pc-09/14/08/18/07), on time (270 s) or memory (pc-09: 22.5 M states). For them, the designer's solution remains the entry point.

## GPU option done — `--gpu` (2026-10-10)

Package `packages/gpu` (WebGPU, `webgpu` 0.6.2 = Dawn, loaded by dynamic import), taken from the prototype of the `gpu-study-opus` branch (`study-gpu/`) into production code. Machine: RTX 4070 12 GB (D3D12), Windows 11, Node 24; measurements made while another agent was using the CPU (`improve --all`).

- **Same macro-state as the compact engine**: the `CompactModel` key (remaining objects, filled waters, canonical pocket keys, player), hence same states, same codec and same path reconstruction. The level tables (cell codes, bits, grid rows, lower bound) are read from a buffer: the WGSL only depends on the number of key words and its kernels are compiled once per size (~0.3 s), then ~20 ms per small level.
- **Algorithm**: A* by f buckets (Δ = 1) with **partial expansion** (PEA*) on the card. Open states are selected by sweep, expanded per subgroup (32 threads, one grid row per thread, bit-parallel walk BFS through `subgroupShuffleUp/Down`), deduplicated insertion (linear-probing table, reservation by CAS, best cost by `atomicMin`, one parent per state). 24 micro-iterations per submission driven by the GPU (indirect dispatches), one batch in flight while the host encodes the next; frontiers that are too large go through host-driven slices. Proof of optimality and of the lower bound at the top of `packages/gpu/src/gpuSolve.ts`.
- **`solve` contract**: optimal, `upperBound` ("unsolvable" = nothing strictly shorter), proven lower bound when a limit is hit, `maxMemoryMb` = VRAM, `timeoutMs`, `maxStates`. Growing budget: 256 MB, then ×8 up to the cap if the states overflow.
- **Synchronous engine** (`ExactEngine`): the device lives in a thread (`worker_threads`) awaited with `Atomics.wait`; every solution is replayed (`replay`) before being accepted, otherwise discarded and the level taken over on the CPU; > 32 × 32 → CPU; GPU failure → CPU for the rest. Machine lock (a single process on the card); GPU lane in `runLevels`.

Measured choices (4 GB VRAM):
- Partial expansion: pc-04 ≥ 72 → **≥ 82**, pc-15 ≥ 34 → ≥ 38 (with adaptive Δ); it only stores the successors of the current window (the others stay in the parent).
- Δ = 1 rather than adaptive Δ (16 while the search is small): same duration on solved levels (pc-10 2.2 s versus 2.3 s), higher bound at equal memory (pc-15 **42** versus 40).
- Batch in flight: pc-10 3.1 → 2.2 s, pc-03 2.4 → 1.8 s. The rest is the fixed cost of a micro-iteration (~0.9 ms on the card side for 11 dispatches, 7 of them indirect).

Before (compact engine, one core, 2 GB RAM, `partialExpansion: 'auto'`) / after (GPU), with `npx tsx packages/gpu/src/bench.ts <id> [--cpu --ram 2048] [--vram MB] --timeout 120`:

| level | CPU: result | states | memory | duration | GPU 4 GB: result | states | duration | GPU 8 GB: result | states | duration |
|---|---|---|---|---|---|---|---|---|---|---|
| pc-03 | 401 | 1,197,830 | 81 MB | 4.7 s | 401 | 1,208,538 | 1.6–1.8 s | — | — | — |
| pc-10 | 325 | 1,499,507 | 87 MB | 6.6 s | 325 | 1,456,6xx | 2.2 s | — | — | — |
| pc-04 | ≥ 74 | 11,619,794 | 1738 MB | 120 s | **≥ 82** | 54,941,584 | 21.0 s | **≥ 86** | 113,661,840 | 35.0 s |
| pc-15 | ≥ 40 | 15,072,441 | 2048 MB | 120 s | **≥ 42** | 39,920,617 | 7.9 s | ≥ 42 | 83,687,268 | 11.8 s |
| pc-12 | ≥ 96 | 14,987,928 | 1736 MB | 120 s | **≥ 106** | 54,941,584 | 19.9 s | **≥ 110** | 113,661,840 | 32.7 s |

(GPU durations include compilation; buffer VRAM = the cap once the search has been extended, 76–108 bytes per state; pc-03 and pc-10 fit in the first 256 MB budget. GPU states differ slightly from the CPU's: weaker lower bound, different expansion order.)

End-to-end `improve` on pc-12 (`--timeout 300 --max-memory 2048`): CPU **≥ 100** in 199 s (proof: 25 M states); `--gpu on --max-vram 8192` **≥ 110** in 36 s (proof: 113.7 M states in 30.7 s; the search stops when VRAM is full). Solution unchanged (126, best known).

Host memory: ~300–380 MB of resident RAM for the GPU process up to 7 GB of VRAM; at 8 GB, 0.7 to 2.2 GB (Windows moves some buffers to shared memory) — hence the 4 GB default and the recommendation to stay under ~6–7 GB on a 12 GB card.

Tests (`describe.skipIf` without an adapter): equivalence with `solve` (status and length, replayed solution) on the 454 valid levels of the shared sample (partial expansion, Δ = 1) and on 120 of them with full expansion and Δ = 8; host-driven slices on pc-05; `upperBound` (= optimum → unsolvable, optimum + 1 → same length) on 150 levels; pc-01..03, pc-05/06/10 → 17/151/401/52/176/325; lower bound ≤ optimum when stopped by states, memory and time; synchronous engine; GPU lane of `solve` and `improve` in parallel. Always: kernel emulation on the CPU compared with the compact model's successors (> 5000 states), buffer plan, safeguards (inconsistent solution, failure, level too large, VRAM), simulated fallback (`PUZZLECAVE_GPU=none`: single message in `auto`, error in `on`), machine lock.

Limits: 32 × 32 cells; lower bound = distance to the exit only (the CPU adds the "distinct doors" bound, hence many more GPU states on pc-05: 30 k versus 2 k, with no effect on duration); the search stops when VRAM is full without CPU relay; the fixed cost per micro-iteration dominates on small frontiers. No unsolved level becomes solved: the bounds progress by +6 to +14 moves, still far from the known solutions (pc-04: ≥ 86 versus 502).

## Event planner study, step A — static analysis and dead states (2026-10-10)

`packages/core/src/deadlock.ts` (`DeadlockAnalysis`), options `deadPruning` of `solve` and `findSolution`, `keyDominance` of `findSolution`. Everything is an over-approximation, so a live state is never declared dead.

- **Static**: relaxed reach of a block from each cell (push if the target is floor or water and the player cell is neither a wall nor an exit; other blocks, keys and doors ignored; unfilled water crossed as if filled), hence which cells can fill each water; immovable cells (no push possible: they are walls for good); exit entrances with the waters and doors on every route from the start.
- **Dead test** on the loaded state: relaxed route to an exit (immovable blocks are walls); 0-1 search over (cell, doors crossed ≤ pocket + remaining keys, key debt included, up to 4 layers) minimising the waters entered; bipartite matching blocks → unfilled waters: the waters on every route (single-cell cuts) must all get a block of their own and the matching must have ≥ wmin edges. Fast path: if the waters of the cheapest route are all matched, alive without the cut tests.
- **Key dominance** (from the key-closure POC): `findSolution` skips a state if the same state with one key taken off the board and one more key in pocket (same player cell) is already known. Completeness is kept, optimality is not.
- **Soundness**: exhaustive macro-state graphs of 2,453 random levels (57,273 states, backward "can still win" fixed point): no winnable state declared dead, 72 % of the losing states detected. `solve` with pruning: same status and optimal length on 754 random levels; `findSolution` with pruning and dominance: same status, solutions replay.

Measurements (one process, ≤ 1.5–1.8 GB):

| level | search | without | with dead test | with key dominance |
|---|---|---|---|---|
| pc-11 | `solve` 60 s | ≥ 92, 19.0 M states, 21.6 s (memory) | ≥ 90, 12.2 M states, 60 s (time); 0 dead | — |
| pc-11 | `findSolution` 120 s | failed, 16.7 M states | failed, 7.7 M states; 0 dead | failed, 12.4 M states; 10,032 skipped |
| pc-06 | `solve` | 176, 459 k states, 0.5 s | 176, same states, 0.7 s | — |
| pc-03 | `solve` | 401, 1.20 M states, 5.4 s | 401, same states, 13.3 s | — |
| pc-06 | `findSolution` | 418 moves, 1,599 states | same | 476 moves, 2,583 states |
| pc-12 | `findSolution` | 858 moves, 17,669 states | same, 0.5 s instead of 0.1 s | — |

Finding: on the real levels the dead test never fires within the depths the global searches reach (0 dead states on pc-11, pc-03, pc-06, pc-12) and costs 1.4–2.5× the time per state. The relaxation is too loose for the 36-block grids: crossing unfilled water as if filled lets almost every block reach almost every water (pc-11: 23–27 candidate blocks per water), and the exit of pc-11 is reachable through doors with no water at all, so the binding constraint (keys, behind waters) is not seen. Key dominance prunes little on pc-11 (4 keys). Both options stay off by default; the analysis is reused by the step B planner, on states where blocks are frozen.

Also found: the BFWS guide (`improve/guide.ts`) declares a solvable random level dead (`vrnd-94`, seed 5: `solve` finds 17 moves, `findSolution` fails at once, with or without the new options).

## Event planner study, step B — sub-goal planner (2026-10-11)

`packages/core/src/planner/` and `npm run plan -- <id…> [--timeout s] [--keys auto|explicit] [--improve s] [--apply]`. This automates the method that solved the hard levels by hand.

- **Low level** (`subgoal.ts`, cleaned-up port of the agents' `lib.ts`): Dijkstra over the macro-states of a restricted copy of the state. Every block not listed as free, every door not allowed and every water not allowed becomes a wall. The moves are replayed on the real state, where frozen objects are never touched. A failed search reports the frozen blocks the player could have pushed (“touched”).
- **Events**: take key K (any water may be filled), fill water W (only W allowed, one block), open door D (only if it lies on a route with the fewest doors or has a key behind it: keys are exact), move a block so that the region grows, and reach the exit (all doors allowed). The set of free blocks is found by unfreezing: none, then touched blocks added one at a time, closest to the target first (keys ≤ 3 blocks, exit ≤ 2, fill 1; ≤ 60 searches of ≤ 5,000 states).
- **High level** (`plan.ts`): best-first search over event states. Priority: estimate (waters on the cheapest route to an exit, plus the missing keys each with the waters and doors on the way to it), then novelty over the atoms (region cells, filled waters, consumed keys and doors, pocket keys), then moves. Duplicates are merged on board and player region. States the step A test proves lost are dropped. `keys: auto` takes every key reachable without moving anything after each event (key closure).
- Tests: restriction, sub-goal search, touched blocks, win goal; small levels in both key modes; on the random sample, every plan replays and wins (253 of 254 solvable levels planned).

| level | method | result | time | work | memory |
|---|---|---|---|---|---|
| pc-11 (before, A or not) | `findSolution` 120 s / 400 s at 1.9 GB | failed (16.7 M states, timeout / 25.2 M states, memory, 178 s) | — | — | 1.3–1.7 GB |
| pc-11 | planner, explicit keys | **346 moves**, no hint | 156 s | 1,094 event states, 375 k sub-searches, 17.1 M macro-states | 233 MB |
| pc-11 | planner, automatic keys | 346 moves (same plan) | 217 s | 979 event states, 25.8 M macro-states | 253 MB |
| pc-11, origin/main version (gravel at (6,6), (6,10)) | planner | 346 moves | 121 s | 884 event states | 210 MB |
| pc-11 | `improve` 300 s from the plan | 346 → **310** (windows), lower bound ≥ 98 | 300 s | — | ≤ 1.8 GB |
| pc-11 | same with the spare-keys pass (cherry-picked 1963c4e) | 346 → 310, pass removes 0 pickups | 300 s | — | ≤ 1.8 GB |
| pc-09 (old id) | planner 300 s | failed (timeout) | 300 s | 1,350 event states, 69 M macro-states | 277 MB |
| pc-15 (old id, keys/doors) | planner 300 s | failed (timeout) | 300 s | 2,285 event states, 189 M macro-states | 473 MB |
| pc-06 | planner 30 s | failed (timeout); `findSolution` solves it in 0.1 s | 30 s | — | — |

Findings:
- pc-11 is solved from scratch without hints, and after `improve` it beats the hand-built 340 → 326 solution: **310 moves**, which also wins on the origin/main version (goldMoves 326). It is not committed to `levels/`, since the level changed on main. On the planner side, the step A test never fires (0 dead states): the useful pruning is structural (frozen blocks, forbidden waters, useful doors only).
- Key closure (`keys: auto`) changes nothing on pc-11: every key there sits behind water or blocks. The spare-keys pass finds nothing either: the planner only takes the keys it needs. A bigger `findSolution` budget does not solve pc-11 within 2 GB: memory stops it at 25 M states.
- Limits: the planner is incomplete. Each event keeps only its first realisation, unfreezes few blocks and has fixed search caps. It also needs a recognisable structure (keys or waters that open the way). It fails within 300 s on pc-09 (old version) and on the keys/doors grids (pc-15, pc-06): many doors and the useful-door rule leave the estimate flat. Use it as a fallback after `findSolution`, not instead of it.
