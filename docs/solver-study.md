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

## Planner limits relaxed, and planner fallback in `improve` (2026-10-11)

`packages/core/src/planner/plan.ts` now reports, per event kind (exit, key, door, fill, move), the attempts, the restricted searches and their macro-states, and which cap stopped an event: `--sub-states` (search full), free blocks (a set at the limit still had pushable blocks), `--tries`. The CLI prints these lines when a plan fails.

**Why each level failed (step B code, measured).**

- **pc-06** (60 s): fill events took 89 % of the macro-states (6.7 M of 7.6 M) for 68 fills out of 4,211 attempts. The exit event never succeeded: 35 of its 156 searches hit the 5,000 cap. Cause: every restricted search could take every key on its way (pc-06 has 25 keys), so the macro-states multiply by the subsets of keys taken; the exit search also allowed all ~30 doors.
- **pc-09** (180 s): the estimate stays at h = 2 for the whole run (one water and one door before exit (0,0)). The real plan has 31 events that do not change h. 9,016 of 9,891 fill attempts stop at the one-block limit; key attempts stop on free blocks (1,428) and tries (662); the exit search is full 1,956 times. Replaying the hand solution (`subgoal --from-solution`) shows events the planner could not express at all: a water filled through a door (fill and door in one event), a door opened only to reach blocks (not "useful"), fills that move 2–4 blocks, and a first event that moves 11 blocks.
- **pc-15** (old Easy1 A, 180 s): all 2,012 exit searches hit the 5,000 cap (~130 doors allowed, plus side keys); the estimate is flat at h = 1 after 7 events; 25,835 door events and 44,913 key attempts in 1,382 expansions (a grid of doors: about 30 children per state). The hand plan has 66 events with an exact key economy.

**What was relaxed or added** (all options of `planSolution`, also flags of `npm run plan`):

- Caps configurable: `maxFree` (key), `fillFree`, `exitFree`, `maxTries`, `exitTries`, `maxSubStates`, and a new `attemptStates` (macro-states of all the searches of one event attempt, 8,000).
- `alternatives` k: a restricted search goes on after its first goal state (goal states are expanded too) and returns up to k goal states with different boards; then the other unfrozen sets of the same size are tried. Each becomes a child event state.
- Progressive widening `widen` (default 1): a state where a cap stopped an event is queued again one level higher; its key is (h, novelty + level, level, moves), so it competes with lower-novelty states instead of waiting for the whole plateau. Level L adds L unfrozen blocks to every limit, multiplies tries and macro-states by 2^L, and from `allDoorsLevel` (1) on opens every door, not only the useful ones.
- Side keys off by default (`sideKeys`): keys other than the event's own are walls in restricted searches. This removed the key-subset blow-up (pc-06 fills: 4.8 M → 15 k macro-states).
- Sound relaxed prechecks (`prechecks`, on): key unreachable with blocks and fillable waters passable; water with no block of the relaxed region able to reach it (`DeadlockAnalysis.canFill`), and the fill search starts from those blocks instead of an empty set; exit skipped behind water, or behind more doors than keys in pocket (without side keys). pc-06: 13.3 s → 5.9 s with the same plan.
- Exit: first only the doors on a route with the fewest doors, then all doors. A fill may open the doors next to its water. Restricted searches use small store chunks (256 nodes instead of 4,096): −25 % time on pc-06.
- Tried and dropped: limiting a key event's waters to those on a route with the fewest waters (pc-11 then failed in 600 s); `alternatives` 2 on pc-11 (same plan, 208 s instead of 162 s); `allDoorsLevel` 0 by default (pc-11: 362 moves in 191 s instead of 346 in 150 s).

**Results** (one process each, run one after another on a machine shared with other jobs; old = planner of commit 62f96bc; new = default options):

| level | old | new | time old → new | memory old → new | work old → new |
|---|---|---|---|---|---|
| pc-11 | 346 moves | 346 moves (same plan) | 171 s → 87 s | 253 → 342 MB | 13.6 M → 6.7 M macro-states |
| pc-06 | 240 moves | 258 moves | 89 s → 2.8 s | 131 → 132 MB | 9.8 M → 0.11 M macro-states |
| pc-06, `--keys auto` | — | 214 moves | 0.8 s | — | 20 k macro-states |
| pc-09 | failed (300 s) | failed (300 s; also 1,800 s with `allDoorsLevel` 0, widen 1 or 3) | — | 278 → 411 MB (700 MB at 1,800 s) | 1,108 → 5,766 event states |
| pc-15 | failed (300 s) | failed (300 s; 1,200 s with widen 1) | — | 476 → 868 MB (1.1 GB at 1,200 s) | 152 M → 1 M macro-states, 1,981 → 6,220 event states |

pc-09 from intermediate states of the hand solution (`start` option, 120 s, `allDoorsLevel` 0): before fills could open a door and widened states every door, it solved only the last event (from event 30; from 28 it exhausted); new code solves from event 15 on (596 moves total after event 16, 582 after event 15, 97 s), not from event 12 (the next events need a 4-block fill). From the start, the estimate stays flat. pc-15 no longer hits any cap (0 full searches, 0 tries-capped): what is missing is guidance (flat estimate over a door grid), not limits. The random sample is unchanged (253 of 254 solvable levels planned, with each option).

**Fallback in `improve`.** When there is no saved solution and `findSolution` fails, `improveLevel` runs the planner (`planFallback`, on by default) with `planShare` (30 %) of the duration after the search's 30 %; the later stages then share the time left. It costs nothing when the search succeeds or a designer solution exists (the planner is not called; tested). On a small level, a search stopped by `maxStates` 3 is followed by a winning plan. pc-11 from scratch, `improve` 1,200 s, 2 GB per search: search failed (memory limit, 25.2 M states, 321 s) → plan 346 moves (116 s) → windows 310 → frozen blocks and proof (lower bound ≥ 104), peak RSS 2.0 GB. That is the saved length (310), now reached without any hint.

## Long run: external-memory exact search (2026-10-11)

`npm run longrun -- <id>` (`packages/tools/src/longrun/`): one level, the whole machine (worker threads, RAM, disk, optionally the GPU), to prove the saved solution optimal or find a shorter one where the in-RAM search runs out of memory. CLI in `DEVELOPMENT.md`.

### Design

- **Order: uniform cost by layers of g** (moves), bounded by U = length of the saved solution (only solutions of fewer than U moves; U is re-read from `levels/solutions/<id>.txt` and the `--watch` files before every layer, and only goes down). A layer is processed once all smaller layers are done (every interaction costs ≥ 1 move), so each state is expanded at its optimal cost and a goal found at cost c is optimal once all layers below c are done. Pruning: weak bound (relaxed distance to the exit) when a successor is generated, strong bound (distinct doors) when it is expanded; f ≥ U (or ≥ the best goal) is dropped. To *prove* U optimal, this expands exactly the states with g* + h < U, the same set as A*: the order costs nothing for a proof. Its weakness is the lower bound reported when stopped early: the minimum over pending records of g + toExit, about the current layer + 3 on the block levels (A* by f would report more). Proof of the bound at the top of `search.ts`.
- **Record**: the compact engine's packed key (CompactModel, 9–13 words) + parent (layer, partition, index in the partition's run file) + edge, 12 more bytes: **52 bytes on pc-12** (10 words).
- **Partitioning and duplicate detection**: 256 partitions by key hash (`--partitions`). A job = (layer G, partition p): load the bucket (all segments emitted for it), remove the duplicates inside it (typed hash table), then remove the states already expanded at a smaller cost by streaming the partition's run file once against that table (**delayed duplicate detection**: one sequential read of the partition's closed set per layer), compute the strong bound, append the survivors to the run file and expand them. Successors are buffered per (target layer, target partition) in 16 KB chunks and appended to the worker's gen file of the layer; a small per-thread cache of recent successors drops 1–10 % of the duplicates before they reach the disk. A bucket larger than the thread's memory is processed in several passes (hash slices).
- **Disk**: run files (one per partition, append-only, kept for duplicate detection and path rebuilding) and gen files (per layer and worker, deleted once all their target layers are done). Gen chunks are packed (each word XOR the same word of the previous record, then only the non-zero bytes with a 4-bit mask per word: ~2× smaller, ~5 ns per byte); run files stay raw by default (`--compress all` packs them too, but they are then unpacked again at every layer). zstd (node:zlib, level 1) was tried first: 2.6× smaller, but each call sets up and frees a context (~70 µs) and these allocations serialize the threads (65 % of the worker time on pc-11, whose 16–64 KB chunks are written by the hundred thousand per layer). Successor chunks grow on demand (16 records, doubled up to 64 KB): a fixed 16 KB chunk per (layer, partition) filled the buffer cap with near-empty chunks, whose flush wrote millions of 3-record segments and overflowed the coordinator's heap on pc-11. `--max-disk` is enforced on every write (shared atomic counter): the run stops cleanly at the last checkpoint.
- **Checkpoint per layer**: `manifest.json` (next layer, best goal, run file sizes and block lists, live gen files, statistics), written atomically after each layer; `--resume` truncates the run files and drops the gen files of the interrupted layer. Ctrl+C, `--timeout` and the disk limit all stop the same way. The path is rebuilt by following the parent references through the run files, the walks are recomputed by BFS (as in `solve`), and the solution is replayed before anything is written.
- **CPU parallelism**: the jobs of a layer run on `--threads` worker threads (default: half the logical cores); the coordinator only plans the jobs, merges the segment indexes and writes the checkpoint.
- **GPU** (`--gpu auto|on|off`, auto by default): one GPU thread owns the card; each CPU worker sends it batches of 16,384 states of the layer (shared buffers, synchronous wait, one readback per batch); the card runs the walk BFS and the interactions (the engine's `expand` kernel without the store: `packages/gpu/src/batch.ts`, one 32-thread subgroup per state) and returns the successors with f < bound. Deduplication, bounds, disk and checkpoints stay on the CPU. Checked equal to `CompactModel.expand` successor by successor (0 differences on 2,000 pc-12 states) and by the long-run tests on the sample.

### Measurements

Ryzen 7 3700X (8 cores / 16 threads), 32 GB, RTX 4070, NVMe SSD. Other agents kept the CPU at 50–100 % during every run: durations are pessimistic and noisy.

**pc-12 (Bomberman 2 A), saved 126, proven ≥ 100 before**: `npm run longrun -- pc-12 --threads 8 --max-memory 6000` finds a **122-move solution, proven optimal** (`.oneshot/pc-12-optimal-122.txt`, replayed: wins; not applied to `levels/`). 116 non-empty layers, 662 M states expanded, 1.19 G successors written.

| run | duration | disk peak | states/s |
|---|---|---|---|
| uncompressed (first version) | 1,200 s | 89.9 GB | 550 k |
| zstd on all blocks | 2,153 s | 34.8 GB | 310 k |
| zstd on gen blocks + `--gpu on` (first GPU version) | 1,349 s | 55.5 GB | 490 k |

Per layer (uncompressed run): the layers grow ×1.16 per move (×1.35 every two moves, odd and even layers alternate) until layer ~113, then the bound U cuts them; pending records peak at 375 M (layer 110).

| layer | states expanded | records loaded | duration | total states | disk | pending records | lower bound |
|---|---|---|---|---|---|---|---|
| 90 | 2.0 M | 3.2 M | 6.9 s | 18.8 M | 6.4 GB | 82 M | ≥ 94 |
| 100 | 8.5 M | 14.4 M | 18.2 s | 82 M | 22.5 GB | 249 M | ≥ 104 |
| 105 | 24.7 M | 42.6 M | 43.2 s | 166 M | 38.8 GB | 357 M | ≥ 108 |
| 110 | 26.4 M | 48.8 M | 47.9 s | 302 M | 58.2 GB | 375 M | ≥ 114 |
| 113 | 45.6 M | 82.4 M | 68.3 s | 421 M | 70.8 GB | 301 M | ≥ 116 |
| 115 | 49.5 M | 89.7 M | 73.9 s | 502 M | 78.1 GB | 223 M | ≥ 118 |
| 117 | 49.1 M | 89.4 M | 74.2 s | 587 M | 84.9 GB | 123 M | ≥ 120 |
| 120 | 15.7 M | 34.9 M | 35.0 s | 662 M | 88.8 GB | 5 M | ≥ 122 = solution |

About 1.8 records loaded per expanded state (on large layers ~15 % are duplicates inside the bucket and ~35 % of the distinct ones were already expanded); disk at the peak ~135 bytes per expanded state uncompressed, ~53 with zstd on all blocks, ~84 with zstd on the gen blocks. Thread time per expanded state on large layers: loading ~1.6 µs, duplicate detection against the runs 2–3 µs (grows with the closed set), expansion and emission ~7 µs.

Validation: pc-19 → no solution under 88 (the saved 88 is proven optimal; `--bound 89` finds 88), pc-03 → no solution under 401 (1.19 M states, as `solve`), pc-12 three times (122, 662 M states). Tests: same status and optimal length as `solve` on 120 sample levels, `upperBound` = optimum → exhausted and optimum + 1 → same length on 100 more, resume after an interruption and after a disk stop, disk limit, bound lowered between layers, worker threads, GPU path (when an adapter is present).

**GPU versus CPU**: the batch kernel alone expands **4.2–4.5 M pc-12 states/s** (readback included), versus 0.22–0.26 M/s for `CompactModel.expand` on one contended core (5 µs per state; strong bound 0.13 µs, load 0.2 µs). 8 concurrent lanes reach 6.4 M states/s on the card. In the long run (final version: one readback per request sized for the expected output, passes under 2,048 states on the CPU, request latency being a few ms) it divides the expansion thread time by ~3.5 on large layers (pc-12 `--bound 104`, layer 95: 4.7 versus 16.7 thread-s, 1.8 versus 3.3 s), and the whole `--bound 104` run takes **47 s versus 60 s** on the CPU (38.9 M states). The gain stays well below the kernel's speed: once the BFS runs on the card, the CPU side (bucket loading and hashing, duplicate detection against the runs, successor hashing, cache and emission, compression, I/O) dominates. Going further would mean moving the deduplication to the card as well; not done, since the closed sets live on disk and are streamed, and the CPU hash tables already run at memory speed.

**Admissible pruning, measured** (pc-12 `--bound 104`, 38.9 M states): the dead-state test (`--dead-pruning`, `deadlock.ts`) declares **0** states dead and makes the run 4× slower (337 s versus 85 s); the strong bound on generated successors (`--gen-strong 40`) cuts **0** successors on pc-12 (its strong bound equals the exit distance there) and 0 on the first 24 layers of pc-17. Both stay off.

**Projected reach on the other hard levels** (10- and 5-minute profiles, `--gpu on`):

- **pc-17** (keys/doors, saved 106, proven ≥ 42): the layers grow **×4 every two moves** (20 successors per state): layer 24 has 20.8 M states and writes 406 M successors (17.7 GB of disk after 600 s, 33.6 M states). Reaching g ≈ 105 would need ~4^40 times more: out of reach. Even the reported bound (≥ 36 at layer 24) stays below the in-RAM A* bound (≥ 42) because of the g order.
- **pc-16** (keys/doors, saved 126, proven ≥ 46): ×2.5 every two moves, 25.9 M states at layer 29 after 300 s (bound ≥ 38). Out of reach as well.
- **36-block family** (pc-11 310, pc-13 450, pc-14 582, proven ≥ 100): same growth as pc-12 (×1.16 per move), but without the cut of a close bound. An hour reaches g ≈ 115–120 (bound ≥ ~120, and any solution of up to ~120 moves would be found); each further move costs ×1.16 in states and disk. A 310-move solution cannot be proven this way.
- pc-04, pc-07, pc-08, pc-09, pc-18: gaps of 260–1,460 moves between the solution and the bound: no proof possible with this method; only the lower bound can rise.

Conclusion: the external search closed pc-12 (126 → **122, proven optimal**) in 20–35 minutes. On the keys/doors levels the state space grows too fast for any exact method of this kind; on the remaining block levels it can only raise the proven bounds to ~120–125, unless their optimum turns out to be far shorter than the saved solutions.
## Other starting points — `explore` (2026-10-11)

`packages/core/src/planner/explore.ts`, `npm run explore` (DEVELOPMENT.md). `improve` keeps the order of a solution's events; `explore` changes it. The saved solution is cut into its events (key, water, door, exit; blocks named by identity), variants of that plan are rebuilt by the exact per-stage restricted searches of `subgoal` (swap, move, reverse, exchange blocks of stages; merge or split adjacent stages; drop `player`/`at` pins; add or remove an extra fill of an unused water with a never-pushed nearby block), and a local search ranks them by length. The 3 shortest distinct variants then get improve's windows and spare keys (no proof). Rounds repeat from the best solution.

Run 1: 15 min per level, seed 1, saved solution as start, 3 processes in parallel (≤ 1.5 GB each) while other agents used the machine. Run 2: 30 min per level from the run 1 results (`--from`), with the fix below. Run 3: seed 2 from run 2's results (pc-18, pc-09, pc-04). Run 4: pc-18, seed 2 from run 1's 1414.

| level | saved | plan rebuilt as is | best variant, round 1 (before improve) | after improve, round 1 | run 1 (15 min) | runs 2–3 (30 min each) |
|---|---|---|---|---|---|---|
| pc-04 | 430 | 430 | **318** | 296 | 296 (2 rounds) | **278** |
| pc-07 | 392 | 392 | 392 | 392 | 392 | 392 |
| pc-08 | 619 | 619 | 611 | 611 | 611 | **601** |
| pc-09 | 574 | 574 | 544 | 538 | 538 | **490** |
| pc-11 | 310 | 310 | 310 | **296** | 296 | 296 |
| pc-12 | 126 | 126 | 126 | 126 | 126 | 126 |
| pc-13 | 450 | 450 | 436 | **430** | 430 | 430 |
| pc-14 | 582 | 582 | 562 | 562 | 562 | **556** |
| pc-16 | 126 | 126 | **122** | 122 | 122 | 122 |
| pc-17 | 106 | 106 | 106 | 104 | **92** (round 2: 100 → 92) | 92 |
| pc-18 | 1554 | 1554 | 1422 | 1414 | 1414 | **1346** (run 4) |

Work: 2,000 (pc-18) to 4.5 M (pc-16) variants per 15 min; about a quarter feasible; the memo answers most stage searches (pc-11: 2.1 M variants, 23 k searches). Memory stays under ~1.5 GB per process (window searches of the improve phase).

Findings:
- The rebuilt plan alone never gains (the saved solutions are already improved): the gains come from other orders. Reordered and merged stages, then improve: −152 moves on pc-04 (430 → 278, −35 %), −84 on pc-09, −208 on pc-18, −14 on pc-17, −26 on pc-14, −20 on pc-13, −18 on pc-08, −14 on pc-11, −4 on pc-16. pc-07 and pc-12 do not move.
- Merging is the strongest mutation: a merged stage is one exact search that reaches several goals in the best order (pc-16's 122 comes from a 32-event merged stage of keys and doors with ≤ 4 blocks; the restricted search stays small since the other blocks are walls). Extra water fills appear in pc-11's 296 (30 events instead of 28).
- Screening often finds the gain without improve (pc-04 318, pc-16 122, pc-14 562, pc-08 611); improve adds 0–22 moves on top. Each round restarts from the new best, whose own plan opens new reorderings (pc-17: 106 → 104 → 92; pc-09: 574 → 538 → 490).
- Fix found by run 1: a later round spent all the remaining time screening, and a shorter screened variant was lost when no time was left to improve it (pc-18 1348, pc-09 504, pc-04 294 were screened but not kept). Now a shorter screened variant is kept as it is and later rounds keep the same share of the remaining time for improve. Results also depend on the seed and the starting solution (pc-18 from 1414: 1392 with seed 1, 1346 with seed 2; from 1392: no gain with seed 2): long runs benefit from several seeds and starts.
- Limits: local search only (no proof that an order is the best); stage searches cost ~0.2 s on pc-18 (2 blocks, large free area), so it screens only ~5 variants/s there; the 3 improved variants of a round are often near-identical.

Shorter solutions (files `.oneshot/<id>-<length>.txt`, all replayed and winning, not applied here): pc-04 278, pc-08 601, pc-09 490, pc-11 296, pc-13 430, pc-14 556, pc-16 122, pc-17 92, pc-18 1346.

## findSolution budget and key closure (2026-10-12)

Measured with `packages/tools/src/findBench.ts` (findSolution alone, from scratch: saved solutions ignored), Ryzen 7 3700X. The search is deterministic, so a run at a large budget also gives the result at every smaller one (the progress lines record the time and states when the memory peak crosses 1/2/4 GB). Budgets: 1 GB (5 processes at a time), 2.9 GB (2 at a time), 5.5 GB (one process; the RAM allowed to these measurements was ~6 GB, hence no 8 GB run). "mem" = memory cap reached; states in millions; kc = `keyClosure` (times marked * were measured before the closure filter below, which keeps the same states but is 1.7–2.5× faster).

| level | saved | 1 GB | 2.9 GB | 5.5 GB | kc 1 GB | kc 2.9 GB | kc 5.5 GB |
|---|---|---|---|---|---|---|---|
| pc-07 | 388 | mem 15.1 M, 300 s | mem 43.8 M, 784 s | mem 81.4 M, 1356 s | mem 15.1 M, 573 s* | mem 43.8 M, 627 s | — |
| pc-08 | 581 | mem 15.1 M, 315 s | mem 39.7 M, 722 s | mem 81.4 M, 1368 s | mem 15.1 M, 396 s* | mem 40.0 M, 1003 s* | mem 81.4 M, 1151 s |
| pc-09 | 490 | mem 14.8 M, 244 s | mem 38.1 M, 597 s | mem 75.0 M, 799 s | mem 14.8 M, 510 s* | mem 37.9 M, 1122 s* | mem 72.7 M, 738 s |
| pc-11 | 296 | mem 15.1 M, 239 s | mem 43.8 M, 541 s | mem 81.5 M, 738 s | mem 15.1 M, 781 s* | mem 43.8 M, 413 s | — |
| pc-13 | 430 | mem 15.1 M, 361 s | **2390 moves**, 543 s (peak 2.25 GB) | — | **3612 moves**, 15 s (77 MB) | — | — |
| pc-14 | 554 | mem 15.5 M, 410 s | mem 47.5 M, 1138 s | mem 88.4 M, 1193 s | mem 15.5 M, 894 s* | mem 47.5 M, 728 s | — |
| pc-16 | 122 | **206 moves**, 31 s (136 MB) | — | — | mem 15.1 M, 567 s* | **282 moves**, 443 s (peak 2.88 GB) | — |
| pc-17 | 92 | **786 moves**, 54 s (165 MB) | — | — | **604 moves**, 53 s (322 MB) | — | — |
| pc-18 | 1338 | mem 15.1 M, 536 s | time (1200 s, 40.9 M) | mem 81.4 M, 1278 s | time (900 s*, 13.3 M) | mem 43.8 M, 768 s | — |

Solved levels out of 9: without key closure 2 at 1 GB (300 or 900 s), 3 at 2.9 GB within 900 s (pc-13, 543 s), still 3 at 4 and 5.5 GB; with key closure 2 at 1 GB (pc-13, pc-17, both under 300 s), 3 at 2.9 GB within 900 s (pc-16). No found solution is shorter than the saved ones (pc-16 206/282 versus 122, pc-17 604/786 versus 92, pc-13 2390/3612 versus 430).

What limits findSolution:
- **Memory, linearly.** Every level that does not solve within ~2.5 GB hits the memory cap, not the time limit: ~60–80 k stored states per second, 65–76 bytes per stored state (pc-11 at 5.5 GB: 81.5 M states, 71 B/state). Going from 1 to 5.5 GB (×5.4 states) solves no extra level: raising the budget is not a cheap win beyond ~3 GB.
- **Bytes per state**: the node (packed key 4 × words, i.e. 36–52 B, plus parent 4, cost/edge/bound 6 and a flag 1 B) is ~70% of it; the hash table 8 B per slot (9–21 B per state); the heap 8 B per open entry plus its growth slack. The BFWS novelty tables are negligible (1–4 MB in total, 18–68 tables).
- **Generated, never expanded states**: 52–85% of the stored states are still open when the search stops (pc-08 at 5.5 GB: 14.4 M expanded out of 81.4 M stored). They must be stored for duplicate detection; compressing them would need a different state store (keys rebuilt from the parent), not a cheap change.
- **Doubling transients** (fixed): the table doubling needs the old and the new table at once, and the heap doubling the old and the new arrays, so the search used to stop with up to ~25% of its budget unused (pc-11 at 1 GB: stopped at 12,582,912 = 0.75 · 2^24 states with a peak of 805 MB). The table now keeps filling up to 90% load when the budget refuses the doubling, and the heap tries growths of ×1.5, ×1.25, ×1.125: pc-11 at 1 GB **12.6 M → 15.1 M states** (97 → 122 s). This also applies to `solve` and the windows (same store).

Key closure (`keyClosure`, ported from the proof of concept on branch `worktree-agent-ad38ca13791f276d0`): after each interaction, the player picks up every key reachable by walking (nearest first; a key on an exit is left, and a player standing on water — allowed start, pc-13 and pc-14 — is left alone, since the closure would strand them). Complete, not optimal. The first version ran a full walking BFS on every successor (2–3.3× slower per state than the plain search); since every stored state is already closed, only the cells the interaction opens outside the parent's walking region can expose a key, and a small flood from the interaction cell now decides whether the full closure is needed (same states and solutions, tested): at 400 MB, pc-11 165.6 → 66.0 s, pc-09 101.8 → 59.7 s (plain: 47.1, 52.5 s).

Verdict: optional mode only, off by default (`improve --key-closure`). It solves pc-13 in 15 s where the plain search needs 2.25 GB and 543 s, and finds a shorter first solution on pc-17 (604 versus 786), but needs 2.9 GB on pc-16 where the plain search takes 136 MB, and changes nothing on the memory-bound levels (same states per second within ~30%, same cap). Worth a second try when the plain search fails.

## Long run: dominance pruning and a lower target bound (2026-10-13)

`npm run longrun -- <id> --dominance off|player|keys` (`keys` by default; code and soundness proof at the top of `packages/tools/src/longrun/expander.ts`).

**Rule.** The core of a state is its blocks, filled waters and closed doors. A state A expanded at an earlier layer gA dominates a bucket state B of layer G with the same core when A's ground keys are a subset of B's, A's keys in hand ≥ min(B's keys + the keys B still has on the ground and A not, remaining doors), and gA + d ≤ G, d being the shortest pure walk (no interaction) from A's player to B's player in A's board. B is dropped. `player` only allows A and B with the same keys on the ground and in hand. Every move sequence of B can be replayed from A after the walk, at no greater cost (B's pickups of keys A already holds become walks, doors open for A whenever they open for B); the search stays exact, and the proven lower bound stands (covering argument in the code). The user's variant, where A's walk to B's position collects keys on the way, needs no extra test: the first key picked up on that walk is a successor of A of a layer < G, processed before B, and it (or what dominates it, by transitivity) dominates B with a pure walk.

**Implementation.** Partitions (and passes) are by the hash of the core, so A and B are in the same job. While the run file of the partition is streamed, a closed record whose core matches a live bucket state becomes a candidate (its key and layer are kept); per core and per distinct board of the candidates, one multi-source BFS (each source starting at its layer, cut at G, stopped once every target cell is reached; skipped when the Manhattan distance already rules all targets out) marks the targets it reaches in time. The run block index records each block's layer; manifest version 5 (older checkpoints are refused). Within a layer no state can dominate another (d ≥ 1, or a duplicate), and later layers never dominate earlier ones.

**Measurements** (pc-12 with `--bound`, CPU only; a level generator of another agent kept 12 processes at 100 % during the 110 and 116 runs, so their times are only indicative; "thread-s" = load + closed + expand thread time summed over the layers):

| run | dominance | states expanded | disk peak | time | thread-s |
|---|---|---|---|---|---|
| pc-12 `--bound 104`, 8 threads | off | 38.93 M | 3.28 GB | 129 s | 294 |
| | player | 36.53 M (−6.2 %) | 3.07 GB | 131 s | 314 |
| | keys | 36.53 M (−6.2 %) | 3.07 GB | 133 s | 318 |
| pc-12 `--bound 110`, 4 threads | off | 91.29 M | 7.63 GB | 452 s | 1,032 |
| | keys | 84.81 M (−7.1 %) | 7.07 GB | 475 s | 1,127 |
| pc-12 `--bound 116`, 4 threads | off | 202.2 M | 17.23 GB | 910 s | 2,595 |
| | keys (before the Manhattan filter and early stop) | 185.5 M (−8.2 %) | 15.75 GB | 1,670 s | 3,997 |
| pc-19 (88, proven again) | off / keys | 2,220 / 1,341 (−40 %) | | | |
| pc-03 (401, proven again) | off / player / keys | 1.193 M / 0.741 M / 0.702 M (−41 %) | 0.10 / 0.06 / 0.07 GB | 588 / 727 (4 threads) / 340 s | |

The gain grows with the depth (the dominated fraction compounds: on pc-11 the layer sizes fall to 0.92–0.85 of the run without dominance by layer 100 and 0.78 by layer 124) and with the keys (pc-03, pc-19: −40 %). Its cost is in the closed phase: every closed record of a live core is a candidate (about 1.4 per distinct bucket state on pc-11, 103 M candidates and 21 M BFS at layer 124), about 200 thread-s per layer there, comparable to the GPU expansion. On pc-12 the time is a wash; on pc-11 the states and disk saved pay for it. Sample tests: same optimal lengths as `solve` with `player` and `keys`, exhaustion at the optimum, dominance prunes on the sample (`longrun.test.ts`).

**Lower target bound.** On pc-11 the pending records span ~40 layers ahead (the macro-moves include long walks): at layer 130 of the 2026-10-11 run, 7.25 G pending records (181 GB) against 1.15 G expanded states (60 GB of run files). With `--bound 150` (instead of the saved 296) every successor with g + toExit ≥ 150 is dropped at generation: −58 % of the emitted successors at layer 119 (3.8 per expanded state instead of 8.2), and the run either proves "no solution under 150" or stops with the same lower bound as the unbounded run (min pending f), on much less disk. `--watch` files still lower such a bound.

**pc-11 run** (`--bound 150 --threads 10 --gpu auto --max-disk 385`, dominance `keys`, started 2026-10-13 07:59 UTC, work dir `.oneshot/longrun/pc-11-dominance` of the main checkout): at layer 124, 562 M states (old run 651 M, −14 %), 86 GB on disk (old run 160 GB), 1.47 G pending (old run 4.15 G), lower bound ≥ 128. It stopped once at layer 124 on EMFILE (8,192 descriptors per process on Windows: 10 threads × (256 run files + one gen file per live layer)); the threads now cap their open descriptors (`maxOpenFiles`, 6,000 shared) and the run resumed from its checkpoint. Layer 130: 980 M states (old run 1.15 G), 130 GB (old run 284 GB), ≥ 134 as before; from layer ~134 the pending records shrink (the bound cuts them) and the layers end at 146. **Result: exhausted, no solution of fewer than 150 moves** (pc-11 ≥ 150, was ≥ 134): 2.12 G states expanded, 4.64 G successors written, disk peak 209 GB, 9,284 s (2 h 35 min, with another agent's 12 processes on the CPU). Per layer from 131 on: 3–4 min. A second run with `--bound 156 --compress all` was started next (`.oneshot/longrun/pc-11-b156`). Provenance: layers 0–123 of this first run ran an earlier, uncommitted version of the dominance code (only layers 124–146 ran the committed one); its per-layer counts match the committed run within 0.01 % and it never expanded fewer states, but the "≥ 150" claim is only recorded in the level once the `pc-11-b156` run, entirely on the committed code, passes 150. **That run finished on 2026-10-13: exhausted, no solution of fewer than 156 moves** (153 layers, peak 259 GB with `--compress all`); pc-11's header now reads ≥ 156.

**Heuristic, measured along pc-11's saved 296-move solution:** toExit and the strong bound never exceed 16 while 286 to 150 moves remain (e.g. 6 at move 10 with 286 left, 16 at move 82 with 214 left); counting unfilled waters, doors or blocks on the best relaxed path to the exit gives 0–1 at the start. No cheap admissible heuristic closes this gap, so none was added; a new one plugs in where `CompactBound.strong()` is called (expansion, and `--gen-strong` on successors).

## Stronger admissible bounds and checkpoint certification (2026-10-13)

`packages/core/src/strongBound.ts` (`StrongBound`), `npm run certify` (`packages/tools/src/longrun/certify.ts`). Goal: raise proven bounds without new search, by evaluating a much stronger (admissible, not consistent) bound on the pending records of a long-run checkpoint. Soundness arguments are in the source comments; every bound is checked against exact costs on every reachable state of ~2,500 exhaustively solved small random levels (`strongBound.test.ts`, incl. levels built with water chains, keys and doors), and certify against `solve` on partial long runs.

**Bounds** (all admissible, combined by max in `value()`):
- *Key term* (in `CompactBound.strong`, consistent, used by the A\* too): `(need−1)·δ` replaced by the sum of the `need−1` smallest "nearest other key" distances (each key picked after the first ends its own walk from another key). Rarely binding on the saved levels.
- *Timed relaxation* (`tdr`): earliest-arrival Dijkstra over (cell, picked keys ⊆ ≤ 4 tracked keys, doors opened), where clones act in parallel but only profit from clones of an earlier-or-equal key/door layer; a water is enterable once a fill is known, a fill needs the pusher cell and a block on the cell before the water; blocks are tracked one by one (time each block can reach each cell, pushed only from cells some clone reached; a block crosses a water only after another block filled it); fill times are floored by fill chains (a water whose push cell or block cell is water needs that one filled first by a distinct block: the push counts add up). Each refinement was kept only if sound; the measured gain at the pc-11 frontier (layer 131, sample): exit distance 3–17 → global clones 15 → per-block tracking 29 (min over the sample).
- *Mandatory fills* (`fill`, h_fill): a water is mandatory if the timed relaxation cannot win with it forbidden (this includes waters guarding the keys the doors need); bound = walk to the first push spot + min-cost matching of distinct blocks to mandatory waters (Hungarian, relaxed push distance) + walk from the last fill to the exit. Slow (one relaxation per candidate water): measurements only.
- *Fable's h_fetch* (Dijkstra over filled-water subsets, fetch = walk + push distance of a current block, blocks unlimited) is **not admissible**: a block pushed along the player's way during an earlier segment can later fill a water from close by while the fetch cost charges its original position (example: the player walks a long open corridor to fill w1 with a nearby block, pushing block b ahead for free; w2, reachable only after w1, is then filled by b in a few moves, but the relaxation charges b's original distance). The timed relaxation replaces it (time windows measured from now, not per segment).

**Start states** (proven bounds for reference; one core, other jobs running):

| level | proven | exit dist. | strong | tdr | h_fill | tdr time |
|---|---|---|---|---|---|---|
| pc-04 | 78 | 16 | 16 | 16 | 0 | 0.9 ms |
| pc-07 | 126 | 2 | 2 | 24 | 0 | 1.0 ms |
| pc-08 | 99 | 37 | 45 | 45 | 24 | 0.3 ms |
| pc-09 | 87 | 17 | 17 | 44 | 0 | 2.4 ms |
| pc-11 | 134 | 4 | 4 | 27 | 0 | 1.1 ms |
| pc-12 | 122 (opt.) | 4 | 4 | 24 | 0 | 0.3 ms |
| pc-13 | 100 | 4 | 4 | 22 | 15 | 0.3 ms |
| pc-14 | 100 | 4 | 4 | 24 | 22 | 0.3 ms |
| pc-16 | 46 | 26 | 26 | 34 | 0 | 1.3 ms |
| pc-17 | 42 | 30 | 30 | 33 | 0 | 1.4 ms |
| pc-18 | 93 | 46 | 83 | 50 | 46 | 1.7 ms |

The start values stay far below the proven bounds (those come from searches that already explored ~10⁹ states): the bounds pay off on deep states, where the exit distance says almost nothing. Along the saved solutions the timed relaxation is 2–6× the exit distance on the block levels (pc-11: 27–40 versus 4–20), never above the remaining length. With `limit = best − g` it stops early: 30–150 µs per pc-11 frontier record.

**Certification**: on pc-19 (`--bound 95`, stopped at layer 27) the checkpoint bound 40 becomes 58 (optimum 88); on pc-12 (`--bound 130`, layer 56) 58 → 74 (optimum 122).

**pc-11** (checkpoint of the 284 GB long run, layer 131, 7.25 G pending records, its own bound ≥ 134; read-only): `npm run certify -- <dir> --target 150 --threads 8 --skip-fingerprint` (the level differs only by its old `goldMoves` 310, checked against the manifest fingerprint) read 3.32 G records, evaluated 2.02 G with the strong bound, 5.3 h on 8 threads (machine shared with another long run): no pending record has g + h < 150, so **pc-11 ≥ 150** (was 134). On a 2,000-record sample of layer 131 the smallest g + h is 160, so a higher target would likely certify more, at a cost growing with the number of layers below it (~0.25 G records per layer, 30–150 µs each).

### Proof triage of the unproven levels (2026-10-13)

A 10-minute long run per level (`--threads 10 --gpu auto --compress all`, dominance `keys`) measures the growth of the first layers. Growth of the expanded states over two layers (odd and even layers differ, so pairs are compared), at the last layers reached:

| level | best known | layer reached | lower bound | ×/2 layers | gap to close |
|---|---|---|---|---|---|
| pc-17 | 92 | 25 | 36 | ×4.3 | 56 |
| pc-16 | 122 | 31 | 40 | ×2.5 | 82 |
| pc-18 | 1338 | 41 | 54 | ×2.2 | > 1000 |
| pc-08 | 581 | 72 | 83 | ×1.8 | ~500 |
| pc-09 | 490 | 79 | 87 | ×1.5 | ~400 |
| pc-04 | 278 | 73 | 76 | ×1.5 | ~200 |
| pc-13 | 430 | 105 | **108** | ×1.25 | ~320 |
| pc-14 | 554 | 104 | **108** | ×1.25 | ~450 |
| pc-07 | 388 | 114 | 118 | ×1.22 | ~270 |

The practical ceiling is a few 10⁹ states (pc-11 ≥ 156: 2 G states, 259 GB). Even the slowest growth (×1.1 per layer) over 200+ layers is beyond 10²⁰ states, and the dense levels (pc-17, pc-16) would need ×4 every two layers over 50+ layers: **no proof is reachable** for any of them with this search, so no long run was started. The proven bounds are kept where higher; pc-13 and pc-14 rise from ≥ 100 to ≥ 108.

## explore: structural pass, dropped stages, retried stage caps (2026-10-14)

Ten hand-reasoning runs had just shortened the unproven levels by changes `explore` could not make. `packages/core/src/planner/explore.ts` now covers them (flags in DEVELOPMENT.md):

- **Dropping any stage** (pc-04's useless fill of 3,16): a `drop` mutation removes any stage but the exit (its event is no longer required) and `restore` brings a dropped one back; the structural pass also drops every stage in turn.
- **Long-distance moves** (pc-09's fill moved 17 places, pc-13's chain): `move` goes anywhere 40 % of the time (else up to 8 places as before), `moveChain` moves 2–6 consecutive stages anywhere.
- **Stage caps** (pc-18's 3-block stage above 200,000 macro-states: "plan rebuilt failed"): `--stage-states`, `--stage-states-max`, `--stage-timeout`; the rebuild of the plan as is and the structural pass search a stage stopped by its cap again with 4× the cap and the time, up to 3.2 M macro-states, with its own memory budget (`--large-memory`, 1 GB); random variants never retry. pc-18 now rebuilds its 1296-move plan (10 retried stages).
- **Large merges** (pc-11, pc-09, pc-07, pc-16): a **structural pass** opens each round. From the end of the plan backwards, it drops each stage, merges the stages from there to the exit (door goals optional), and merges every window of 2–6 consecutive stages into one wide search: the blocks the window moves plus the 2 closest blocks it does not move are free, every water may be filled, with the end pinned, free, free with optional doors, free with the neighbours. First improvement wins and the pass starts again from it; when every candidate failed, it widens (windows + 2, neighbours + 4, reach + 2 per level, 5 levels) and the first two levels use ¼ and ½ of the merge limits (2 M macro-states, 60 s).
- **Spare keys after merges**: a shorter pass result goes through improve's windows and spare keys right away.

Tests on small ASCII levels: a useless fill dropped by the pass, a merged window that frees a neighbour block (16 → 10 moves, out of reach of reorders and pins), stage retries, long moves and chains, `drop`/`restore` invariants, deterministic seeds.

Campaign on the 10 unproven levels, `--apply`, 3 then up to 10 processes at once (one thread each, < 1 GB each): run 2 (35 min per level, `--pass 0.6`), then runs 3–5 (40–45 min, `--pass 0.9`, with wider windows and neighbours on some levels: `--merge-window 8–12 --merge-neighbours 6–10`, or fewer and larger searches: `--merge-window 4 --merge-states 6–8 M --merge-timeout 240`).

| level | before | after | explore time | gain |
|---|---|---|---|---|
| pc-04 | 240 | 240 | 125 min | — |
| pc-07 | 382 | 382 | 125 min | — |
| pc-08 | 577 | **575** | 125 min (gain after 21 min) | 5 fills merged (6,6 12,5 5,7 5,8 5,9), ¼ limits |
| pc-09 | 478 | 478 | 125 min | — |
| pc-11 | 286 | 286 | 125 min | — |
| pc-13 | 430 | **426** | 160 min (gain after 21 min) | 4 fills merged with the exit, doors optional |
| pc-14 | 554 | **542** | 200 min (546 after 10 min) | 6 stages merged (5 fills and key 16,16) → 546; 9 stages (with door 4,6) → 544; 12 fills → 542 |
| pc-16 | 118 | 118 | 80 min | — |
| pc-17 | 86 | 86 | 80 min | — |
| pc-18 | 1296 | 1296 | 126 min | — (plan now rebuilt) |

Findings:
- Every gain came from wide merges of fills (5 to 12 stages, all waters allowed); none from drops or long moves, whose cases were already fixed by hand in the saved solutions. improve's windows and spare keys never shortened a pass result further.
- The pass is cheap on small levels (pc-16: 5,437 candidates, every level up to 10 widenings, in 8 min; pc-17: 6,242 in 40 min) and found nothing there: their remaining gaps need another strategy, not a local merge.
- On large levels a wide search costs 15–60 s: in 40 min the pass does not finish its first level on pc-18 (977 candidates), pc-09 (1,473), pc-08 (1,078). The quick sweeps at ¼ and ½ of the limits found all three pc-08/pc-14 gains; full limits found pc-13's.
- The screening of reordered variants no longer finds anything on these levels (its best variants equal the saved solution): the time is better spent in the pass (`--pass 0.6–0.9`).

## explore: structural pass on worker threads (2026-10-15)

On large levels a wide search costs 15–60 s and the pass did not finish its first widening level in 40 min; running more explore processes did not help (each one starts the same sequence). The candidates of the pass are independent rebuilds of plans of the same solution, so `--workers N` now hands them to a pool of worker threads (`packages/tools/src/explorePool.ts`, flags in DEVELOPMENT.md):

- **Pool**: N threads (default: cores − 2, at most 16), each with its own Rebuilder and memo of the current solution's stages (the prefix of the plan, shared by every candidate, is rebuilt once per thread: ~90 s on pc-18, seconds elsewhere). The screening and improve stay in the main thread. `--workers 1` keeps the old in-thread pass.
- **Determinism rule**: candidates start in the sequential order and their results are committed in that order; the gain kept is the one with the lowest candidate index, i.e. the sequential pass's choice whatever N. A gain cancels the candidates after it (a shared flag stops their searches within moments, nothing of them is memoised or counted as tried); the candidates before it still finish and win if they improve too. Only committed candidates join the `tried` set, so later rounds see the same set as with one thread. Search time limits remain the only source of differences (a thread slowed down by the others may stop a search that would have finished). Tests: identical gains, moves and tried sets with 1 and 4 threads (a merged neighbour block; pc-03 with detours, several gains), and with a fake runner returning results out of order.
- **Memory**: each worker counts max(`--large-memory`, `--max-memory`) + 512 MB (its V8 heap is capped there), the main thread `--max-memory` + 512 MB; `--total-memory` (default: free memory − 4 GB) lowers N to fit. With 14 workers and 1 GB searches the process stayed around 3.5 GB resident on pc-18 and the machine kept more than 16 GB free with the 8 M-state searches (searches rarely fill their budget).

Throughput, 600 s runs with `--pass 0.9` (pass ≈ 545 s); sequential = old code, 3 processes at once on 16 cores; parallel = 14 threads, one level at a time:

| level | sequential: candidates in the pass | parallel: candidates in the pass | parallel: time to the sequential count | speed-up on the same candidates |
|---|---|---|---|---|
| pc-18 | 350 (level 0) | 1,434 (level 1) | ~160 s (90 s of prefix rebuild) | 3.4× (≈ 7× after the prefix) |
| pc-09 | 733 (level 1 started) | 2,173 (level 2) | ~61 s | ≈ 9× |
| pc-08 | 504 (level 1 started) | 1,666 (level 2) | ~63 s | ≈ 8.6× |

Candidates of the later levels are larger windows at fuller limits, so the per-minute rate falls as the pass goes on in both modes; on the same candidates, the gain is 7–9× on 14 threads (memory bandwidth and the duplicated prefix take the rest). A whole pass (6 widening levels) now ends in 16–39 min: pc-18 4,170 candidates in 39 min, pc-09 2,872 in 17 min, pc-08 2,344 in 18 min, pc-14 (windows up to 12, 6 neighbours) 2,814 in 16 min. The random-mutation screening was not parallelised: it takes 16–60 s of a round, rebuilds hundreds to thousands of variants, and has found nothing on these levels since the pass exists; once the pass is exhausted, the rest of `--timeout` goes to it, so the runs below were stopped (or given `--pass 0.95`) when the pass ended.

Campaign (`--apply`, 14 threads, one level at a time, 2026-10-15): wave 1 with the default limits (pc-14 with `--merge-window 12 --merge-neighbours 6`), wave 2 with 4× the merge limits (`--merge-states 8000000 --merge-timeout 240 --merge-window 8 --merge-neighbours 4 --merge-widen 2`, 30 min per level).

| level | before | after | explore time | result |
|---|---|---|---|---|
| pc-18 | 1296 | 1296 | 53 + 31 min | wave 1: whole pass (4,170 candidates, 6 levels) in 39 min, nothing; wave 2: 1,531 candidates (level 1 of 2), nothing |
| pc-09 | 478 | 478 | 21 + 30 min | wave 1: whole pass (2,872) in 17 min; wave 2: 2,228 (level 2), nothing |
| pc-08 | 575 | 575 | 18 + 30 min | wave 1: whole pass (2,344) in 18 min; wave 2: 1,423 (level 2), nothing |
| pc-14 | 542 | **538** | 16 + 30 min | wave 1 (windows up to 12): whole pass (2,814) in 16 min, nothing; wave 2: 5 fills merged with the exit, doors optional, at the full 8 M / 240 s limits, after 12 min; then the pass of 538 was exhausted |

Findings:
- The pass is no longer the limit on these levels: with the default limits it now goes through all its candidates, and found nothing more on pc-18, pc-09, pc-08 or pc-14. The only gain came from larger searches (8 M macro-states, 240 s), the same kind of merge of fills as the earlier gains: further gains here need larger wide searches rather than more candidates.
- pc-14's gold (610) stays within [ceil(1.1 × 538), floor(1.25 × 538)] = [592, 672].
