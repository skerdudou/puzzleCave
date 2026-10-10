# puzzleCave v1 — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A turn-based puzzle game (blocks, keys, doors, water, gravel, exit) playable with the keyboard in the browser and by touch on Android (PWA), with moves/time/platinum medals, levels edited in Tiled, local save and an author solver.

**Architecture:** npm workspaces monorepo. `core` = pure TypeScript rules engine with no dependency (immutable state, `step`, undo, medals, progress, solver). `tiled` = reading/writing `.tmx`/`.tsx` and loading the `levels/` folder. `game` = Phaser 4 + Vite + PWA, contains no rules. `tools` = `validate` / `solve` CLI.

**Tech Stack:** Node 24, npm 11 workspaces, TypeScript 7 (strict), Phaser 4, Vite 8, vite-plugin-pwa, Vitest 5, Playwright, fast-xml-parser 5, tsx, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-10-puzzlecave-design.md` (read it before any task).

## Global Constraints

- **Repository root (git worktree): `C:/Users/Steven/IdeaProjects/puzzleCave/.claude/worktrees/puzzlecave-v1`** — called `REPO` below. All commands run there; never work directly in `C:/Users/Steven/IdeaProjects/puzzleCave`.
- Node ≥ 24 (installed: 24.20.0), npm workspaces (no pnpm).
- Dependencies are installed with `npm install -D <pkg>@latest` at the time of the task: **never** a version copied from memory. After installing, check `package.json`.
- `packages/core`: **no** runtime dependency.
- TypeScript `strict`, `noUncheckedIndexedAccess`. Identifiers in English; visible texts in fr/en via `i18n`; comments rare, in English.
- Internal imports without extension (`moduleResolution: "bundler"`). Packages expose `src/index.ts` via `"exports"`.
- 16 px tiles. Level id = `.tmx` file name without extension.
- `levels/solutions/` is **never** imported by `packages/game`.
- Keyboard directions read via `KeyboardEvent.code` (arrows + `KeyW/KeyA/KeyS/KeyD`). `U`, `R`, `Escape` via `KeyboardEvent.key`. No `Ctrl+Z`.
- Move animation: `min(100 ms, interval since the previous move)`; a new input immediately finishes the current animation. The logic never waits for the display.
- No level time limit.
- Environment: Windows 11, Git Bash. Paths with `/`.
- Every commit ends with the line:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- "One-shot" scripts (level conversion, image generation, ad-hoc checks) live in `ONESHOT = C:/Users/Steven/.claude/jobs/35ce9751/tmp/oneshot/` and are **not** committed.
- External sources (read-only): `LEGACY = C:/Users/Steven/IdeaProjects/puzzleCave-legacy`.

## Review Focus

1. Window losing focus while a direction is held (Alt+Tab): the repeat must stop (no `keyup` will arrive). → `reset()` test in Task 12.
2. `localStorage` unavailable (private browsing, access exception) or corrupt content: the game still starts, the corrupt save is set aside. → tests in Task 12.
3. Map saved by Tiled with a non-CSV layer encoding (base64/zlib): explicit error message telling which setting to change. → test in Task 7.
4. Tile flipped/rotated in Tiled (flip bits in the gid): the tile must be recognized normally. → test in Task 7.
5. `chapters.json` referencing a deleted or renamed level, or a level absent from every chapter: clear error at build time. → test in Task 6.

---

## File structure

```
package.json, tsconfig.json, vitest.config.ts, .prettierrc.json, README.md, CREDITS.md
levels/
  tileset.png, tileset.tsx, chapters.json, *.tmx, solutions/<id>.txt
packages/core/src/
  types.ts        # shared types
  state.ts        # DIRS, DELTA, idx, inBounds, initialState
  step.ts         # step(): the rules
  ascii.ts        # fromAscii/toAscii (tests, tools)
  session.ts      # Session: undo / restart / moveLog
  replay.ts       # replay, parseMoves, formatMoves
  validate.ts     # validateLevel, assertValidLevel
  medals.ts       # thresholds, medals
  progress.ts     # chapters, unlocking, records
  solver.ts       # BFS
  index.ts
packages/tiled/src/
  xml.ts          # configured fast-xml-parser
  tileset.ts      # TILE_ORDER, parseTileset
  tmx.ts          # parseTmx
  write.ts        # writeTmx, setMapProperty
  pack.ts         # loadPack(dir)
  index.ts
packages/tools/src/
  paths.ts, commands.ts, cli.ts, levels.test.ts
packages/game/
  index.html, vite.config.ts, vite-plugin-levels.ts, playwright.config.ts, e2e/level1.spec.ts
  public/textures/*.png, public/music/*.mp3, public/icons/*.png
  src/main.ts, app.ts, levels.ts, virtual-levels.d.ts, debug.ts, ui.ts, format.ts, i18n.ts, save.ts, music.ts, touch.ts
  src/input/InputController.ts, swipe.ts, keyboardLabels.ts
  src/render/animTiming.ts, autotile.ts, layout.ts, BoardView.ts
  src/scenes/BootScene.ts, MenuScene.ts, OptionsScene.ts, SelectScene.ts, GameScene.ts, ResultScene.ts
```

---

### Task 1: Monorepo and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.prettierrc.json`, `.prettierignore`
- Create: `packages/core/package.json`, `packages/core/src/index.ts`
- Modify: `.gitignore` (add `.claude/`)

**Interfaces:**
- Produces: root scripts `npm test`, `npm run typecheck`, `npm run format`, `npm run validate`, `npm run solve`, `npm run dev`, `npm run build`, `npm run e2e`. Package `@puzzlecave/core`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "puzzlecave",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "format": "prettier --write .",
    "validate": "tsx packages/tools/src/cli.ts validate",
    "solve": "tsx packages/tools/src/cli.ts solve",
    "dev": "npm run dev -w @puzzlecave/game",
    "build": "npm run build -w @puzzlecave/game",
    "e2e": "npm run e2e -w @puzzlecave/game"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/*.ts", "packages/*/e2e/**/*.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
```

`.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100 }`
`.prettierignore` (one entry per line): `node_modules`, `dist`, `levels`, `*.md`, `packages/game/public`.

Add `.claude/` to `.gitignore`.

- [ ] **Step 2: Minimal core package**

`packages/core/package.json`:
```json
{
  "name": "@puzzlecave/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```
`packages/core/src/index.ts`: `export {};`

- [ ] **Step 3: Install the tools (latest versions)**

Run: `npm install -D typescript@latest vitest@latest prettier@latest tsx@latest @types/node@latest`
Expected: installation OK. If `typescript@7` does not expose a working `tsc` binary with this `tsconfig.json`, report it and fall back to the latest 6.x version (`npm view typescript versions --json`), noting it in the report.

- [ ] **Step 4: Verify**

Temporarily create `packages/core/src/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('vitest runs', () => expect(1 + 1).toBe(2));
```
Run: `npm test` → 1 PASS. Run: `npm run typecheck` → no error. Then delete `smoke.test.ts` and check that `npm test` still passes (`passWithNoTests`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: npm workspaces monorepo, TypeScript, Vitest, Prettier

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: core — types, state, rules (`step`) and ASCII

**Files:**
- Create: `packages/core/src/types.ts`, `state.ts`, `step.ts`, `ascii.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/step.test.ts`, `packages/core/src/ascii.test.ts`

**Interfaces:**
- Produces (exported by `@puzzlecave/core`):
  - types `Terrain`, `ObjKind`, `TileKind`, `Dir`, `Mode`, `Status`, `Pos`, `LevelObject`, `ThresholdOverrides`, `LevelData`, `GameState`, `GameEvent`, `StepResult`, `AsciiOptions`
  - `DIRS: readonly Dir[]`, `DELTA: Record<Dir, Pos>`, `idx(s, p): number`, `inBounds(s, p): boolean`
  - `initialState(level: LevelData, mode?: Mode): GameState` (initial facing `down`)
  - `step(state: GameState, dir: Dir): StepResult`
  - `fromAscii(rows: string[], opts?: AsciiOptions): LevelData`, `toAscii(state: GameState): string[]`

- [ ] **Step 1: Types**

`packages/core/src/types.ts`:
```ts
export type Terrain = 'floor' | 'gravel' | 'water' | 'wall' | 'exit';
export type ObjKind = 'key' | 'door' | 'block';
export type TileKind = Terrain | ObjKind | 'start';
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Mode = 'normal' | 'platinum';
export type Status = 'playing' | 'won' | 'drowned';

export interface Pos {
  readonly x: number;
  readonly y: number;
}

export interface LevelObject extends Pos {
  readonly kind: ObjKind;
}

export interface ThresholdOverrides {
  goldMoves?: number;
  silverMoves?: number;
  bronzeMoves?: number;
  goldTime?: number;
  silverTime?: number;
  bronzeTime?: number;
  platinumTime?: number;
}

export interface LevelData {
  id: string;
  name: string;
  author?: string;
  width: number;
  height: number;
  /** row-major, length width*height */
  terrain: Terrain[];
  objects: LevelObject[];
  start: Pos;
  initialKeys: number;
  platinum: boolean;
  thresholds: ThresholdOverrides;
}

export interface GameState {
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly Terrain[];
  readonly objects: readonly (ObjKind | null)[];
  readonly player: Pos;
  readonly facing: Dir;
  readonly keys: number;
  readonly moves: number;
  readonly status: Status;
  readonly mode: Mode;
}

export type GameEvent =
  | { type: 'turned'; facing: Dir }
  | { type: 'moved'; from: Pos; to: Pos }
  | { type: 'pushed'; from: Pos; to: Pos }
  | { type: 'blockSank'; at: Pos }
  | { type: 'keyPicked'; at: Pos }
  | { type: 'doorOpened'; at: Pos }
  | { type: 'won' }
  | { type: 'drowned'; at: Pos };

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}
```

- [ ] **Step 2: Write the ASCII tests (they fail)**

ASCII legend: `.` floor, `,` gravel, `~` water, `#` wall, `E` exit, `@` start (on floor), `k` key, `D` door, `B` block (on floor).

`packages/core/src/ascii.test.ts`:
```ts
import { expect, test } from 'vitest';
import { fromAscii, toAscii } from './ascii';
import { initialState } from './state';

test('fromAscii builds terrain, objects and start', () => {
  const l = fromAscii(['@k,', '~BE'], { id: 't', initialKeys: 2 });
  expect(l.width).toBe(3);
  expect(l.height).toBe(2);
  expect(l.terrain).toEqual(['floor', 'floor', 'gravel', 'water', 'floor', 'exit']);
  expect(l.objects).toEqual([
    { x: 1, y: 0, kind: 'key' },
    { x: 1, y: 1, kind: 'block' },
  ]);
  expect(l.start).toEqual({ x: 0, y: 0 });
  expect(l.initialKeys).toBe(2);
  expect(l.platinum).toBe(false);
  expect(l.thresholds).toEqual({});
});

test('fromAscii rejects an unknown character, uneven rows, zero or two starts', () => {
  expect(() => fromAscii(['@x'])).toThrow(/unknown/);
  expect(() => fromAscii(['@.', '.'])).toThrow(/length/);
  expect(() => fromAscii(['..'])).toThrow(/start/);
  expect(() => fromAscii(['@@'])).toThrow(/start/);
});

test('toAscii redraws the state', () => {
  const rows = ['@k,', '~BE'];
  expect(toAscii(initialState(fromAscii(rows)))).toEqual(rows);
});
```

- [ ] **Step 3: Write the rules tests (they fail)**

`packages/core/src/step.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { fromAscii, toAscii, type AsciiOptions } from './ascii';
import { initialState } from './state';
import { step } from './step';
import type { Dir, GameState, Mode } from './types';

const lvl = (rows: string[], opts: AsciiOptions = {}, mode: Mode = 'normal') =>
  initialState(fromAscii(rows, opts), mode);
const go = (s: GameState, ...dirs: Dir[]) => dirs.reduce((st, d) => step(st, d).state, s);

describe('movement', () => {
  test('moves onto floor and counts a move', () => {
    const s = go(lvl(['@.E']), 'right');
    expect(s.player).toEqual({ x: 1, y: 0 });
    expect(s.moves).toBe(1);
    expect(s.facing).toBe('right');
  });

  test('reaching the exit wins', () => {
    const r = step(go(lvl(['@.E']), 'right'), 'right');
    expect(r.state.status).toBe('won');
    expect(r.events.at(-1)).toEqual({ type: 'won' });
  });

  test('gravel can be crossed', () => {
    expect(go(lvl(['@,E']), 'right', 'right').status).toBe('won');
  });

  test('a wall blocks: the player only turns, no move', () => {
    const r = step(lvl(['@#E']), 'right');
    expect(r.state.player).toEqual({ x: 0, y: 0 });
    expect(r.state.moves).toBe(0);
    expect(r.state.facing).toBe('right');
    expect(r.events).toEqual([{ type: 'turned', facing: 'right' }]);
  });

  test('blocked with the same facing: same state, no event', () => {
    const s = lvl(['@E']); // initial facing: down, map edge below
    const r = step(s, 'down');
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  test('the map edge blocks', () => {
    expect(go(lvl(['@E']), 'left').player).toEqual({ x: 0, y: 0 });
  });

  test('the original state is never modified', () => {
    const s = lvl(['@B.E']);
    const before = JSON.stringify(s);
    step(s, 'right');
    expect(JSON.stringify(s)).toBe(before);
  });

  test('a finished game ignores input', () => {
    const won = go(lvl(['@E']), 'right');
    expect(step(won, 'left')).toEqual({ state: won, events: [] });
  });

  test('burst of 50 moves: exactly 50 moves applied', () => {
    const s = go(lvl(['@' + '.'.repeat(50) + 'E']), ...Array<Dir>(50).fill('right'));
    expect(s.player).toEqual({ x: 50, y: 0 });
    expect(s.moves).toBe(50);
    expect(s.status).toBe('playing');
    expect(step(s, 'right').state.status).toBe('won');
  });
});

describe('water', () => {
  test('normal mode: water blocks', () => {
    const s = go(lvl(['@~E']), 'right');
    expect(s.player).toEqual({ x: 0, y: 0 });
    expect(s.moves).toBe(0);
  });

  test('platinum mode: water drowns', () => {
    const r = step(lvl(['@~E'], {}, 'platinum'), 'right');
    expect(r.state.status).toBe('drowned');
    expect(r.state.moves).toBe(1);
    expect(r.events).toContainEqual({ type: 'drowned', at: { x: 1, y: 0 } });
    expect(step(r.state, 'right').state).toBe(r.state);
  });
});

describe('keys and doors', () => {
  test('pick up a key then open the door', () => {
    let r = step(lvl(['@kDE']), 'right');
    expect(r.state.keys).toBe(1);
    expect(r.events).toContainEqual({ type: 'keyPicked', at: { x: 1, y: 0 } });
    r = step(r.state, 'right');
    expect(r.state.keys).toBe(0);
    expect(r.state.player).toEqual({ x: 2, y: 0 });
    expect(r.events).toContainEqual({ type: 'doorOpened', at: { x: 2, y: 0 } });
    expect(step(r.state, 'right').state.status).toBe('won');
  });

  test('door without a key: blocks', () => {
    expect(go(lvl(['@DE']), 'right').player).toEqual({ x: 0, y: 0 });
  });

  test('negative initial keys: enough must be picked up', () => {
    expect(go(lvl(['@kkDE'], { initialKeys: -1 }), 'right', 'right', 'right').player).toEqual({ x: 3, y: 0 });
    expect(go(lvl(['@kkDE'], { initialKeys: -2 }), 'right', 'right', 'right').player).toEqual({ x: 2, y: 0 });
  });
});

describe('blocks', () => {
  test('push a block onto floor', () => {
    const r = step(lvl(['@B..']), 'right');
    expect(toAscii(r.state)).toEqual(['.@B.']);
    expect(r.events).toContainEqual({ type: 'pushed', from: { x: 1, y: 0 }, to: { x: 2, y: 0 } });
  });

  test('a block pushed into water fills it', () => {
    const r = step(lvl(['@B~.']), 'right');
    expect(r.events).toContainEqual({ type: 'blockSank', at: { x: 2, y: 0 } });
    expect(toAscii(r.state)).toEqual(['.@..']);
    expect(go(r.state, 'right', 'right').player).toEqual({ x: 3, y: 0 });
  });

  test.each([
    ['gravel', ['@B,']],
    ['wall', ['@B#']],
    ['exit', ['@BE']],
    ['edge', ['@B']],
    ['another block', ['@BB.']],
    ['key', ['@Bk']],
    ['door', ['@BD']],
  ])('a block cannot go onto: %s', (_name, rows) => {
    const s = go(lvl(rows), 'right');
    expect(s.moves).toBe(0);
    expect(s.player).toEqual({ x: 0, y: 0 });
  });
});
```

Note: `['@B']` has no exit — this is intentional, `fromAscii` does not check for the presence of an exit (that is `validateLevel`'s job, Task 4).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core` — Expected: FAIL (modules not found).

- [ ] **Step 5: Implement `state.ts`**

```ts
import type { Dir, GameState, LevelData, Mode, ObjKind, Pos } from './types';

export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export const DELTA: Record<Dir, Pos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function idx(s: { width: number }, p: Pos): number {
  return p.y * s.width + p.x;
}

export function inBounds(s: { width: number; height: number }, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < s.width && p.y < s.height;
}

export function initialState(level: LevelData, mode: Mode = 'normal'): GameState {
  const objects = new Array<ObjKind | null>(level.width * level.height).fill(null);
  for (const o of level.objects) objects[idx(level, o)] = o.kind;
  return {
    width: level.width,
    height: level.height,
    terrain: [...level.terrain],
    objects,
    player: { x: level.start.x, y: level.start.y },
    facing: 'down',
    keys: level.initialKeys,
    moves: 0,
    status: 'playing',
    mode,
  };
}
```

- [ ] **Step 6: Implement `step.ts`**

```ts
import { DELTA, idx, inBounds } from './state';
import type { Dir, GameEvent, GameState, ObjKind, Pos, Status, StepResult, Terrain } from './types';

function withValue<T>(arr: readonly T[], i: number, v: T): T[] {
  const copy = arr.slice();
  copy[i] = v;
  return copy;
}

export function step(s: GameState, dir: Dir): StepResult {
  if (s.status !== 'playing') return { state: s, events: [] };

  const turned = s.facing !== dir;
  const blocked = (): StepResult =>
    turned
      ? { state: { ...s, facing: dir }, events: [{ type: 'turned', facing: dir }] }
      : { state: s, events: [] };

  const d = DELTA[dir];
  const dest: Pos = { x: s.player.x + d.x, y: s.player.y + d.y };
  if (!inBounds(s, dest)) return blocked();
  const di = idx(s, dest);
  const destTerrain = s.terrain[di] as Terrain;
  if (destTerrain === 'wall') return blocked();
  if (destTerrain === 'water' && s.mode === 'normal') return blocked();

  let terrain: readonly Terrain[] = s.terrain;
  let objects: readonly (ObjKind | null)[] = s.objects;
  let keys = s.keys;
  const effects: GameEvent[] = [];
  const obj = s.objects[di] ?? null;

  if (obj === 'door') {
    if (keys <= 0) return blocked();
    objects = withValue(objects, di, null);
    keys -= 1;
    effects.push({ type: 'doorOpened', at: dest });
  } else if (obj === 'key') {
    objects = withValue(objects, di, null);
    keys += 1;
    effects.push({ type: 'keyPicked', at: dest });
  } else if (obj === 'block') {
    const behind: Pos = { x: dest.x + d.x, y: dest.y + d.y };
    if (!inBounds(s, behind)) return blocked();
    const bi = idx(s, behind);
    const behindTerrain = s.terrain[bi];
    if ((behindTerrain !== 'floor' && behindTerrain !== 'water') || s.objects[bi] !== null) {
      return blocked();
    }
    objects = withValue(objects, di, null);
    effects.push({ type: 'pushed', from: dest, to: behind });
    if (behindTerrain === 'water') {
      terrain = withValue(terrain, bi, 'floor');
      effects.push({ type: 'blockSank', at: behind });
    } else {
      objects = withValue(objects, bi, 'block');
    }
  }

  const status: Status =
    destTerrain === 'water' ? 'drowned' : destTerrain === 'exit' ? 'won' : 'playing';
  const events: GameEvent[] = [];
  if (turned) events.push({ type: 'turned', facing: dir });
  events.push({ type: 'moved', from: s.player, to: dest }, ...effects);
  if (status === 'drowned') events.push({ type: 'drowned', at: dest });
  if (status === 'won') events.push({ type: 'won' });

  return {
    state: { ...s, terrain, objects, keys, player: dest, facing: dir, moves: s.moves + 1, status },
    events,
  };
}
```

- [ ] **Step 7: Implement `ascii.ts`**

```ts
import type { GameState, LevelData, LevelObject, ObjKind, Pos, Terrain } from './types';

export type AsciiOptions = Partial<
  Pick<LevelData, 'id' | 'name' | 'author' | 'initialKeys' | 'platinum' | 'thresholds'>
>;

const LEGEND: Record<string, { terrain: Terrain; obj?: ObjKind; start?: true }> = {
  '.': { terrain: 'floor' },
  ',': { terrain: 'gravel' },
  '~': { terrain: 'water' },
  '#': { terrain: 'wall' },
  E: { terrain: 'exit' },
  '@': { terrain: 'floor', start: true },
  k: { terrain: 'floor', obj: 'key' },
  D: { terrain: 'floor', obj: 'door' },
  B: { terrain: 'floor', obj: 'block' },
};

const TERRAIN_CHAR: Record<Terrain, string> = { floor: '.', gravel: ',', water: '~', wall: '#', exit: 'E' };
const OBJ_CHAR: Record<ObjKind, string> = { key: 'k', door: 'D', block: 'B' };

export function fromAscii(rows: string[], opts: AsciiOptions = {}): LevelData {
  const width = rows[0]?.length ?? 0;
  const terrain: Terrain[] = [];
  const objects: LevelObject[] = [];
  const starts: Pos[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y}: length ${row.length} ≠ ${width}`);
    [...row].forEach((ch, x) => {
      const cell = LEGEND[ch];
      if (!cell) throw new Error(`unknown character "${ch}" at (${x},${y})`);
      terrain.push(cell.terrain);
      if (cell.obj) objects.push({ x, y, kind: cell.obj });
      if (cell.start) starts.push({ x, y });
    });
  });
  if (starts.length !== 1) {
    throw new Error(`exactly one start (@) required, found ${starts.length}`);
  }
  return {
    id: opts.id ?? 'ascii',
    name: opts.name ?? opts.id ?? 'ascii',
    ...(opts.author !== undefined ? { author: opts.author } : {}),
    width,
    height: rows.length,
    terrain,
    objects,
    start: starts[0]!,
    initialKeys: opts.initialKeys ?? 0,
    platinum: opts.platinum ?? false,
    thresholds: opts.thresholds ?? {},
  };
}

export function toAscii(s: GameState): string[] {
  const rows: string[] = [];
  for (let y = 0; y < s.height; y++) {
    let row = '';
    for (let x = 0; x < s.width; x++) {
      const i = y * s.width + x;
      const obj = s.objects[i] ?? null;
      if (s.player.x === x && s.player.y === y) row += '@';
      else if (obj) row += OBJ_CHAR[obj];
      else row += TERRAIN_CHAR[s.terrain[i]!];
    }
    rows.push(row);
  }
  return rows;
}
```

- [ ] **Step 8: `index.ts`**

```ts
export * from './types';
export * from './state';
export * from './step';
export * from './ascii';
```

- [ ] **Step 9: Run the tests and the typecheck**

Run: `npx vitest run packages/core && npm run typecheck` — Expected: all PASS.

- [ ] **Step 10: Commit** `feat(core): game rules (step), immutable state, ASCII notation` (+ `Co-Authored-By` trailer).

---

### Task 3: core — Session (undo/restart) and replay

**Files:**
- Create: `packages/core/src/session.ts`, `packages/core/src/replay.ts`
- Modify: `packages/core/src/index.ts` (export both)
- Test: `packages/core/src/session.test.ts`, `packages/core/src/replay.test.ts`

**Interfaces:**
- Consumes: `initialState`, `step`, `fromAscii` (Task 2).
- Produces:
  - `class Session { constructor(level: LevelData, mode?: Mode); readonly level: LevelData; readonly mode: Mode; get state(): GameState; move(dir: Dir): GameEvent[]; undo(): boolean; restart(): void; get moveLog(): Dir[] }`
  - `replay(level: LevelData, dirs: readonly Dir[], mode?: Mode): GameState`
  - `parseMoves(text: string): Dir[]` (letters `U D L R`, case-insensitive, whitespace/newlines ignored, `#` starts a comment until end of line)
  - `formatMoves(dirs: readonly Dir[]): string` (uppercase letters, line break every 50 moves, trailing `\n`)

- [ ] **Step 1: Session tests (they fail)**

`packages/core/src/session.test.ts`:
```ts
import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { Session } from './session';

const level = fromAscii(['@.#', '..E']);

test('move pushes effective moves, undo pops them', () => {
  const s = new Session(level);
  s.move('right');
  s.move('down');
  expect(s.state.moves).toBe(2);
  expect(s.moveLog).toEqual(['right', 'down']);
  expect(s.undo()).toBe(true);
  expect(s.state.moves).toBe(1);
  expect(s.state.player).toEqual({ x: 1, y: 0 });
  expect(s.moveLog).toEqual(['right']);
});

test('undo at the start returns false', () => {
  expect(new Session(level).undo()).toBe(false);
});

test('a mere change of facing does not create a history entry', () => {
  const s = new Session(level);
  s.move('right');
  s.move('right'); // wall, already facing right: nothing
  s.move('up'); // edge: only turns
  expect(s.state.facing).toBe('up');
  expect(s.moveLog).toEqual(['right']);
  expect(s.undo()).toBe(true);
  expect(s.state.moves).toBe(0);
});

test('no undo after a win or a drowning', () => {
  const s = new Session(level);
  s.move('right');
  s.move('down');
  s.move('right');
  expect(s.state.status).toBe('won');
  expect(s.undo()).toBe(false);

  const p = new Session(fromAscii(['@~E']), 'platinum');
  p.move('right');
  expect(p.state.status).toBe('drowned');
  expect(p.undo()).toBe(false);
});

test('restart goes back to the initial state', () => {
  const s = new Session(level);
  s.move('right');
  s.restart();
  expect(s.state.moves).toBe(0);
  expect(s.moveLog).toEqual([]);
  expect(s.state.player).toEqual({ x: 0, y: 0 });
});
```

- [ ] **Step 2: Replay tests (they fail)**

`packages/core/src/replay.test.ts`:
```ts
import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { formatMoves, parseMoves, replay } from './replay';
import type { Dir } from './types';

test('parseMoves reads U D L R, ignores whitespace, case and comments', () => {
  expect(parseMoves('RrD # comment\n l U')).toEqual(['right', 'right', 'down', 'left', 'up']);
});

test('parseMoves rejects an unknown character', () => {
  expect(() => parseMoves('RX')).toThrow(/"X"/);
});

test('formatMoves: uppercase, 50 per line', () => {
  const dirs = Array<Dir>(51).fill('up');
  expect(formatMoves(dirs)).toBe('U'.repeat(50) + '\nU\n');
  expect(parseMoves(formatMoves(dirs))).toEqual(dirs);
});

test('replay replays a solution to victory', () => {
  const l = fromAscii(['@.#', '..E']);
  expect(replay(l, parseMoves('RDR')).status).toBe('won');
  expect(replay(l, parseMoves('RD')).status).toBe('playing');
});
```

- [ ] **Step 3: Run** `npx vitest run packages/core` → FAIL.

- [ ] **Step 4: Implement `session.ts`**

```ts
import { initialState } from './state';
import { step } from './step';
import type { Dir, GameEvent, GameState, LevelData, Mode } from './types';

interface Entry {
  state: GameState;
  dir: Dir | null;
}

export class Session {
  readonly level: LevelData;
  readonly mode: Mode;
  private stack: Entry[];

  constructor(level: LevelData, mode: Mode = 'normal') {
    this.level = level;
    this.mode = mode;
    this.stack = [{ state: initialState(level, mode), dir: null }];
  }

  get state(): GameState {
    return this.stack[this.stack.length - 1]!.state;
  }

  move(dir: Dir): GameEvent[] {
    const top = this.stack[this.stack.length - 1]!;
    const r = step(top.state, dir);
    if (r.state === top.state) return r.events;
    if (r.state.moves === top.state.moves) {
      this.stack[this.stack.length - 1] = { ...top, state: r.state };
    } else {
      this.stack.push({ state: r.state, dir });
    }
    return r.events;
  }

  undo(): boolean {
    if (this.state.status !== 'playing' || this.stack.length <= 1) return false;
    this.stack.pop();
    return true;
  }

  restart(): void {
    this.stack = [{ state: initialState(this.level, this.mode), dir: null }];
  }

  get moveLog(): Dir[] {
    return this.stack.slice(1).map((e) => e.dir as Dir);
  }
}
```

- [ ] **Step 5: Implement `replay.ts`**

```ts
import { initialState } from './state';
import { step } from './step';
import type { Dir, GameState, LevelData, Mode } from './types';

const LETTER_TO_DIR: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };
const DIR_TO_LETTER: Record<Dir, string> = { up: 'U', down: 'D', left: 'L', right: 'R' };

export function replay(level: LevelData, dirs: readonly Dir[], mode: Mode = 'normal'): GameState {
  let s = initialState(level, mode);
  for (const d of dirs) s = step(s, d).state;
  return s;
}

export function parseMoves(text: string): Dir[] {
  const dirs: Dir[] = [];
  for (const line of text.split(/\r?\n/)) {
    const content = line.split('#')[0] ?? '';
    for (const ch of content) {
      if (/\s/.test(ch)) continue;
      const d = LETTER_TO_DIR[ch.toUpperCase()];
      if (!d) throw new Error(`invalid solution character: "${ch}"`);
      dirs.push(d);
    }
  }
  return dirs;
}

export function formatMoves(dirs: readonly Dir[]): string {
  const letters = dirs.map((d) => DIR_TO_LETTER[d]).join('');
  const lines: string[] = [];
  for (let i = 0; i < letters.length; i += 50) lines.push(letters.slice(i, i + 50));
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 6: Export** in `index.ts`: `export * from './session'; export * from './replay';`
- [ ] **Step 7: Run** `npx vitest run packages/core && npm run typecheck` → PASS.
- [ ] **Step 8: Commit** `feat(core): session with undo/restart, replay and solution format` (+ trailer).

---

### Task 4: core — level validation

**Files:**
- Create: `packages/core/src/validate.ts`; Modify: `index.ts`
- Test: `packages/core/src/validate.test.ts`

**Interfaces:**
- Produces: `validateLevel(level: LevelData): string[]` (empty list = valid); `assertValidLevel(level: LevelData): void` (throws an `Error` whose message starts with `Level "<id>" is invalid`).

- [ ] **Step 1: Tests (they fail)**

```ts
import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { assertValidLevel, validateLevel } from './validate';
import type { LevelData } from './types';

const ok = fromAscii(['@kB', '.~E'], { id: 'ok' });

test('a correct level is valid', () => {
  expect(validateLevel(ok)).toEqual([]);
});

test.each<[string, LevelData, RegExp]>([
  ['empty id', { ...ok, id: '' }, /empty id/],
  ['dimensions', { ...ok, width: 0 }, /dimensions/],
  ['terrain size', { ...ok, terrain: ok.terrain.slice(1) }, /terrain/],
  ['start outside the map', { ...ok, start: { x: 9, y: 0 } }, /start outside/],
  ['start on water', { ...ok, start: { x: 1, y: 1 } }, /start on water/],
  ['object outside the map', { ...ok, objects: [{ x: 5, y: 5, kind: 'key' }] }, /outside the map/],
  ['two objects on the same tile', { ...ok, objects: [...ok.objects, { x: 1, y: 0, kind: 'door' }] }, /two objects/],
  ['object on the start', { ...ok, objects: [{ x: 0, y: 0, kind: 'key' }] }, /on the start/],
  ['object on water', { ...ok, objects: [{ x: 1, y: 1, kind: 'key' }] }, /on water/],
  ['object on the exit', { ...ok, objects: [{ x: 2, y: 1, kind: 'block' }] }, /on exit/],
  ['no exit', { ...ok, terrain: ok.terrain.map((t) => (t === 'exit' ? 'floor' : t)) }, /no exit/],
  ['non-integer keys', { ...ok, initialKeys: 1.5 }, /keys/],
])('%s', (_name, level, re) => {
  expect(validateLevel(level)).toContainEqual(expect.stringMatching(re));
});

test('assertValidLevel throws a readable error', () => {
  expect(() => assertValidLevel({ ...ok, id: 'x', width: 0 })).toThrow(/Level "x" is invalid/);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { LevelData, Terrain } from './types';

const NO_OBJECT_ON = new Set<Terrain>(['wall', 'water', 'exit']);

export function validateLevel(l: LevelData): string[] {
  const e: string[] = [];
  if (!l.id) e.push('empty id');
  const { width: w, height: h } = l;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    e.push(`invalid dimensions (${w}x${h})`);
    return e;
  }
  if (l.terrain.length !== w * h) {
    e.push(`terrain: ${l.terrain.length} tiles instead of ${w * h}`);
    return e;
  }
  const inside = (x: number, y: number) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h;
  const at = (x: number, y: number) => l.terrain[y * w + x]!;

  if (!inside(l.start.x, l.start.y)) {
    e.push(`start outside the map (${l.start.x},${l.start.y})`);
  } else {
    const t = at(l.start.x, l.start.y);
    if (t === 'wall' || t === 'water') e.push(`start on ${t}`);
  }

  const seen = new Set<number>();
  for (const o of l.objects) {
    if (!inside(o.x, o.y)) {
      e.push(`object ${o.kind} outside the map (${o.x},${o.y})`);
      continue;
    }
    const i = o.y * w + o.x;
    if (seen.has(i)) e.push(`two objects at (${o.x},${o.y})`);
    seen.add(i);
    if (o.x === l.start.x && o.y === l.start.y) e.push(`object ${o.kind} on the start`);
    const t = at(o.x, o.y);
    if (NO_OBJECT_ON.has(t)) e.push(`object ${o.kind} on ${t} at (${o.x},${o.y})`);
  }

  if (!l.terrain.includes('exit')) e.push('no exit');
  if (!Number.isInteger(l.initialKeys)) e.push('initial keys is not an integer');
  return e;
}

export function assertValidLevel(l: LevelData): void {
  const e = validateLevel(l);
  if (e.length) throw new Error(`Level "${l.id}" is invalid:\n- ${e.join('\n- ')}`);
}
```

- [ ] **Step 4: Export, Run** `npx vitest run packages/core && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(core): level validation` (+ trailer).

---

### Task 5: core — medals

**Files:**
- Create: `packages/core/src/medals.ts`; Modify: `index.ts`
- Test: `packages/core/src/medals.test.ts`

**Interfaces:**
- Produces:
  - `type Medal = 'gold' | 'silver' | 'bronze'`
  - `interface Tier { gold: number; silver: number; bronze: number }`
  - `interface Thresholds { moves?: Tier; time?: Tier; platinumTime?: number }` (time in seconds)
  - `resolveThresholds(o: ThresholdOverrides, platinum: boolean): Thresholds`
  - `medalFor(tier: Tier | undefined, value: number): Medal | undefined`
  - `interface RunResult { moves: number; timeMs: number; mode: Mode }`
  - `interface Award { moves?: Medal; time?: Medal; platinum: boolean }`
  - `award(level: LevelData, r: RunResult): Award`
  - `MEDAL_RANK: Record<Medal, number>` (gold 3, silver 2, bronze 1), `bestMedal(a?: Medal, b?: Medal): Medal | undefined`

Rules (spec §5): silver moves = `max(ceil(gold×1.10), gold+2)`, bronze moves = `max(ceil(gold×1.25), gold+5)`; silver time = `max(gold×1.25, gold+3)`, bronze time = `max(gold×1.5, gold+6)`, rounded to the hundredth; every value can be overridden; `platinumTime = o.platinumTime ?? o.goldTime` if `platinum`, otherwise `undefined`. Value ≤ threshold ⇒ medal.

- [ ] **Step 1: Tests (they fail)**

```ts
import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { award, bestMedal, medalFor, resolveThresholds } from './medals';

test.each([
  [40, 44, 50],
  [10, 12, 15],
  [200, 220, 250],
])('moves: gold %i → silver %i, bronze %i', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldMoves: gold }, false).moves).toEqual({ gold, silver, bronze });
});

test.each([
  [20, 25, 30],
  [4, 7, 10],
])('time: gold %d s → silver %d s, bronze %d s', (gold, silver, bronze) => {
  expect(resolveThresholds({ goldTime: gold }, false).time).toEqual({ gold, silver, bronze });
});

test('overrides take precedence', () => {
  const t = resolveThresholds({ goldMoves: 40, silverMoves: 41, bronzeTime: 99, goldTime: 20 }, false);
  expect(t.moves).toEqual({ gold: 40, silver: 41, bronze: 50 });
  expect(t.time).toEqual({ gold: 20, silver: 25, bronze: 99 });
});

test('without gold: no tier', () => {
  expect(resolveThresholds({}, true)).toEqual({});
});

test('platinum: goldTime by default, overridable, absent if not platinum', () => {
  expect(resolveThresholds({ goldTime: 20 }, true).platinumTime).toBe(20);
  expect(resolveThresholds({ goldTime: 20, platinumTime: 18 }, true).platinumTime).toBe(18);
  expect(resolveThresholds({ goldTime: 20 }, false).platinumTime).toBeUndefined();
});

test('medalFor: value ≤ threshold', () => {
  const tier = { gold: 10, silver: 12, bronze: 15 };
  expect(medalFor(tier, 10)).toBe('gold');
  expect(medalFor(tier, 11)).toBe('silver');
  expect(medalFor(tier, 15)).toBe('bronze');
  expect(medalFor(tier, 16)).toBeUndefined();
  expect(medalFor(undefined, 1)).toBeUndefined();
});

test('award combines moves, time and platinum', () => {
  const level = fromAscii(['@E'], { platinum: true, thresholds: { goldMoves: 10, goldTime: 20 } });
  expect(award(level, { moves: 11, timeMs: 20_000, mode: 'normal' })).toEqual({
    moves: 'silver',
    time: 'gold',
    platinum: false,
  });
  expect(award(level, { moves: 10, timeMs: 19_990, mode: 'platinum' }).platinum).toBe(true);
  expect(award(level, { moves: 10, timeMs: 20_010, mode: 'platinum' }).platinum).toBe(false);
});

test('bestMedal keeps the best one', () => {
  expect(bestMedal('bronze', 'gold')).toBe('gold');
  expect(bestMedal(undefined, 'silver')).toBe('silver');
  expect(bestMedal(undefined, undefined)).toBeUndefined();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { LevelData, Mode, ThresholdOverrides } from './types';

export type Medal = 'gold' | 'silver' | 'bronze';
export interface Tier {
  gold: number;
  silver: number;
  bronze: number;
}
export interface Thresholds {
  moves?: Tier;
  time?: Tier;
  platinumTime?: number;
}
export interface RunResult {
  moves: number;
  timeMs: number;
  mode: Mode;
}
export interface Award {
  moves?: Medal;
  time?: Medal;
  platinum: boolean;
}

export const MEDAL_RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

const centi = (x: number) => Math.round(x * 100) / 100;

export function resolveThresholds(o: ThresholdOverrides, platinum: boolean): Thresholds {
  const t: Thresholds = {};
  if (o.goldMoves !== undefined) {
    const g = o.goldMoves;
    t.moves = {
      gold: g,
      silver: o.silverMoves ?? Math.max(Math.ceil(g * 1.1), g + 2),
      bronze: o.bronzeMoves ?? Math.max(Math.ceil(g * 1.25), g + 5),
    };
  }
  if (o.goldTime !== undefined) {
    const g = o.goldTime;
    t.time = {
      gold: g,
      silver: o.silverTime ?? centi(Math.max(g * 1.25, g + 3)),
      bronze: o.bronzeTime ?? centi(Math.max(g * 1.5, g + 6)),
    };
  }
  if (platinum) {
    const p = o.platinumTime ?? o.goldTime;
    if (p !== undefined) t.platinumTime = p;
  }
  return t;
}

export function medalFor(tier: Tier | undefined, value: number): Medal | undefined {
  if (!tier) return undefined;
  if (value <= tier.gold) return 'gold';
  if (value <= tier.silver) return 'silver';
  if (value <= tier.bronze) return 'bronze';
  return undefined;
}

export function award(level: LevelData, r: RunResult): Award {
  const th = resolveThresholds(level.thresholds, level.platinum);
  const seconds = r.timeMs / 1000;
  const a: Award = {
    platinum: r.mode === 'platinum' && th.platinumTime !== undefined && seconds <= th.platinumTime,
  };
  const m = medalFor(th.moves, r.moves);
  if (m) a.moves = m;
  const t = medalFor(th.time, seconds);
  if (t) a.time = t;
  return a;
}

export function bestMedal(a?: Medal, b?: Medal): Medal | undefined {
  if (!a) return b;
  if (!b) return a;
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b;
}
```

- [ ] **Step 4: Export, Run** tests + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(core): thresholds and medal awarding` (+ trailer).

---

### Task 6: core — progress and chapters

**Files:**
- Create: `packages/core/src/progress.ts`; Modify: `index.ts`
- Test: `packages/core/src/progress.test.ts`

**Interfaces:**
- Consumes: `Medal`, `Award`, `RunResult`, `bestMedal` (Task 5).
- Produces:
  - `interface Chapter { id: string; name: { fr: string; en: string }; unlockAfter: number; levels: string[] }`
  - `interface LevelRecord { completed: boolean; bestMoves?: number; bestTimeMs?: number; medals: { moves?: Medal; time?: Medal; platinum?: boolean } }`
  - `type Records = Readonly<Record<string, LevelRecord>>`
  - `completedCount(chapter: Chapter, records: Records): number`
  - `isChapterUnlocked(chapters: readonly Chapter[], ci: number, records: Records): boolean`
  - `isLevelUnlocked(chapters: readonly Chapter[], ci: number, li: number, records: Records): boolean`
  - `recordRun(prev: LevelRecord | undefined, r: RunResult, a: Award): LevelRecord`
  - `validateChapters(chapters: unknown, levelIds: ReadonlySet<string>): string[]`

- [ ] **Step 1: Tests (they fail)**

```ts
import { expect, test } from 'vitest';
import {
  completedCount, isChapterUnlocked, isLevelUnlocked, recordRun, validateChapters,
  type Chapter, type Records,
} from './progress';

const chapters: Chapter[] = [
  { id: 'c1', name: { fr: 'Un', en: 'One' }, unlockAfter: 0, levels: ['a', 'b', 'c'] },
  { id: 'c2', name: { fr: 'Deux', en: 'Two' }, unlockAfter: 2, levels: ['d', 'e'] },
];
const done = (...ids: string[]): Records =>
  Object.fromEntries(ids.map((id) => [id, { completed: true, medals: {} }]));

test('first level of the first chapter is open, the next one after completion', () => {
  expect(isLevelUnlocked(chapters, 0, 0, {})).toBe(true);
  expect(isLevelUnlocked(chapters, 0, 1, {})).toBe(false);
  expect(isLevelUnlocked(chapters, 0, 1, done('a'))).toBe(true);
});

test('a chapter opens after unlockAfter levels of the previous one', () => {
  expect(completedCount(chapters[0]!, done('a', 'c'))).toBe(2);
  expect(isChapterUnlocked(chapters, 1, done('a'))).toBe(false);
  expect(isChapterUnlocked(chapters, 1, done('a', 'b'))).toBe(true);
  expect(isLevelUnlocked(chapters, 1, 0, done('a', 'b'))).toBe(true);
  expect(isLevelUnlocked(chapters, 1, 0, done('a'))).toBe(false);
});

test('recordRun keeps the best results', () => {
  const r1 = recordRun(undefined, { moves: 30, timeMs: 9000, mode: 'normal' }, { moves: 'silver', platinum: false });
  expect(r1).toEqual({ completed: true, bestMoves: 30, bestTimeMs: 9000, medals: { moves: 'silver' } });
  const r2 = recordRun(r1, { moves: 40, timeMs: 5000, mode: 'platinum' }, { moves: 'bronze', time: 'gold', platinum: true });
  expect(r2).toEqual({
    completed: true,
    bestMoves: 30,
    bestTimeMs: 5000,
    medals: { moves: 'silver', time: 'gold', platinum: true },
  });
});

test('validateChapters: correct', () => {
  expect(validateChapters(chapters, new Set(['a', 'b', 'c', 'd', 'e']))).toEqual([]);
});

test.each<[string, unknown, string[], RegExp]>([
  ['not an array', {}, [], /array/],
  ['unknown level', chapters, ['a', 'b', 'c', 'd'], /"e" unknown/],
  ['level missing from the chapters', chapters, ['a', 'b', 'c', 'd', 'e', 'f'], /"f" missing/],
  ['duplicate level', [{ ...chapters[0]!, levels: ['a', 'a'] }], ['a'], /"a" used twice/],
  ['unlockAfter too large', [chapters[0], { ...chapters[1]!, unlockAfter: 4 }], ['a', 'b', 'c', 'd', 'e'], /unlockAfter/],
  ['missing name', [{ id: 'x', unlockAfter: 0, levels: ['a'] }], ['a'], /name/],
])('validateChapters: %s', (_n, value, ids, re) => {
  expect(validateChapters(value, new Set(ids))).toContainEqual(expect.stringMatching(re));
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { bestMedal, type Award, type Medal, type RunResult } from './medals';

export interface Chapter {
  id: string;
  name: { fr: string; en: string };
  unlockAfter: number;
  levels: string[];
}

export interface LevelRecord {
  completed: boolean;
  bestMoves?: number;
  bestTimeMs?: number;
  medals: { moves?: Medal; time?: Medal; platinum?: boolean };
}

export type Records = Readonly<Record<string, LevelRecord>>;

export function completedCount(chapter: Chapter, records: Records): number {
  return chapter.levels.filter((id) => records[id]?.completed).length;
}

export function isChapterUnlocked(chapters: readonly Chapter[], ci: number, records: Records): boolean {
  if (ci === 0) return true;
  const prev = chapters[ci - 1];
  const cur = chapters[ci];
  if (!prev || !cur) return false;
  return isChapterUnlocked(chapters, ci - 1, records) && completedCount(prev, records) >= cur.unlockAfter;
}

export function isLevelUnlocked(chapters: readonly Chapter[], ci: number, li: number, records: Records): boolean {
  const ch = chapters[ci];
  if (!ch || li < 0 || li >= ch.levels.length) return false;
  if (!isChapterUnlocked(chapters, ci, records)) return false;
  if (li === 0) return true;
  return Boolean(records[ch.levels[li - 1]!]?.completed);
}

export function recordRun(prev: LevelRecord | undefined, r: RunResult, a: Award): LevelRecord {
  const medals: LevelRecord['medals'] = {};
  const moves = bestMedal(prev?.medals.moves, a.moves);
  if (moves) medals.moves = moves;
  const time = bestMedal(prev?.medals.time, a.time);
  if (time) medals.time = time;
  if (prev?.medals.platinum || a.platinum) medals.platinum = true;
  return {
    completed: true,
    bestMoves: Math.min(prev?.bestMoves ?? Infinity, r.moves),
    bestTimeMs: Math.min(prev?.bestTimeMs ?? Infinity, r.timeMs),
    medals,
  };
}

export function validateChapters(value: unknown, levelIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return ['chapters.json must contain an array of chapters'];
  const e: string[] = [];
  const used = new Set<string>();
  value.forEach((raw: unknown, ci) => {
    const c = (raw ?? {}) as Partial<Chapter>;
    const label = `chapter ${ci + 1}${typeof c.id === 'string' ? ` (${c.id})` : ''}`;
    if (typeof c.id !== 'string' || !c.id) e.push(`${label}: missing id`);
    if (typeof c.name?.fr !== 'string' || typeof c.name?.en !== 'string') e.push(`${label}: missing fr/en name`);
    if (!Array.isArray(c.levels) || c.levels.length === 0) {
      e.push(`${label}: empty level list`);
      return;
    }
    for (const id of c.levels) {
      if (used.has(id)) e.push(`${label}: level "${id}" used twice`);
      used.add(id);
      if (!levelIds.has(id)) e.push(`${label}: level "${id}" unknown`);
    }
    const prevLen = ci === 0 ? 0 : (((value[ci - 1] ?? {}) as Partial<Chapter>).levels?.length ?? 0);
    const ua = c.unlockAfter;
    if (typeof ua !== 'number' || !Number.isInteger(ua) || ua < 0 || ua > prevLen) {
      e.push(`${label}: unlockAfter must be an integer between 0 and ${prevLen}`);
    }
  });
  for (const id of levelIds) if (!used.has(id)) e.push(`level "${id}" missing from the chapters`);
  return e;
}
```

- [ ] **Step 4: Export, Run** tests + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(core): chapters, unlocking and records` (+ trailer).

---

### Task 7: tiled — TMX reading/writing and loading the `levels/` folder

**Files:**
- Create: `packages/tiled/package.json`, `src/xml.ts`, `src/tileset.ts`, `src/tmx.ts`, `src/write.ts`, `src/pack.ts`, `src/index.ts`
- Test: `packages/tiled/src/tmx.test.ts`, `src/write.test.ts`, `src/pack.test.ts`

**Interfaces:**
- Consumes: types `LevelData`, `TileKind`, `Terrain`, `ObjKind`, `ThresholdOverrides`, `Chapter`, `validateLevel`, `validateChapters` from `@puzzlecave/core`.
- Produces (`@puzzlecave/tiled`):
  - `TILE_ORDER: readonly TileKind[]` = `['floor','gravel','water','wall','exit','start','key','door','block']` (local tile id = index; this is the order of `levels/tileset.png`)
  - `parseTileset(xml: string): Map<number, TileKind>` (local id → kind, via the tile property `kind`)
  - `parseTmx(xml: string, id: string, readTileset: (source: string) => string): LevelData`
  - `writeTmx(level: LevelData, tilesetSource?: string): string`
  - `setMapProperty(xml: string, name: string, value: string | number | boolean): string`
  - `interface LevelPack { levels: LevelData[]; chapters: Chapter[]; errors: string[]; files: string[] }`
  - `loadPack(dir: string): LevelPack` (errors prefixed by the file name: `"<file>: <reason>"`)

Accepted TMX format:
- tile layer named `terrain` (or else the first layer), `<data encoding="csv">` required; otherwise: `layer encoding "<enc>" not supported: in Tiled, Map > Map Properties > Tile Layer Format = CSV`.
- in the tile layer, a `start`/`key`/`door`/`block` tile = floor + that element; gid `0` → `empty tile at (x,y)`.
- object groups (all of them): objects with a `gid`; column = `round(x / tilewidth)`, row = `round(y / tileheight) - 1` (Tiled's bottom-left anchoring); a terrain tile in an object group → error.
- gid: flip bits masked (`gid & 0x1fffffff`); several `<tileset>` (the largest `firstgid ≤ gid`); external tileset (`source`) read via `readTileset`, embedded tileset read directly.
- map properties: `name` (default = id), `author`, `initialKeys` (integer, default 0), `platinum` (`true`), thresholds `goldMoves` … `platinumTime` (numbers).
- exactly one start, otherwise `exactly one start required, found N`.

- [ ] **Step 1: Package and dependency**

`packages/tiled/package.json`:
```json
{
  "name": "@puzzlecave/tiled",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@puzzlecave/core": "*" }
}
```
Run: `npm install fast-xml-parser@latest -w @puzzlecave/tiled && npm install`.

- [ ] **Step 2: Reading tests (they fail)**

`packages/tiled/src/tmx.test.ts`:
```ts
import { expect, test } from 'vitest';
import { parseTileset, parseTmx, TILE_ORDER } from './index';

const TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" name="pc" tilewidth="16" tileheight="16" tilecount="9" columns="9">
 <image source="tileset.png" width="144" height="16"/>
${TILE_ORDER.map((k, i) => ` <tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('\n')}
</tileset>`;
const read = () => TSX;
// gid = 1 + TILE_ORDER index: floor 1, gravel 2, water 3, wall 4, exit 5, start 6, key 7, door 8, block 9
const tmx = (data: string, objects = '', props = '', enc = 'csv', w = 3, h = 2) => `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" width="${w}" height="${h}" tilewidth="16" tileheight="16">
 <properties>${props}</properties>
 <tileset firstgid="1" source="tileset.tsx"/>
 <layer id="1" name="terrain" width="${w}" height="${h}"><data encoding="${enc}">
${data}
</data></layer>
 <objectgroup id="2" name="objects">${objects}</objectgroup>
</map>`;

test('parseTileset reads the kind property', () => {
  const m = parseTileset(TSX);
  expect(m.get(0)).toBe('floor');
  expect(m.get(8)).toBe('block');
});

test('CSV terrain + bottom-left anchored objects + properties', () => {
  const l = parseTmx(
    tmx(
      '1,2,3,\n4,1,5',
      '<object id="1" gid="6" x="0" y="16" width="16" height="16"/><object id="2" gid="7" x="16" y="32" width="16" height="16"/>',
      '<property name="name" value="Test"/><property name="initialKeys" type="int" value="-2"/><property name="platinum" type="bool" value="true"/><property name="goldMoves" type="int" value="12"/><property name="goldTime" type="float" value="7.5"/>',
    ),
    'test',
    read,
  );
  expect(l).toEqual({
    id: 'test',
    name: 'Test',
    width: 3,
    height: 2,
    terrain: ['floor', 'gravel', 'water', 'wall', 'floor', 'exit'],
    objects: [{ x: 1, y: 1, kind: 'key' }],
    start: { x: 0, y: 0 },
    initialKeys: -2,
    platinum: true,
    thresholds: { goldMoves: 12, goldTime: 7.5 },
  });
});

test('objects painted directly in the tile layer', () => {
  const l = parseTmx(tmx('6,7,8,\n9,1,5'), 'p', read);
  expect(l.start).toEqual({ x: 0, y: 0 });
  expect(l.terrain.slice(0, 4)).toEqual(['floor', 'floor', 'floor', 'floor']);
  expect(l.objects).toEqual([
    { x: 1, y: 0, kind: 'key' },
    { x: 2, y: 0, kind: 'door' },
    { x: 0, y: 1, kind: 'block' },
  ]);
});

test('flip/rotation bits ignored', () => {
  const flipped = (4 | 0x80000000) >>> 0; // horizontally flipped wall
  const l = parseTmx(tmx(`6,1,1,\n${flipped},1,5`), 'f', read);
  expect(l.terrain[3]).toBe('wall');
});

test('non-square map accepted', () => {
  const l = parseTmx(tmx('6,1,1,1,5', '', '', 'csv', 5, 1), 'r', read);
  expect([l.width, l.height]).toEqual([5, 1]);
});

test('non-CSV encoding: explicit message', () => {
  expect(() => parseTmx(tmx('AAAA', '', '', 'base64'), 'b', read)).toThrow(/CSV/);
});

test('empty tile and missing/multiple start rejected', () => {
  expect(() => parseTmx(tmx('6,0,1,\n1,1,5'), 'v', read)).toThrow(/empty tile at \(1,0\)/);
  expect(() => parseTmx(tmx('1,1,1,\n1,1,5'), 'n', read)).toThrow(/exactly one start/);
  expect(() => parseTmx(tmx('6,6,1,\n1,1,5'), 'm', read)).toThrow(/exactly one start/);
});

test('terrain placed as an object rejected', () => {
  expect(() => parseTmx(tmx('6,1,1,\n1,1,5', '<object id="1" gid="4" x="16" y="16"/>'), 'o', read)).toThrow(/terrain/);
});
```

- [ ] **Step 3: Run** `npx vitest run packages/tiled` → FAIL.

- [ ] **Step 4: Implement `xml.ts`, `tileset.ts`, `tmx.ts`**

`xml.ts`:
```ts
import { XMLParser } from 'fast-xml-parser';

const ARRAYS = new Set(['map', 'tileset', 'tile', 'property', 'layer', 'objectgroup', 'object']);

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

export type XmlNode = Record<string, unknown>;
export const arr = (v: unknown): XmlNode[] => (Array.isArray(v) ? (v as XmlNode[]) : v && typeof v === 'object' ? [v as XmlNode] : []);
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function properties(node: XmlNode | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const props of arr(node?.properties)) {
    for (const p of arr(props.property)) {
      const name = str(p.name);
      if (name) m.set(name, str(p.value) ?? str(p['#text']) ?? '');
    }
  }
  return m;
}
```

`tileset.ts`:
```ts
import type { TileKind } from '@puzzlecave/core';
import { arr, properties, str, xmlParser, type XmlNode } from './xml';

export const TILE_ORDER: readonly TileKind[] = [
  'floor', 'gravel', 'water', 'wall', 'exit', 'start', 'key', 'door', 'block',
];
const KINDS = new Set<string>(TILE_ORDER);

export function tilesetKinds(node: XmlNode): Map<number, TileKind> {
  const m = new Map<number, TileKind>();
  for (const tile of arr(node.tile)) {
    const kind = properties(tile).get('kind');
    if (kind === undefined) continue;
    if (!KINDS.has(kind)) throw new Error(`tile ${str(tile.id)}: unknown kind "${kind}"`);
    m.set(Number(str(tile.id)), kind as TileKind);
  }
  return m;
}

export function parseTileset(xml: string): Map<number, TileKind> {
  const doc = xmlParser.parse(xml) as XmlNode;
  const ts = arr(doc.tileset)[0];
  if (!ts) throw new Error('tileset file without <tileset>');
  return tilesetKinds(ts);
}
```

`tmx.ts`:
```ts
import type { LevelData, LevelObject, ObjKind, Pos, Terrain, ThresholdOverrides, TileKind } from '@puzzlecave/core';
import { parseTileset, tilesetKinds } from './tileset';
import { arr, properties, str, xmlParser, type XmlNode } from './xml';

const TERRAINS = new Set<TileKind>(['floor', 'gravel', 'water', 'wall', 'exit']);
const THRESHOLD_KEYS: (keyof ThresholdOverrides)[] = [
  'goldMoves', 'silverMoves', 'bronzeMoves', 'goldTime', 'silverTime', 'bronzeTime', 'platinumTime',
];
const FLIP_MASK = 0x1fffffff;

export function parseTmx(xml: string, id: string, readTileset: (source: string) => string): LevelData {
  const doc = xmlParser.parse(xml) as XmlNode;
  const map = arr(doc.map)[0];
  if (!map) throw new Error('file without <map>');
  const width = Number(str(map.width));
  const height = Number(str(map.height));
  const tw = Number(str(map.tilewidth));
  const th = Number(str(map.tileheight));

  const sets = arr(map.tileset)
    .map((ts) => {
      const source = str(ts.source);
      const kinds = source ? parseTileset(readTileset(source)) : tilesetKinds(ts);
      return { firstgid: Number(str(ts.firstgid)), kinds };
    })
    .sort((a, b) => b.firstgid - a.firstgid);

  const kindOf = (rawGid: number, where: string): TileKind => {
    const gid = (rawGid >>> 0) & FLIP_MASK;
    if (gid === 0) throw new Error(`empty tile ${where}`);
    const set = sets.find((s) => s.firstgid <= gid);
    const kind = set?.kinds.get(gid - set.firstgid);
    if (!kind) throw new Error(`tile ${gid} without kind property ${where}`);
    return kind;
  };

  const layers = arr(map.layer);
  const layer = layers.find((l) => str(l.name) === 'terrain') ?? layers[0];
  if (!layer) throw new Error('no tile layer');
  const data = arr(layer.data)[0];
  const enc = str(data?.encoding) ?? 'xml';
  if (enc !== 'csv') {
    throw new Error(
      `layer encoding "${enc}" not supported: in Tiled, Map > Map Properties > Tile Layer Format = CSV`,
    );
  }
  const cells = (str(data?.['#text']) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map(Number);
  if (cells.length !== width * height) {
    throw new Error(`terrain layer: ${cells.length} tiles instead of ${width * height}`);
  }

  const terrain: Terrain[] = [];
  const objects: LevelObject[] = [];
  const starts: Pos[] = [];
  const place = (kind: TileKind, x: number, y: number) => {
    if (kind === 'start') starts.push({ x, y });
    else objects.push({ x, y, kind: kind as ObjKind });
  };
  cells.forEach((gid, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    const kind = kindOf(gid, `at (${x},${y})`);
    if (TERRAINS.has(kind)) terrain.push(kind as Terrain);
    else {
      terrain.push('floor');
      place(kind, x, y);
    }
  });

  for (const group of arr(map.objectgroup)) {
    for (const o of arr(group.object)) {
      const gidStr = str(o.gid);
      if (!gidStr) continue;
      const x = Math.round(Number(str(o.x) ?? 0) / tw);
      const y = Math.round(Number(str(o.y) ?? 0) / th) - 1;
      const kind = kindOf(Number(gidStr), `(object ${str(o.id)})`);
      if (TERRAINS.has(kind)) {
        throw new Error(`object ${str(o.id)}: a terrain tile (${kind}) cannot be an object`);
      }
      place(kind, x, y);
    }
  }
  if (starts.length !== 1) throw new Error(`exactly one start required, found ${starts.length}`);

  const props = properties(map);
  const thresholds: ThresholdOverrides = {};
  for (const k of THRESHOLD_KEYS) {
    const v = props.get(k);
    if (v !== undefined && v !== '') thresholds[k] = Number(v);
  }
  const author = props.get('author');
  return {
    id,
    name: props.get('name') || id,
    ...(author ? { author } : {}),
    width,
    height,
    terrain,
    objects,
    start: starts[0]!,
    initialKeys: Number(props.get('initialKeys') ?? 0),
    platinum: props.get('platinum') === 'true',
    thresholds,
  };
}
```

Note on fast-xml-parser: `<data encoding="csv">1,2</data>` yields `{ encoding: 'csv', '#text': '1,2' }`; the text content of an element without attributes is a string — `arr()` handles object or array. If the parser returns `data` as a plain string, adapt `arr(layer.data)` accordingly and report it.

`index.ts`: `export * from './tileset'; export * from './tmx'; export * from './write'; export * from './pack';` (create `write.ts`/`pack.ts` with `export {};` for the duration of the reading tests).

- [ ] **Step 5: Run** `npx vitest run packages/tiled/src/tmx.test.ts` → PASS.

- [ ] **Step 6: Writing tests (they fail)**

`packages/tiled/src/write.test.ts`:
```ts
import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { parseTmx, setMapProperty, TILE_ORDER, writeTmx } from './index';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;
const read = () => TSX;

test('writeTmx → parseTmx gives back the same level', () => {
  const level = fromAscii(['@k,.', '~BDE'], {
    id: 'rt',
    name: 'Round trip',
    author: 'moineau',
    initialKeys: -1,
    platinum: true,
    thresholds: { goldMoves: 9 },
  });
  expect(parseTmx(writeTmx(level), 'rt', read)).toEqual(level);
});

test('setMapProperty adds then replaces a property', () => {
  let xml = writeTmx(fromAscii(['@E'], { id: 'p' }));
  xml = setMapProperty(xml, 'goldMoves', 1);
  expect(parseTmx(xml, 'p', read).thresholds.goldMoves).toBe(1);
  xml = setMapProperty(xml, 'goldMoves', 3);
  expect(parseTmx(xml, 'p', read).thresholds.goldMoves).toBe(3);
  expect(xml.match(/name="goldMoves"/g)).toHaveLength(1);
});

test('setMapProperty creates <properties> if missing', () => {
  const xml = writeTmx(fromAscii(['@E'], { id: 'q' })).replace(/ <properties>[\s\S]*?<\/properties>\n/, '');
  expect(xml).not.toContain('<properties>');
  expect(parseTmx(setMapProperty(xml, 'platinum', true), 'q', read).platinum).toBe(true);
});
```

- [ ] **Step 7: Implement `write.ts`**

```ts
import type { LevelData, ThresholdOverrides, TileKind } from '@puzzlecave/core';
import { TILE_ORDER } from './tileset';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gidOf = (k: TileKind) => TILE_ORDER.indexOf(k) + 1;

function propLine(name: string, value: string | number | boolean): string {
  const type =
    typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : undefined;
  return `  <property name="${esc(name)}"${type ? ` type="${type}"` : ''} value="${esc(String(value))}"/>`;
}

export function writeTmx(level: LevelData, tilesetSource = 'tileset.tsx'): string {
  const { width: w, height: h } = level;
  const props: string[] = [propLine('name', level.name)];
  if (level.author) props.push(propLine('author', level.author));
  if (level.initialKeys !== 0) props.push(propLine('initialKeys', level.initialKeys));
  if (level.platinum) props.push(propLine('platinum', true));
  for (const [k, v] of Object.entries(level.thresholds) as [keyof ThresholdOverrides, number | undefined][]) {
    if (v !== undefined) props.push(propLine(k, v));
  }
  const rows: string[] = [];
  for (let y = 0; y < h; y++) rows.push(level.terrain.slice(y * w, (y + 1) * w).map(gidOf).join(','));
  const objs = [{ ...level.start, kind: 'start' as TileKind }, ...level.objects].map(
    (o, i) =>
      `  <object id="${i + 1}" gid="${gidOf(o.kind)}" x="${o.x * 16}" y="${(o.y + 1) * 16}" width="16" height="16"/>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="16" tileheight="16" infinite="0" nextlayerid="3" nextobjectid="${objs.length + 1}">
 <properties>
${props.join('\n')}
 </properties>
 <tileset firstgid="1" source="${esc(tilesetSource)}"/>
 <layer id="1" name="terrain" width="${w}" height="${h}">
  <data encoding="csv">
${rows.join(',\n')}
</data>
 </layer>
 <objectgroup id="2" name="objects">
${objs.join('\n')}
 </objectgroup>
</map>
`;
}

export function setMapProperty(xml: string, name: string, value: string | number | boolean): string {
  const line = propLine(name, value);
  const existing = new RegExp(`^[ \\t]*<property name="${name}"[^>]*/>[ \\t]*$`, 'm');
  const mapOpen = /<map\b[^>]*>/.exec(xml);
  if (!mapOpen) throw new Error('file without <map>');
  const afterMap = mapOpen.index + mapOpen[0].length;
  const rel = xml.slice(afterMap).search(/<(tileset|layer|objectgroup|properties)\b/);
  const start = afterMap + rel;
  if (rel >= 0 && xml.startsWith('<properties>', start)) {
    const end = xml.indexOf('</properties>', start);
    const block = xml.slice(start, end);
    const replaced = existing.test(block) ? block.replace(existing, line) : `${block.trimEnd()}\n${line}\n `;
    return xml.slice(0, start) + replaced + xml.slice(end);
  }
  return `${xml.slice(0, afterMap)}\n <properties>\n${line}\n </properties>${xml.slice(afterMap)}`;
}
```

- [ ] **Step 8: Run** `npx vitest run packages/tiled/src/write.test.ts` → PASS.

- [ ] **Step 9: Pack tests (they fail)**

`packages/tiled/src/pack.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { loadPack, TILE_ORDER, writeTmx } from './index';

const TSX = `<?xml version="1.0" encoding="UTF-8"?>\n<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-pack-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
const chapters = (levels: string[]) =>
  JSON.stringify([{ id: 'c1', name: { fr: 'Un', en: 'One' }, unlockAfter: 0, levels }]);
const emptyCell = (xml: string) => xml.replace(/<data encoding="csv">\n(\d+)/, '<data encoding="csv">\n0');

test('loads levels and chapters, lists the files to watch', () => {
  const dir = fixture({
    'tileset.tsx': TSX,
    'a.tmx': writeTmx(fromAscii(['@E'], { id: 'a' })),
    'chapters.json': chapters(['a']),
  });
  const pack = loadPack(dir);
  expect(pack.errors).toEqual([]);
  expect(pack.levels.map((l) => l.id)).toEqual(['a']);
  expect(pack.chapters[0]?.levels).toEqual(['a']);
  expect(pack.files.map((f) => basename(f)).sort()).toEqual(['a.tmx', 'chapters.json', 'tileset.tsx']);
});

test('collects errors per file', () => {
  const dir = fixture({
    'tileset.tsx': TSX,
    'bad.tmx': emptyCell(writeTmx(fromAscii(['@E'], { id: 'bad' }))),
    'nox.tmx': writeTmx(fromAscii(['@.'], { id: 'nox' })),
    'chapters.json': chapters(['bad', 'nox', 'ghost']),
  });
  const { errors } = loadPack(dir);
  expect(errors).toContainEqual(expect.stringMatching(/^bad\.tmx: empty tile/));
  expect(errors).toContainEqual(expect.stringMatching(/^nox\.tmx: no exit/));
  expect(errors).toContainEqual(expect.stringMatching(/"ghost" unknown/));
});

test('chapters.json missing', () => {
  const dir = fixture({ 'tileset.tsx': TSX, 'a.tmx': writeTmx(fromAscii(['@E'], { id: 'a' })) });
  expect(loadPack(dir).errors).toContainEqual(expect.stringMatching(/chapters\.json missing/));
});
```

- [ ] **Step 10: Implement `pack.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { validateChapters, validateLevel, type Chapter, type LevelData } from '@puzzlecave/core';
import { parseTmx } from './tmx';

export interface LevelPack {
  levels: LevelData[];
  chapters: Chapter[];
  errors: string[];
  files: string[];
}

export function loadPack(dir: string): LevelPack {
  const levels: LevelData[] = [];
  const errors: string[] = [];
  const files = new Set<string>();
  const tmxFiles = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.tmx')).sort() : [];

  for (const file of tmxFiles) {
    const path = join(dir, file);
    files.add(path);
    const id = file.slice(0, -'.tmx'.length);
    try {
      const level = parseTmx(readFileSync(path, 'utf8'), id, (source) => {
        const tsPath = resolve(dirname(path), source);
        files.add(tsPath);
        return readFileSync(tsPath, 'utf8');
      });
      const errs = validateLevel(level);
      if (errs.length) errors.push(...errs.map((e) => `${file}: ${e}`));
      else levels.push(level);
    } catch (err) {
      errors.push(`${file}: ${(err as Error).message}`);
    }
  }

  let chapters: Chapter[] = [];
  const chaptersPath = join(dir, 'chapters.json');
  if (existsSync(chaptersPath)) {
    files.add(chaptersPath);
    try {
      const raw: unknown = JSON.parse(readFileSync(chaptersPath, 'utf8'));
      const ids = new Set(tmxFiles.map((f) => f.slice(0, -'.tmx'.length)));
      const errs = validateChapters(raw, ids);
      if (errs.length) errors.push(...errs.map((e) => `chapters.json: ${e}`));
      else chapters = raw as Chapter[];
    } catch (err) {
      errors.push(`chapters.json: ${(err as Error).message}`);
    }
  } else if (tmxFiles.length) {
    errors.push('chapters.json missing');
  }

  return { levels, chapters, errors, files: [...files] };
}
```

- [ ] **Step 11: Run** `npx vitest run packages/tiled && npm run typecheck` → PASS.
- [ ] **Step 12: Commit** `feat(tiled): TMX reading/writing and loading of the levels folder` (+ trailer).

---

### Task 8: core — solver

**Files:**
- Create: `packages/core/src/solver.ts`; Modify: `index.ts`
- Test: `packages/core/src/solver.test.ts`

**Interfaces:**
- Consumes: `initialState`, `step`, `DIRS`, `replay`, `fromAscii`.
- Produces:
  - `type SolveResult = { status: 'solved'; moves: Dir[]; explored: number } | { status: 'unsolvable'; explored: number } | { status: 'timeout'; explored: number }`
  - `interface SolveOptions { maxStates?: number; timeoutMs?: number; now?: () => number }` (defaults: 3,000,000 states, 60,000 ms, `performance.now`)
  - `solve(level: LevelData, opts?: SolveOptions): SolveResult` — BFS in normal mode; solution of **minimal** length in moves.

- [ ] **Step 1: Tests (they fail)**

```ts
import { expect, test } from 'vitest';
import { fromAscii } from './ascii';
import { replay } from './replay';
import { solve } from './solver';

test('solves a corridor', () => {
  expect(solve(fromAscii(['@..E']))).toMatchObject({ status: 'solved', moves: ['right', 'right', 'right'] });
});

test('finds the shortest solution', () => {
  const level = fromAscii(['@...', '.##.', '...E']);
  const r = solve(level);
  expect(r.status).toBe('solved');
  if (r.status === 'solved') {
    expect(r.moves).toHaveLength(5);
    expect(replay(level, r.moves).status).toBe('won');
  }
});

test('uses keys, doors and blocks', () => {
  // key at (1,0), door at (1,1); the block at (2,0) must fill the water (3,0) to reach E
  const level = fromAscii(['@kB~E', '#D###', '#.###']);
  const r = solve(level);
  expect(r.status).toBe('solved');
  if (r.status === 'solved') expect(replay(level, r.moves).status).toBe('won');
});

test('detects an unsolvable level', () => {
  expect(solve(fromAscii(['@#E'])).status).toBe('unsolvable');
});

test('stops on the state limit', () => {
  const rows = Array.from({ length: 12 }, (_, y) =>
    y === 0 ? '@' + '.'.repeat(11) : y === 11 ? '.'.repeat(11) + 'E' : '.'.repeat(12),
  );
  expect(solve(fromAscii(rows), { maxStates: 5 }).status).toBe('timeout');
});

test('stops on the time limit', () => {
  let t = 0;
  expect(solve(fromAscii(['@' + '.'.repeat(30) + 'E']), { timeoutMs: 10, now: () => (t += 100) }).status).toBe('timeout');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { DIRS, initialState } from './state';
import { step } from './step';
import type { Dir, GameState, LevelData } from './types';

export type SolveResult =
  | { status: 'solved'; moves: Dir[]; explored: number }
  | { status: 'unsolvable'; explored: number }
  | { status: 'timeout'; explored: number };

export interface SolveOptions {
  maxStates?: number;
  timeoutMs?: number;
  now?: () => number;
}

const OBJ_CHAR = { key: 'k', door: 'd', block: 'b' } as const;

export function solve(level: LevelData, opts: SolveOptions = {}): SolveResult {
  const maxStates = opts.maxStates ?? 3_000_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const now = opts.now ?? (() => performance.now());
  const t0 = now();

  const start = initialState(level, 'normal');
  const waterCells = start.terrain.flatMap((t, i) => (t === 'water' ? [i] : []));
  // facing is not part of the key: it does not affect the possible moves
  const keyOf = (s: GameState): string => {
    let k = `${s.player.x},${s.player.y},${s.keys}|`;
    for (const o of s.objects) k += o === null ? '.' : OBJ_CHAR[o];
    k += '|';
    for (const i of waterCells) k += s.terrain[i] === 'water' ? '1' : '0';
    return k;
  };

  const seen = new Set<string>([keyOf(start)]);
  const parent: number[] = [-1];
  const via: Dir[] = ['up'];
  const queue: (GameState | undefined)[] = [start];
  const ids: number[] = [0];

  const rebuild = (id: number): Dir[] => {
    const moves: Dir[] = [];
    for (let i = id; i > 0; i = parent[i]!) moves.push(via[i]!);
    return moves.reverse();
  };

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const curId = ids[head]!;
    queue[head] = undefined;
    if ((head & 1023) === 0 && now() - t0 > timeoutMs) return { status: 'timeout', explored: seen.size };
    for (const dir of DIRS) {
      const next = step(cur, dir).state;
      if (next.moves === cur.moves || next.status === 'drowned') continue;
      if (next.status === 'won') {
        parent.push(curId);
        via.push(dir);
        return { status: 'solved', moves: rebuild(parent.length - 1), explored: seen.size };
      }
      const key = keyOf(next);
      if (seen.has(key)) continue;
      if (seen.size >= maxStates) return { status: 'timeout', explored: seen.size };
      seen.add(key);
      parent.push(curId);
      via.push(dir);
      queue.push(next);
      ids.push(parent.length - 1);
    }
  }
  return { status: 'unsolvable', explored: seen.size };
}
```

- [ ] **Step 4: Export, Run** tests + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(core): BFS solver (move-optimal solution)` (+ trailer).

---

### Task 9: tools — `validate` and `solve` CLI

**Files:**
- Create: `packages/tools/package.json`, `src/paths.ts`, `src/commands.ts`, `src/cli.ts`
- Test: `packages/tools/src/commands.test.ts`

**Interfaces:**
- Consumes: `loadPack`, `setMapProperty`, `writeTmx`, `TILE_ORDER` (Task 7); `solve`, `replay`, `parseMoves`, `formatMoves`, `fromAscii` (core).
- Produces:
  - `LEVELS_DIR: string` (absolute path of `REPO/levels`)
  - `validateCommand(dir: string): { ok: boolean; lines: string[] }` — pack errors + replay of `solutions/<id>.txt` (must end `won`); last line `N level(s) loaded, M solution(s) replayed` followed by ` — OK` if everything is fine
  - `solveCommand(dir: string, ids: string[] | 'all', opts: { timeoutMs: number; maxStates: number; apply: boolean; force: boolean }): { ok: boolean; lines: string[] }` — one line per level, starting with its id; with `apply`, writes `solutions/<id>.txt` and sets `goldMoves` in the `.tmx` if absent (always with `force`)
  - CLI: `npm run validate`; `npm run solve -- <id…>|--all [--timeout <s>] [--max-states <n>] [--apply] [--force]`

- [ ] **Step 1: Package**

`packages/tools/package.json`:
```json
{
  "name": "@puzzlecave/tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@puzzlecave/core": "*", "@puzzlecave/tiled": "*" }
}
```
Run: `npm install`.

`src/paths.ts`:
```ts
import { fileURLToPath } from 'node:url';

export const LEVELS_DIR = fileURLToPath(new URL('../../../levels', import.meta.url));
```

- [ ] **Step 2: Tests (they fail)**

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fromAscii } from '@puzzlecave/core';
import { TILE_ORDER, writeTmx } from '@puzzlecave/tiled';
import { solveCommand, validateCommand } from './commands';

const TSX = `<tileset name="pc" tilewidth="16" tileheight="16">${TILE_ORDER.map((k, i) => `<tile id="${i}"><properties><property name="kind" value="${k}"/></properties></tile>`).join('')}</tileset>`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-tools-'));
  writeFileSync(join(dir, 'tileset.tsx'), TSX);
  writeFileSync(join(dir, 'a.tmx'), writeTmx(fromAscii(['@..E'], { id: 'a' })));
  writeFileSync(join(dir, 'z.tmx'), writeTmx(fromAscii(['@#E'], { id: 'z' })));
  writeFileSync(
    join(dir, 'chapters.json'),
    JSON.stringify([{ id: 'c', name: { fr: 'C', en: 'C' }, unlockAfter: 0, levels: ['a', 'z'] }]),
  );
  return dir;
}
const opts = { timeoutMs: 5000, maxStates: 100_000, apply: false, force: false };
const tmxOf = (dir: string) => readFileSync(join(dir, 'a.tmx'), 'utf8');

test('validate: OK without solutions', () => {
  const r = validateCommand(fixture());
  expect(r.ok).toBe(true);
  expect(r.lines.at(-1)).toMatch(/2 level\(s\) loaded, 0 solution\(s\) replayed — OK/);
});

test('validate: a solution that does not win is an error', () => {
  const dir = fixture();
  mkdirSync(join(dir, 'solutions'));
  writeFileSync(join(dir, 'solutions', 'a.txt'), 'RR\n');
  const r = validateCommand(dir);
  expect(r.ok).toBe(false);
  expect(r.lines.join('\n')).toMatch(/a: the solution does not win/);
});

test('solve --apply writes the solution and goldMoves, without overwriting unless --force', () => {
  const dir = fixture();
  expect(solveCommand(dir, ['a'], { ...opts, apply: true }).ok).toBe(true);
  expect(readFileSync(join(dir, 'solutions', 'a.txt'), 'utf8')).toBe('RRR\n');
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
  expect(validateCommand(dir).ok).toBe(true);

  writeFileSync(join(dir, 'a.tmx'), tmxOf(dir).replace('name="goldMoves" type="int" value="3"', 'name="goldMoves" type="int" value="7"'));
  solveCommand(dir, ['a'], { ...opts, apply: true });
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="7"/);
  solveCommand(dir, ['a'], { ...opts, apply: true, force: true });
  expect(tmxOf(dir)).toMatch(/name="goldMoves" type="int" value="3"/);
});

test('solve reports an unsolvable level and an unknown id', () => {
  const dir = fixture();
  const r = solveCommand(dir, ['z', 'nope'], opts);
  expect(r.ok).toBe(false);
  expect(r.lines.join('\n')).toMatch(/z: unsolvable/);
  expect(r.lines.join('\n')).toMatch(/nope: unknown level/);
  expect(existsSync(join(dir, 'solutions', 'z.txt'))).toBe(false);
});

test('solve --all handles every level', () => {
  const r = solveCommand(fixture(), 'all', opts);
  expect(r.lines.some((l) => l.startsWith('a:'))).toBe(true);
  expect(r.lines.some((l) => l.startsWith('z:'))).toBe(true);
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement `commands.ts` and `cli.ts`**

```ts
// src/commands.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatMoves, parseMoves, replay, solve } from '@puzzlecave/core';
import { loadPack, setMapProperty } from '@puzzlecave/tiled';

export interface CommandResult {
  ok: boolean;
  lines: string[];
}

export function validateCommand(dir: string): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let checked = 0;
  for (const level of pack.levels) {
    const file = join(dir, 'solutions', `${level.id}.txt`);
    if (!existsSync(file)) continue;
    checked++;
    try {
      const end = replay(level, parseMoves(readFileSync(file, 'utf8')));
      if (end.status !== 'won') lines.push(`${level.id}: the solution does not win (status ${end.status})`);
    } catch (err) {
      lines.push(`${level.id}: unreadable solution — ${(err as Error).message}`);
    }
  }
  const ok = lines.length === 0;
  lines.push(`${pack.levels.length} level(s) loaded, ${checked} solution(s) replayed${ok ? ' — OK' : ''}`);
  return { ok, lines };
}

export interface SolveCommandOptions {
  timeoutMs: number;
  maxStates: number;
  apply: boolean;
  force: boolean;
}

export function solveCommand(dir: string, ids: string[] | 'all', o: SolveCommandOptions): CommandResult {
  const pack = loadPack(dir);
  const lines = [...pack.errors];
  let ok = pack.errors.length === 0;
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const wanted = ids === 'all' ? pack.levels.map((l) => l.id) : ids;
  for (const id of wanted) {
    const level = byId.get(id);
    if (!level) {
      lines.push(`${id}: unknown level`);
      ok = false;
      continue;
    }
    const r = solve(level, { timeoutMs: o.timeoutMs, maxStates: o.maxStates });
    if (r.status === 'solved') {
      lines.push(`${id}: ${r.moves.length} moves (${r.explored} states) — suggested goldMoves = ${r.moves.length}`);
      if (o.apply) {
        mkdirSync(join(dir, 'solutions'), { recursive: true });
        writeFileSync(join(dir, 'solutions', `${id}.txt`), formatMoves(r.moves));
        if (o.force || level.thresholds.goldMoves === undefined) {
          const tmx = join(dir, `${id}.tmx`);
          writeFileSync(tmx, setMapProperty(readFileSync(tmx, 'utf8'), 'goldMoves', r.moves.length));
        }
      }
    } else {
      ok = false;
      lines.push(
        r.status === 'unsolvable'
          ? `${id}: unsolvable (${r.explored} states)`
          : `${id}: limit reached without a solution (${r.explored} states)`,
      );
    }
  }
  return { ok, lines };
}
```

```ts
// src/cli.ts
import { solveCommand, validateCommand, type CommandResult } from './commands';
import { LEVELS_DIR } from './paths';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const VALUED = new Set(['--timeout', '--max-states']);

let result: CommandResult;
if (cmd === 'validate') {
  result = validateCommand(LEVELS_DIR);
} else if (cmd === 'solve') {
  const ids = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? ''));
  result = solveCommand(LEVELS_DIR, flag('--all') ? 'all' : ids, {
    timeoutMs: value('--timeout', 60) * 1000,
    maxStates: value('--max-states', 3_000_000),
    apply: flag('--apply'),
    force: flag('--force'),
  });
} else {
  console.error('usage: validate | solve <id…>|--all [--timeout s] [--max-states n] [--apply] [--force]');
  process.exit(2);
}
for (const line of result.lines) console.log(line);
process.exit(result.ok ? 0 : 1);
```

- [ ] **Step 5: Run** `npx vitest run packages/tools && npm run typecheck` → PASS. Then `npm run validate` (`levels/` folder missing or empty) → `0 level(s) loaded, 0 solution(s) replayed — OK`, exit code 0.
- [ ] **Step 6: Commit** `feat(tools): validate and solve commands` (+ trailer).

---

### Task 10: Content — tileset, 5 puzzleCave levels, classic levels by "moineau", chapters, solutions

**Files:**
- Create: `levels/tileset.png`, `levels/tileset.tsx`, `levels/pc-01.tmx` … `levels/pc-11.tmx`, `levels/pc-12.tmx` …, `levels/chapters.json`, `levels/solutions/*.txt`, `CREDITS.md`
- Create (NOT committed): `ONESHOT/*`
- Test: `packages/tools/src/levels.test.ts`

**Interfaces:**
- Consumes: `writeTmx`, `TILE_ORDER`, `loadPack` (Task 7); `LevelData`, `assertValidLevel` (core); `npm run validate`, `npm run solve`.
- Produces: ids `pc-01`…`pc-11` (chapter `puzzlecave`) and `pc-12`… (chapter `classic`); `levels/solutions/pc-01.txt` (used by the e2e).

Sources:
- Original puzzleCave: `LEGACY/levels/` (`level_1.tmx`, `level_2.tmx`, `level_3.tmx`, `level_4.tmx`, `level_3_1.tmx`, `textures/*.png`). Old format: `terrain` layer as `<tile gid>` elements; terrain gid 1 TERRE→floor, 2 GRAVIER→gravel, 3 EAU→water, 4 MUR→wall, 5 SORTIE→exit; object group gid 6 JOUEUR→start, 7 PORTE→door, 8 CLE→key, 9 BLOC→block; object row = `y/16 - 1`, column = `x/16`; optional map property `INITIAL_KEYS`.
- Original order (`LevelLibrary.as`): `level_1, level_2, level_3, level_4, level_3_1` → `pc-01` … `pc-11`, names "Niveau 1" … "Niveau 5", author `moineau`.
- Classic levels by "moineau": 19 levels (after removing 4 "test" maps), 18×18 boards, available as a prepared JSON file (`ONESHOT/classic-maps.json`, an array of `{ name, startX, startY, keys, board }` where `board` is a string of 324 digits, index `y*18+x`). Conversion: `0`→floor, `1`→wall, `2`→floor+block, `3`→water, `4`→exit, `5`→floor+key, `6`→floor+door, `7`→wall, `8`→gravel. `startX/startY`→start, `keys`→initialKeys, any time limit ignored. ids `pc-12`, `pc-13`, … in order, original names kept (the 2nd occurrence of a same name gets ` (v2)`), author `moineau`.

- [ ] **Step 1: Prepare the one-shot folder**

```bash
ONESHOT=C:/Users/Steven/.claude/jobs/35ce9751/tmp/oneshot
mkdir -p $ONESHOT && cd $ONESHOT && npm init -y >/dev/null && npm install pngjs@latest fast-xml-parser@latest
```
The one-shot `.ts` scripts import `@puzzlecave/*`: run them **from `REPO`** with `npx tsx $ONESHOT/<script>.ts` after copying the script into `REPO/.oneshot/` (ignored folder: add `.oneshot/` to `.gitignore`) — otherwise workspace package resolution fails. The workspace's `fast-xml-parser` (`packages/tiled`) is then usable.

- [ ] **Step 2: Generate `levels/tileset.png`** (144×16, 9 tiles in `TILE_ORDER` order)

```js
// ONESHOT/tileset.mjs — node ONESHOT/tileset.mjs <output.png>
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const T = 'C:/Users/Steven/IdeaProjects/puzzleCave-legacy/levels/textures/';
const load = (n) => PNG.sync.read(readFileSync(T + n + '.png'));
const out = new PNG({ width: 144, height: 16 });
function blit(src, dx, sy = 0) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const s = ((y + sy) * src.width + x) * 4;
      const d = (y * 144 + dx + x) * 4;
      const a = src.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) out.data[d + c] = Math.round(src.data[s + c] * a + out.data[d + c] * (1 - a));
      out.data[d + 3] = Math.max(out.data[d + 3], src.data[s + 3]);
    }
}
['TERRE', 'GRAVIER', 'EAU', 'MUR', 'SORTIE'].forEach((n, i) => blit(load(n), i * 16));
blit(load('TERRE'), 80);
blit(load('perso'), 80, 2); // perso is 16×18: keep the bottom 16 rows
['CLE', 'PORTE', 'BLOC'].forEach((n, i) => blit(load(n), (6 + i) * 16));
writeFileSync(process.argv[2], PNG.sync.write(out));
```
Run: `node $ONESHOT/tileset.mjs REPO/levels/tileset.png` (with the absolute path of `REPO`). Open the image (Read tool) to visually check the 9 tiles. If the objects (`CLE`, `PORTE`, `BLOC`) have a transparent background, also compose them over `TERRE` as for `start`.

- [ ] **Step 3: Write `levels/tileset.tsx`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.2" name="puzzlecave" tilewidth="16" tileheight="16" tilecount="9" columns="9">
 <image source="tileset.png" width="144" height="16"/>
 <tile id="0"><properties><property name="kind" value="floor"/></properties></tile>
 <tile id="1"><properties><property name="kind" value="gravel"/></properties></tile>
 <tile id="2"><properties><property name="kind" value="water"/></properties></tile>
 <tile id="3"><properties><property name="kind" value="wall"/></properties></tile>
 <tile id="4"><properties><property name="kind" value="exit"/></properties></tile>
 <tile id="5"><properties><property name="kind" value="start"/></properties></tile>
 <tile id="6"><properties><property name="kind" value="key"/></properties></tile>
 <tile id="7"><properties><property name="kind" value="door"/></properties></tile>
 <tile id="8"><properties><property name="kind" value="block"/></properties></tile>
</tileset>
```

- [ ] **Step 4: Convert the 5 puzzleCave levels**

```ts
// REPO/.oneshot/convert-pc.ts — from REPO: npx tsx .oneshot/convert-pc.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { assertValidLevel, type LevelData, type LevelObject, type Terrain } from '@puzzlecave/core';
import { writeTmx } from '@puzzlecave/tiled';

const SRC = 'C:/Users/Steven/IdeaProjects/puzzleCave-legacy/levels/';
const DST = new URL('../levels/', import.meta.url);
const TERR: Record<number, Terrain> = { 1: 'floor', 2: 'gravel', 3: 'water', 4: 'wall', 5: 'exit' };
const OBJ = { 7: 'door', 8: 'key', 9: 'block' } as const;
const p = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (n) => ['tile', 'object', 'property'].includes(n),
});

['level_1', 'level_2', 'level_3', 'level_4', 'level_3_1'].forEach((file, i) => {
  const map = p.parse(readFileSync(`${SRC}${file}.tmx`, 'utf8')).map;
  const width = Number(map.width);
  const height = Number(map.height);
  const terrain: Terrain[] = map.layer.data.tile.map((t: { gid: string }) => {
    const v = TERR[Number(t.gid)];
    if (!v) throw new Error(`${file}: terrain gid ${t.gid}`);
    return v;
  });
  const objects: LevelObject[] = [];
  let start = { x: -1, y: -1 };
  for (const o of map.objectgroup.object) {
    const x = Math.round(Number(o.x) / 16);
    const y = Math.round(Number(o.y) / 16) - 1;
    const gid = Number(o.gid);
    if (gid === 6) start = { x, y };
    else objects.push({ x, y, kind: OBJ[gid as 7 | 8 | 9] });
  }
  const keysProp = (map.properties?.property ?? []).find((q: { name: string }) => q.name === 'INITIAL_KEYS');
  const id = `pc-0${i + 1}`;
  const level: LevelData = {
    id, name: `Niveau ${i + 1}`, author: 'moineau', width, height, terrain, objects, start,
    initialKeys: Number(keysProp?.value ?? 0), platinum: false, thresholds: {},
  };
  assertValidLevel(level);
  writeFileSync(new URL(`${id}.tmx`, DST), writeTmx(level));
  console.log(id, `${width}x${height}`, objects.length, 'objects');
});
```
If a level fails (object on a forbidden terrain, missing start…), stop and report it: do not silently fix it.

- [ ] **Step 5: Convert the classic levels by "moineau"**

This is a **one-shot conversion script, not part of the repo** (it lives in `ONESHOT` / `.oneshot/` and is never committed). It reads `ONESHOT/classic-maps.json` (see Sources) and writes one `.tmx` per level.

```ts
// REPO/.oneshot/convert-classic.ts — from REPO: npx tsx .oneshot/convert-classic.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { assertValidLevel, type LevelData, type LevelObject, type Terrain } from '@puzzlecave/core';
import { writeTmx } from '@puzzlecave/tiled';

interface Source {
  name: string;
  startX: number;
  startY: number;
  keys: number;
  board: string;
}
const maps: Source[] = JSON.parse(
  readFileSync('C:/Users/Steven/.claude/jobs/35ce9751/tmp/oneshot/classic-maps.json', 'utf8'),
);
const DST = new URL('../levels/', import.meta.url);
const CELL: Record<string, { t: Terrain; o?: LevelObject['kind'] }> = {
  0: { t: 'floor' }, 1: { t: 'wall' }, 2: { t: 'floor', o: 'block' }, 3: { t: 'water' }, 4: { t: 'exit' },
  5: { t: 'floor', o: 'key' }, 6: { t: 'floor', o: 'door' }, 7: { t: 'wall' }, 8: { t: 'gravel' },
};
const seenNames = new Set<string>();
const ids: string[] = [];
maps.forEach((m, n) => {
  const id = `pc-${12 + n}`;
  if (m.board.length !== 324) throw new Error(`${id}: ${m.board.length} tiles`);
  const name = seenNames.has(m.name) ? `${m.name} (v2)` : m.name;
  seenNames.add(m.name);
  const terrain: Terrain[] = [];
  const objects: LevelObject[] = [];
  [...m.board].forEach((c, i) => {
    const cell = CELL[c];
    if (!cell) throw new Error(`${id}: code ${c}`);
    terrain.push(cell.t);
    if (cell.o) objects.push({ x: i % 18, y: Math.floor(i / 18), kind: cell.o });
  });
  const start = { x: m.startX, y: m.startY };
  const kept = objects.filter((o) => o.x !== start.x || o.y !== start.y);
  if (kept.length !== objects.length) console.warn(`${id}: object under the start removed`);
  const level: LevelData = {
    id, name, author: 'moineau', width: 18, height: 18, terrain, objects: kept, start,
    initialKeys: m.keys, platinum: false, thresholds: {},
  };
  try {
    assertValidLevel(level);
  } catch (err) {
    console.error(`SKIPPED: ${(err as Error).message}`);
    return;
  }
  writeFileSync(new URL(`${id}.tmx`, DST), writeTmx(level));
  ids.push(id);
  console.log(id, name, 'keys', m.keys);
});
console.log(ids.length, 'levels', JSON.stringify(ids));
```
Expected: **19** levels. Any "SKIPPED" level or a count other than 19 must appear in the report (id + reason).

- [ ] **Step 6: `levels/chapters.json`**

```json
[
  {
    "id": "puzzlecave",
    "name": { "fr": "puzzleCave", "en": "puzzleCave" },
    "unlockAfter": 0,
    "levels": ["pc-01", "pc-02", "pc-03", "pc-04", "pc-11"]
  },
  {
    "id": "classic",
    "name": { "fr": "Niveaux classiques", "en": "Classic levels" },
    "unlockAfter": 3,
    "levels": ["…paste here the JSON list of ids printed in step 5…"]
  }
]
```

- [ ] **Step 7: Validate** — Run: `npm run validate` → `24 level(s) loaded, 0 solution(s) replayed — OK` (5 + the actual number of classic levels).

- [ ] **Step 8: Solve** — Run: `npm run solve -- --all --apply --timeout 120` (may take several minutes; run it in the background and wait for it to finish). Solved levels get `solutions/<id>.txt` and `goldMoves`. List in the report the **unsolved** levels (limit reached — acceptable) and above all any **unsolvable** level (report it, do not delete it). `pc-01` **must** be solved (required by the e2e); otherwise report it as blocking.

- [ ] **Step 9: Repo level tests**

`packages/tools/src/levels.test.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadPack } from '@puzzlecave/tiled';
import { validateCommand } from './commands';
import { LEVELS_DIR } from './paths';

test('every repo level loads and belongs to a chapter', () => {
  const pack = loadPack(LEVELS_DIR);
  expect(pack.errors).toEqual([]);
  expect(pack.levels.length).toBeGreaterThanOrEqual(20);
  expect(pack.chapters.map((c) => c.id)).toEqual(['puzzlecave', 'classic']);
});

test('every reference solution wins', () => {
  expect(validateCommand(LEVELS_DIR).lines.at(-1)).toMatch(/OK$/);
});

test('pc-01 has a solution (used by the e2e test)', () => {
  expect(existsSync(join(LEVELS_DIR, 'solutions', 'pc-01.txt'))).toBe(true);
});
```
Run: `npx vitest run packages/tools` → PASS.

- [ ] **Step 10: `CREDITS.md`**

```markdown
# Credits

- Design, puzzleCave levels and the classic levels by "moineau": Steven (moineau).
- Music: "RPG Battle Climax" and "Self-Destruct Sequence" — Eric Matyas, www.soundimage.org.
```

- [ ] **Step 11: Commit** — `git status`: check that no file from `.oneshot/` or `ONESHOT` is added. Commit `feat(levels): tileset, 5 puzzleCave levels, classic levels by moineau, solutions` (+ trailer).

---

### Task 11: game — Vite + Phaser 4 skeleton + `virtual:levels` module

**Files:**
- Create: `packages/game/package.json`, `index.html`, `vite.config.ts`, `vite-plugin-levels.ts`, `src/main.ts`, `src/levels.ts`, `src/virtual-levels.d.ts`, `src/debug.ts`, `src/ui.ts`, `src/scenes/BootScene.ts`, `src/scenes/MenuScene.ts` (temporary)
- Copy: `LEGACY/levels/textures/*.png` (except `dungeon_tiles_0.png`) → `packages/game/public/textures/`; `LEGACY/music/RPG-Battle-Climax.mp3` and `Self-Destruct-Sequence.mp3` → `packages/game/public/music/`
- Modify: `tsconfig.json` (`"types": ["node", "vite/client"]`)

**Interfaces:**
- Consumes: `loadPack` (tiled), `LevelData`, `Chapter`, `Medal` (core).
- Produces:
  - module `virtual:levels`: `levels: LevelData[]`, `chapters: Chapter[]`
  - `src/levels.ts`: `levels`, `chapters`, `levelById(id: string): LevelData`, `locate(id: string): { chapterIndex: number; levelIndex: number } | null`
  - `src/debug.ts`: `setDebug(patch: Record<string, unknown>): void` (merges into `window.__pc`)
  - `src/ui.ts`: `dpr(): number`, `px(n: number): number` (= `Math.round(n * dpr())`), `COLORS`, `MEDAL_COLORS`, `textStyle(size, color?)`, `makeButton(scene, x, y, label, onClick, size?): Phaser.GameObjects.Text`, `drawMedal(g, x, y, r, medal: Medal | 'platinum' | undefined): void`
  - Scenes (keys): `'Boot'`, `'Menu'`, `'Options'`, `'Select'`, `'Game'`, `'Result'`
  - Textures loaded under the file name without extension (`FLOOR`, `WALL_NWES`, `player`, …); music `music-menu` (RPG-Battle-Climax) and `music-game` (Self-Destruct-Sequence)
  - `TEXTURES` exported by `BootScene.ts`

- [ ] **Step 1: Package and dependencies**

`packages/game/package.json`:
```json
{
  "name": "@puzzlecave/game",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "e2e": "playwright test"
  },
  "dependencies": { "@puzzlecave/core": "*" },
  "devDependencies": { "@puzzlecave/tiled": "*" }
}
```
Run: `npm install phaser@latest -w @puzzlecave/game && npm install -D vite@latest -w @puzzlecave/game && npm install`.
Check `node_modules/phaser/package.json` → 4.x. **Phaser 4: if an API used in this plan differs, refer to `node_modules/phaser/types/phaser.d.ts`, adapt and report it.**

- [ ] **Step 2: `vite-plugin-levels.ts` plugin and `vite.config.ts`**

```ts
// packages/game/vite-plugin-levels.ts
import type { Plugin } from 'vite';
import { loadPack } from '@puzzlecave/tiled';

const ID = 'virtual:levels';
const RESOLVED = '\0virtual:levels';

export function levelsPlugin(dir: string): Plugin {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  return {
    name: 'puzzlecave-levels',
    resolveId(source) {
      return source === ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const pack = loadPack(dir);
      for (const f of pack.files) this.addWatchFile(f);
      if (pack.errors.length) this.error(`Invalid levels:\n${pack.errors.join('\n')}`);
      return `export const levels = ${JSON.stringify(pack.levels)};\nexport const chapters = ${JSON.stringify(pack.chapters)};\n`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const reload = (file: string) => {
        if (!norm(file).startsWith(norm(dir)) || norm(file).includes('/solutions/')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', reload);
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}
```
(Vite 8: if `server.moduleGraph` is deprecated/missing, use `server.environments.client.moduleGraph`.) `loadPack` never reads `levels/solutions/`: solutions are not bundled.

```ts
// packages/game/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { levelsPlugin } from './vite-plugin-levels';

export default defineConfig({
  base: './',
  plugins: [levelsPlugin(fileURLToPath(new URL('../../levels', import.meta.url)))],
  build: { target: 'es2022' },
});
```

```ts
// packages/game/src/virtual-levels.d.ts
declare module 'virtual:levels' {
  import type { Chapter, LevelData } from '@puzzlecave/core';
  export const levels: LevelData[];
  export const chapters: Chapter[];
}
```

- [ ] **Step 3: `index.html`**

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="theme-color" content="#1d1b26" />
    <title>puzzleCave</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #1d1b26; }
      #app { width: 100vw; height: 100vh; height: 100dvh; touch-action: none; }
      canvas { display: block; image-rendering: pixelated; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: `src/levels.ts`, `src/debug.ts`, `src/ui.ts`**

```ts
// src/levels.ts
import { chapters, levels } from 'virtual:levels';
import type { LevelData } from '@puzzlecave/core';

export { chapters, levels };
const byId = new Map(levels.map((l) => [l.id, l]));

export function levelById(id: string): LevelData {
  const l = byId.get(id);
  if (!l) throw new Error(`unknown level: ${id}`);
  return l;
}

export function locate(id: string): { chapterIndex: number; levelIndex: number } | null {
  for (let ci = 0; ci < chapters.length; ci++) {
    const li = chapters[ci]!.levels.indexOf(id);
    if (li >= 0) return { chapterIndex: ci, levelIndex: li };
  }
  return null;
}
```

```ts
// src/debug.ts — state readable by the e2e tests
export function setDebug(patch: Record<string, unknown>): void {
  const w = window as unknown as { __pc?: Record<string, unknown> };
  w.__pc = { ...(w.__pc ?? {}), ...patch };
}
```

```ts
// src/ui.ts
import Phaser from 'phaser';
import type { Medal } from '@puzzlecave/core';

export const dpr = (): number => window.devicePixelRatio || 1;
export const px = (n: number): number => Math.round(n * dpr());

export const COLORS = {
  bg: 0x1d1b26,
  panel: '#2c2838',
  text: '#f2efe6',
  dim: '#8a8597',
  accent: '#ffd25e',
  locked: '#55505f',
};
export const MEDAL_COLORS = {
  gold: 0xf5c518,
  silver: 0xc0c0c8,
  bronze: 0xcd7f32,
  platinum: 0x9be7ff,
  none: 0x3a3646,
} as const;

export function textStyle(size: number, color: string = COLORS.text): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: 'monospace', fontSize: `${px(size)}px`, color };
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  size = 16,
): Phaser.GameObjects.Text {
  const b = scene.add
    .text(x, y, label, { ...textStyle(size), backgroundColor: COLORS.panel, padding: { x: px(8), y: px(4) } })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  b.on('pointerover', () => b.setColor(COLORS.accent));
  b.on('pointerout', () => b.setColor(COLORS.text));
  b.on('pointerup', onClick);
  return b;
}

export function drawMedal(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  medal: Medal | 'platinum' | undefined,
): void {
  if (medal) g.fillStyle(MEDAL_COLORS[medal], 1).fillCircle(x, y, r);
  else g.lineStyle(Math.max(1, px(1)), MEDAL_COLORS.none, 1).strokeCircle(x, y, r);
}
```

- [ ] **Step 5: `BootScene`, temporary `MenuScene`, `main.ts`**

```ts
// src/scenes/BootScene.ts
import Phaser from 'phaser';
import { levels } from '../levels';
import { textStyle } from '../ui';

export const TEXTURES = [
  'FLOOR', 'GRAVEL', 'WATER', 'EXIT', 'KEY', 'DOOR', 'BLOCK', 'player', 'WALL',
  'WALL_N', 'WALL_W', 'WALL_E', 'WALL_S', 'WALL_NW', 'WALL_NE', 'WALL_NS', 'WALL_WE', 'WALL_WS', 'WALL_ES',
  'WALL_NWE', 'WALL_NWS', 'WALL_NES', 'WALL_WES', 'WALL_NWES',
] as const;

export class BootScene extends Phaser.Scene {
  private failed: string[] = [];
  constructor() {
    super('Boot');
  }
  preload(): void {
    for (const t of TEXTURES) this.load.image(t, `textures/${t}.png`);
    this.load.audio('music-menu', 'music/RPG-Battle-Climax.mp3');
    this.load.audio('music-game', 'music/Self-Destruct-Sequence.mp3');
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.failed.push(file.key));
  }
  create(): void {
    if (this.failed.length || levels.length === 0) {
      this.add.text(16, 16, `Loading error: ${this.failed.join(', ') || 'no levels'}`, textStyle(14, '#ff8080'));
      return;
    }
    this.scene.start('Menu');
  }
}
```

```ts
// src/scenes/MenuScene.ts — temporary, replaced in Task 14
import Phaser from 'phaser';
import { setDebug } from '../debug';
import { levels } from '../levels';
import { textStyle } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }
  create(): void {
    this.add.text(16, 16, `puzzleCave — ${levels.length} levels`, textStyle(16));
    setDebug({ scene: 'Menu' });
  }
}
```

```ts
// src/main.ts
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { COLORS } from './ui';

const ratio = () => window.devicePixelRatio || 1;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: COLORS.bg,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.NONE,
    width: Math.round(window.innerWidth * ratio()),
    height: Math.round(window.innerHeight * ratio()),
    zoom: 1 / ratio(),
  },
  scene: [BootScene, MenuScene],
});

window.addEventListener('resize', () => {
  game.scale.resize(Math.round(window.innerWidth * ratio()), Math.round(window.innerHeight * ratio()));
  game.scale.setZoom(1 / ratio());
});
```

- [ ] **Step 6: Copy the assets**

```bash
mkdir -p packages/game/public/textures packages/game/public/music
cp C:/Users/Steven/IdeaProjects/puzzleCave-legacy/levels/textures/*.png packages/game/public/textures/
rm packages/game/public/textures/dungeon_tiles_0.png
cp C:/Users/Steven/IdeaProjects/puzzleCave-legacy/music/RPG-Battle-Climax.mp3 C:/Users/Steven/IdeaProjects/puzzleCave-legacy/music/Self-Destruct-Sequence.mp3 packages/game/public/music/
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` → OK. Run: `npm run build` → build OK. Check that no solution is bundled: take the content of `levels/solutions/pc-01.txt` (first line) and `grep -l "<that line>" packages/game/dist/assets/*.js` → no result. Run: `npm run dev` in the background then `curl -s http://localhost:5173/ | head -5` → HTML served; stop the server.
- [ ] **Step 8: Commit** `feat(game): Phaser 4 + Vite skeleton, level and asset loading` (+ trailer).

---

### Task 12: game — pure modules (save, input, swipe, animation, auto-tiling, layout, format, i18n)

**Files:**
- Create: `packages/game/src/save.ts`, `src/input/InputController.ts`, `src/input/swipe.ts`, `src/input/keyboardLabels.ts`, `src/render/animTiming.ts`, `src/render/autotile.ts`, `src/render/layout.ts`, `src/format.ts`, `src/i18n.ts`, `src/app.ts`
- Test: `src/save.test.ts`, `src/input/InputController.test.ts`, `src/input/swipe.test.ts`, `src/render/pure.test.ts`, `src/format.test.ts`, `src/i18n.test.ts`

None of these modules imports `phaser` (testable under Node; `app.ts` is not tested).

**Interfaces:**
- Produces:
  - `save.ts`: `Settings { sound: boolean; lang: Lang | null; swipeThreshold: number; repeatRate: number }`; `SaveData { version: 1; settings: Settings; levels: Record<string, LevelRecord> }`; `SAVE_KEY = 'puzzlecave.save.v1'`, `CORRUPT_KEY = 'puzzlecave.save.corrupt'`; `defaultSave(): SaveData` (sound true, lang null, swipeThreshold 30, repeatRate 10); `KV { getItem(k): string | null; setItem(k, v): void }`; `browserStorage(): KV | null`; `class SaveStore { constructor(storage: KV | null); load(): SaveData; save(d: SaveData): boolean }`
  - `InputController.ts`: `Action = { type: 'move'; dir: Dir } | { type: 'undo' } | { type: 'restart' } | { type: 'menu' }`; `KeyLike { code; key; repeat; ctrlKey?; metaKey?; altKey? }`; `class InputController { constructor(emit: (a: Action) => void, repeatRate: number); keydown(e: KeyLike): boolean; keyup(e: KeyLike): void; reset(): void; setRepeatRate(r: number): void }` — first move immediate, then after `max(200, 1000/repeatRate)` ms one move every `1000/repeatRate` ms; the repeated direction is the **last** one held
  - `swipe.ts`: `swipeDir(dx: number, dy: number, threshold: number): Dir | null`
  - `keyboardLabels.ts`: `directionLabels(): Promise<string>` (e.g. `"ZQSD"`, otherwise `"ZQSD / WASD"`)
  - `animTiming.ts`: `class AnimClock { constructor(maxMs?: number); next(nowMs: number): number; reset(): void }`
  - `autotile.ts`: `wallMask(isWall, x, y): number` (N=1, W=2, E=4, S=8; outside the map = not a wall according to `isWall`); `wallTexture(mask): string` (`'WALL'` or `'WALL_'` + letters in the order N, W, E, S)
  - `layout.ts`: `BoardLayout { scale; x; y; width; height }`; `boardLayout(viewW, viewH, cols, rows, tile, reserveTop, reserveBottom): BoardLayout` (integer factor ≥ 1, centered in the available area)
  - `format.ts`: `formatTime(ms: number): string` (`m:ss.cc`, hundredths truncated)
  - `i18n.ts`: `Lang = 'fr' | 'en'`; `MessageKey`; `detectLang(langs: readonly string[]): Lang`; `setLang`, `getLang`, `t(key, vars?)`
  - `app.ts`: `app = { store: SaveStore; data: SaveData; author: boolean; init(): void; persist(): void }`

- [ ] **Step 1: Save tests (they fail)**

```ts
// src/save.test.ts
import { expect, test } from 'vitest';
import { CORRUPT_KEY, SAVE_KEY, SaveStore, defaultSave, type KV } from './save';

const mem = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

test('without storage: default save, save returns false', () => {
  const s = new SaveStore(null);
  expect(s.load()).toEqual(defaultSave());
  expect(s.save(defaultSave())).toBe(false);
});

test('round trip', () => {
  const kv = mem();
  const d = defaultSave();
  d.levels['pc-01'] = { completed: true, bestMoves: 12, medals: { moves: 'gold' } };
  d.settings.sound = false;
  expect(new SaveStore(kv).save(d)).toBe(true);
  expect(new SaveStore(kv).load()).toEqual(d);
});

test('corrupt content: set aside, start from scratch', () => {
  const kv = mem({ [SAVE_KEY]: '{oops' });
  expect(new SaveStore(kv).load()).toEqual(defaultSave());
  expect(kv.data[CORRUPT_KEY]).toBe('{oops');
});

test('wrong version: set aside', () => {
  const kv = mem({ [SAVE_KEY]: JSON.stringify({ version: 99 }) });
  expect(new SaveStore(kv).load()).toEqual(defaultSave());
  expect(kv.data[CORRUPT_KEY]).toBeDefined();
});

test('missing settings filled in with the defaults', () => {
  const kv = mem({ [SAVE_KEY]: JSON.stringify({ version: 1, settings: { sound: false }, levels: {} }) });
  expect(new SaveStore(kv).load().settings).toEqual({ ...defaultSave().settings, sound: false });
});

test('storage that throws: no error propagated', () => {
  const boom: KV = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceeded');
    },
  };
  const s = new SaveStore(boom);
  expect(s.load()).toEqual(defaultSave());
  expect(s.save(defaultSave())).toBe(false);
});
```

- [ ] **Step 2: Input controller tests (they fail)**

```ts
// src/input/InputController.test.ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { InputController, type Action, type KeyLike } from './InputController';

const key = (code: string, k = '', repeat = false): KeyLike => ({ code, key: k, repeat });
let actions: Action[];
let c: InputController;
beforeEach(() => {
  vi.useFakeTimers();
  actions = [];
  c = new InputController((a) => actions.push(a), 10);
});
afterEach(() => vi.useRealTimers());
const moves = () => actions.flatMap((a) => (a.type === 'move' ? [a.dir] : []));

test('directions by physical position: arrows and KeyW/A/S/D (= ZQSD on AZERTY)', () => {
  for (const code of ['ArrowUp', 'KeyA', 'KeyS', 'KeyD', 'KeyW']) {
    expect(c.keydown(key(code, 'x'))).toBe(true);
    c.keyup(key(code));
  }
  expect(moves()).toEqual(['up', 'left', 'down', 'right', 'up']);
});

test('U, R, Escape read by letter; Ctrl+Z ignored', () => {
  c.keydown(key('KeyU', 'u'));
  c.keydown(key('KeyR', 'R'));
  c.keydown(key('Escape', 'Escape'));
  expect(c.keydown({ ...key('KeyZ', 'z'), ctrlKey: true })).toBe(false);
  expect(actions).toEqual([{ type: 'undo' }, { type: 'restart' }, { type: 'menu' }]);
});

test('burst: 50 presses in 200 ms → 50 moves, none lost', () => {
  for (let i = 0; i < 50; i++) {
    const code = i % 2 ? 'ArrowLeft' : 'ArrowRight';
    c.keydown(key(code));
    vi.advanceTimersByTime(2);
    c.keyup(key(code));
    vi.advanceTimersByTime(2);
  }
  expect(moves()).toHaveLength(50);
});

test('OS repeat ignored, custom repeat at the chosen rate', () => {
  c.keydown(key('ArrowRight'));
  c.keydown(key('ArrowRight', '', true));
  expect(moves()).toHaveLength(1);
  vi.advanceTimersByTime(199);
  expect(moves()).toHaveLength(1);
  vi.advanceTimersByTime(1); // 200 ms: initial delay
  expect(moves()).toHaveLength(2);
  vi.advanceTimersByTime(300); // 10/s → +3
  expect(moves()).toHaveLength(5);
  c.keyup(key('ArrowRight'));
  vi.advanceTimersByTime(1000);
  expect(moves()).toHaveLength(5);
});

test('two directions held: the last one repeats, then the other on release', () => {
  c.keydown(key('ArrowRight'));
  c.keydown(key('ArrowUp'));
  vi.advanceTimersByTime(200);
  expect(moves()).toEqual(['right', 'up', 'up']);
  c.keyup(key('ArrowUp'));
  vi.advanceTimersByTime(200);
  expect(moves().at(-1)).toBe('right');
});

test('reset (focus loss) stops the repeat', () => {
  c.keydown(key('ArrowDown'));
  c.reset();
  vi.advanceTimersByTime(2000);
  expect(moves()).toEqual(['down']);
  c.keydown(key('ArrowDown')); // no longer considered held
  expect(moves()).toEqual(['down', 'down']);
});
```

- [ ] **Step 3: Pure tests (they fail)**

```ts
// src/render/pure.test.ts
import { expect, test } from 'vitest';
import { AnimClock } from './animTiming';
import { wallMask, wallTexture } from './autotile';
import { boardLayout } from './layout';

test('AnimClock: min(100 ms, interval)', () => {
  const a = new AnimClock();
  expect(a.next(1000)).toBe(100);
  expect(a.next(1040)).toBe(40);
  expect(a.next(1300)).toBe(100);
  a.reset();
  expect(a.next(1301)).toBe(100);
});

test('wallTexture: order N, O, E, S', () => {
  expect(wallTexture(0)).toBe('WALL');
  expect(wallTexture(1 | 4)).toBe('WALL_NE');
  expect(wallTexture(15)).toBe('WALL_NWES');
  expect(wallTexture(2 | 8)).toBe('WALL_WS');
});

test('wallMask: wall neighbours', () => {
  const grid = ['##.', '#..'];
  const isWall = (x: number, y: number) => grid[y]?.[x] === '#';
  expect(wallMask(isWall, 0, 0)).toBe(4 | 8);
  expect(wallMask(isWall, 1, 0)).toBe(2);
});

test('boardLayout: integer factor, centered, at least 1', () => {
  // available height 1800; min(1080/288, 1800/288) = 3.75 → 3; 864 px; x = 108; y = 100 + 468
  expect(boardLayout(1080, 2000, 18, 18, 16, 100, 100)).toEqual({ scale: 3, x: 108, y: 568, width: 864, height: 864 });
  expect(boardLayout(100, 100, 18, 18, 16, 0, 0).scale).toBe(1);
});
```

```ts
// src/input/swipe.test.ts
import { expect, test } from 'vitest';
import { swipeDir } from './swipe';

test.each([
  [40, 5, 'right'],
  [-40, 10, 'left'],
  [3, 50, 'down'],
  [0, -31, 'up'],
  [20, 20, null],
  [40, 40, null],
])('swipe (%i,%i) → %s', (dx, dy, dir) => {
  expect(swipeDir(dx, dy, 30)).toBe(dir);
});
```

```ts
// src/format.test.ts
import { expect, test } from 'vitest';
import { formatTime } from './format';

test.each([
  [0, '0:00.00'],
  [7429, '0:07.42'],
  [61234, '1:01.23'],
])('%i ms → %s', (ms, s) => expect(formatTime(ms)).toBe(s));
```

```ts
// src/i18n.test.ts
import { expect, test } from 'vitest';
import { detectLang, setLang, t } from './i18n';

test('detectLang', () => {
  expect(detectLang(['fr-FR', 'en'])).toBe('fr');
  expect(detectLang(['en-US', 'fr'])).toBe('en');
  expect(detectLang([])).toBe('en');
});

test('t translates and interpolates', () => {
  setLang('fr');
  expect(t('play')).toBe('Jouer');
  expect(t('help', { dirs: 'ZQSD' })).toContain('ZQSD');
  setLang('en');
  expect(t('play')).toBe('Play');
});
```

- [ ] **Step 4: Run** `npx vitest run packages/game` → FAIL.

- [ ] **Step 5: Implement**

```ts
// src/save.ts
import type { LevelRecord } from '@puzzlecave/core';
import type { Lang } from './i18n';

export interface Settings {
  sound: boolean;
  lang: Lang | null;
  swipeThreshold: number;
  repeatRate: number;
}
export interface SaveData {
  version: 1;
  settings: Settings;
  levels: Record<string, LevelRecord>;
}
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const SAVE_KEY = 'puzzlecave.save.v1';
export const CORRUPT_KEY = 'puzzlecave.save.corrupt';

export function defaultSave(): SaveData {
  return { version: 1, settings: { sound: true, lang: null, swipeThreshold: 30, repeatRate: 10 }, levels: {} };
}

export function browserStorage(): KV | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__pc_test', '1');
    s.removeItem('__pc_test');
    return s;
  } catch {
    return null;
  }
}

export class SaveStore {
  private readonly storage: KV | null;
  constructor(storage: KV | null) {
    this.storage = storage;
  }

  load(): SaveData {
    if (!this.storage) return defaultSave();
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(SAVE_KEY);
      if (raw === null) return defaultSave();
      const obj = JSON.parse(raw) as Partial<SaveData>;
      if (obj.version !== 1 || typeof obj.levels !== 'object' || obj.levels === null) throw new Error('format');
      return { version: 1, settings: { ...defaultSave().settings, ...(obj.settings ?? {}) }, levels: obj.levels };
    } catch {
      try {
        if (raw !== null) this.storage.setItem(CORRUPT_KEY, raw);
      } catch {
        /* unusable storage: no copy */
      }
      return defaultSave();
    }
  }

  save(d: SaveData): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  }
}
```

```ts
// src/input/InputController.ts
import type { Dir } from '@puzzlecave/core';

export type Action = { type: 'move'; dir: Dir } | { type: 'undo' } | { type: 'restart' } | { type: 'menu' };
export interface KeyLike {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const CODE_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};

export class InputController {
  private readonly emit: (a: Action) => void;
  private repeatRate: number;
  private readonly held = new Map<string, Dir>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(emit: (a: Action) => void, repeatRate: number) {
    this.emit = emit;
    this.repeatRate = repeatRate;
  }

  keydown(e: KeyLike): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const dir = CODE_DIRS[e.code];
    if (dir) {
      if (e.repeat || this.held.has(e.code)) return true;
      this.held.set(e.code, dir);
      this.emit({ type: 'move', dir });
      this.schedule(this.initialDelay());
      return true;
    }
    if (e.repeat) return false;
    const k = e.key.toLowerCase();
    if (k === 'u') this.emit({ type: 'undo' });
    else if (k === 'r') this.emit({ type: 'restart' });
    else if (e.key === 'Escape') this.emit({ type: 'menu' });
    else return false;
    return true;
  }

  keyup(e: KeyLike): void {
    if (!this.held.delete(e.code)) return;
    this.clear();
    if (this.held.size) this.schedule(this.initialDelay());
  }

  reset(): void {
    this.held.clear();
    this.clear();
  }

  setRepeatRate(r: number): void {
    this.repeatRate = r;
  }

  private initialDelay(): number {
    return Math.max(200, 1000 / this.repeatRate);
  }

  private schedule(delay: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      const d = [...this.held.values()].at(-1);
      if (!d) return;
      this.emit({ type: 'move', dir: d });
      this.schedule(1000 / this.repeatRate);
    }, delay);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
```

```ts
// src/input/swipe.ts
import type { Dir } from '@puzzlecave/core';

export function swipeDir(dx: number, dy: number, threshold: number): Dir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold || ax === ay) return null;
  return ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}
```

```ts
// src/input/keyboardLabels.ts — labels from the actual layout (Chrome/Edge/Android)
export async function directionLabels(): Promise<string> {
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    if (kb?.getLayoutMap) {
      const map = await kb.getLayoutMap();
      const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => map.get(c));
      if (keys.every((k): k is string => Boolean(k))) return keys.join('').toUpperCase();
    }
  } catch {
    /* API missing or denied */
  }
  return 'ZQSD / WASD';
}
```

```ts
// src/render/animTiming.ts
export class AnimClock {
  private last = -Infinity;
  private readonly maxMs: number;
  constructor(maxMs = 100) {
    this.maxMs = maxMs;
  }
  next(nowMs: number): number {
    const d = Math.min(this.maxMs, nowMs - this.last);
    this.last = nowMs;
    return Math.max(0, d);
  }
  reset(): void {
    this.last = -Infinity;
  }
}
```

```ts
// src/render/autotile.ts
export function wallMask(isWall: (x: number, y: number) => boolean, x: number, y: number): number {
  return (isWall(x, y - 1) ? 1 : 0) | (isWall(x - 1, y) ? 2 : 0) | (isWall(x + 1, y) ? 4 : 0) | (isWall(x, y + 1) ? 8 : 0);
}

export function wallTexture(mask: number): string {
  if (mask === 0) return 'WALL';
  return 'WALL_' + (mask & 1 ? 'N' : '') + (mask & 2 ? 'W' : '') + (mask & 4 ? 'E' : '') + (mask & 8 ? 'S' : '');
}
```

```ts
// src/render/layout.ts
export interface BoardLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boardLayout(
  viewW: number,
  viewH: number,
  cols: number,
  rows: number,
  tile: number,
  reserveTop: number,
  reserveBottom: number,
): BoardLayout {
  const availH = Math.max(1, viewH - reserveTop - reserveBottom);
  const scale = Math.max(1, Math.floor(Math.min(viewW / (cols * tile), availH / (rows * tile))));
  const width = cols * tile * scale;
  const height = rows * tile * scale;
  return {
    scale,
    x: Math.floor((viewW - width) / 2),
    y: reserveTop + Math.floor((availH - height) / 2),
    width,
    height,
  };
}
```

```ts
// src/format.ts
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const cc = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
```

```ts
// src/i18n.ts
export type Lang = 'fr' | 'en';

const fr = {
  play: 'Jouer', options: 'Options', back: 'Retour', sound: 'Son', on: 'Activé', off: 'Désactivé',
  language: 'Langue', langName: 'Français', swipe: 'Sensibilité du swipe', repeat: 'Répétition (coups/s)',
  locked: 'Verrouillé', moves: 'Coups', time: 'Temps', keys: 'Clés', undo: 'Annuler', restart: 'Recommencer',
  menu: 'Menu', replay: 'Rejouer', next: 'Suivant', won: 'Niveau réussi !', drowned: 'Noyé !',
  drownedHint: 'R : recommencer', platinum: 'Défi platine', platinumMode: 'PLATINE', record: 'Record',
  copyTiled: 'Copier les propriétés Tiled', copySolution: 'Copier la solution', copied: 'Copié !',
  newRecord: 'Nouveau record !',
  selectHelp: 'Flèches : choisir · Entrée : jouer · P : défi platine · Échap : menu',
  help: '{dirs} / flèches : bouger · U : annuler · R : recommencer · Échap : menu',
  by: 'par {author}',
} as const;

export type MessageKey = keyof typeof fr;

const en: Record<MessageKey, string> = {
  play: 'Play', options: 'Options', back: 'Back', sound: 'Sound', on: 'On', off: 'Off',
  language: 'Language', langName: 'English', swipe: 'Swipe sensitivity', repeat: 'Key repeat (moves/s)',
  locked: 'Locked', moves: 'Moves', time: 'Time', keys: 'Keys', undo: 'Undo', restart: 'Restart',
  menu: 'Menu', replay: 'Replay', next: 'Next', won: 'Level complete!', drowned: 'Drowned!',
  drownedHint: 'R: restart', platinum: 'Platinum challenge', platinumMode: 'PLATINUM', record: 'Best',
  copyTiled: 'Copy Tiled properties', copySolution: 'Copy solution', copied: 'Copied!',
  newRecord: 'New record!',
  selectHelp: 'Arrows: choose · Enter: play · P: platinum · Esc: menu',
  help: '{dirs} / arrows: move · U: undo · R: restart · Esc: menu',
  by: 'by {author}',
};

const dicts: Record<Lang, Record<MessageKey, string>> = { fr, en };
let current: Lang = 'fr';

export function detectLang(langs: readonly string[]): Lang {
  return langs[0]?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
export function setLang(l: Lang): void {
  current = l;
}
export function getLang(): Lang {
  return current;
}
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return dicts[current][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
```

```ts
// src/app.ts — global state: save, language, author mode
import { detectLang, setLang } from './i18n';
import { SaveStore, browserStorage, defaultSave, type SaveData } from './save';

export const app = {
  store: new SaveStore(browserStorage()),
  data: defaultSave() as SaveData,
  author: false,
  init(): void {
    this.data = this.store.load();
    this.author = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
    setLang(this.data.settings.lang ?? detectLang(navigator.languages ?? []));
  },
  persist(): void {
    this.store.save(this.data);
  },
};
```

- [ ] **Step 6: Run** `npx vitest run packages/game && npm run typecheck` → PASS.
- [ ] **Step 7: Commit** `feat(game): save, keyboard input, swipe, animation timing, auto-tiling, i18n` (+ trailer).

---

### Task 13: game — animated board, game scene, result screen, music

**Files:**
- Create: `packages/game/src/render/BoardView.ts`, `src/scenes/GameScene.ts`, `src/scenes/ResultScene.ts`, `src/music.ts`
- Modify: `src/main.ts` (call `app.init()` before `new Phaser.Game`; scenes `[BootScene, MenuScene, GameScene, ResultScene]`), `src/scenes/MenuScene.ts` (temporary: `Enter` launches `Game` on `pc-01` in normal mode)

**Interfaces:**
- Consumes: `Session`, `award`, `recordRun`, `formatMoves`, `resolveThresholds`, `isLevelUnlocked`, types `GameState`, `GameEvent`, `Mode`, `RunResult`, `Award`, `LevelRecord`, `Dir`, `LevelData`, `ObjKind`, `Pos`, `Terrain` (core); `InputController`, `Action`, `AnimClock`, `boardLayout`, `BoardLayout`, `wallMask`, `wallTexture`, `formatTime`, `t`, `directionLabels`, `app` (Task 12); `levelById`, `locate`, `chapters`, `setDebug`, `COLORS`, `px`, `textStyle`, `makeButton`, `drawMedal` (Task 11).
- Produces:
  - `class BoardView { constructor(scene, state: GameState, layout: BoardLayout); apply(state: GameState, events: GameEvent[], durationMs: number): void; finishAll(): void; rebuild(state: GameState): void; setLayout(layout: BoardLayout): void; destroy(): void }`
  - `GameScene` (key `'Game'`), data `GameSceneData = { levelId: string; mode: Mode }`; protected methods `handle(a: Action): void` and `bottomReserve(): number` (extended in Task 15)
  - `ResultScene` (key `'Result'`), data `ResultSceneData = { levelId: string; mode: Mode; result: RunResult; award: Award; previous?: LevelRecord; moveLog: Dir[] }`
  - `syncMusic(scene, enabled: boolean, key: 'music-menu' | 'music-game'): void`
  - `window.__pc`: `scene`, `levelId`, `mode`, `lastResult` (`RunResult`)

- [ ] **Step 1: `music.ts`**

```ts
import Phaser from 'phaser';

let current: Phaser.Sound.BaseSound | null = null;
let currentKey: string | null = null;

export function syncMusic(scene: Phaser.Scene, enabled: boolean, key: 'music-menu' | 'music-game'): void {
  if (!enabled) {
    current?.stop();
    return;
  }
  if (currentKey !== key) {
    current?.stop();
    current?.destroy();
    current = scene.sound.add(key, { loop: true, volume: 0.5 });
    currentKey = key;
  }
  if (current?.isPlaying) return;
  const start = () => current?.play();
  if (scene.sound.locked) scene.sound.once(Phaser.Sound.Events.UNLOCKED, start);
  else start();
}
```
(Phaser already pauses sound when the tab/app goes to the background: `pauseOnBlur` is `true` by default — check it in Phaser 4.)

- [ ] **Step 2: `BoardView.ts`**

```ts
import Phaser from 'phaser';
import type { GameEvent, GameState, ObjKind, Pos, Terrain } from '@puzzlecave/core';
import { wallMask, wallTexture } from './autotile';
import type { BoardLayout } from './layout';

const TILE = 16;
const TERRAIN_TEX: Record<Exclude<Terrain, 'wall'>, string> = { floor: 'FLOOR', gravel: 'GRAVEL', water: 'WATER', exit: 'EXIT' };
const OBJ_TEX: Record<ObjKind, string> = { key: 'KEY', door: 'DOOR', block: 'BLOCK' };

interface Pending {
  stop: () => void;
  finish: () => void;
  done: boolean;
}

export class BoardView {
  private readonly scene: Phaser.Scene;
  private layout: BoardLayout;
  private root: Phaser.GameObjects.Container | null = null;
  private terrain: Phaser.GameObjects.Image[] = [];
  private objects: (Phaser.GameObjects.Image | null)[] = [];
  private player!: Phaser.GameObjects.Image;
  private pending: Pending[] = [];
  private width = 0;

  constructor(scene: Phaser.Scene, state: GameState, layout: BoardLayout) {
    this.scene = scene;
    this.layout = layout;
    this.rebuild(state);
  }

  rebuild(state: GameState): void {
    this.finishAll();
    this.root?.destroy();
    this.width = state.width;
    const root = this.scene.add.container(this.layout.x, this.layout.y).setScale(this.layout.scale);
    this.root = root;
    const isWall = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < state.width && y < state.height && state.terrain[y * state.width + x] === 'wall';
    this.terrain = state.terrain.map((t, i) => {
      const x = i % state.width;
      const y = Math.floor(i / state.width);
      const tex = t === 'wall' ? wallTexture(wallMask(isWall, x, y)) : TERRAIN_TEX[t];
      const img = this.scene.add.image(x * TILE, y * TILE, tex).setOrigin(0);
      root.add(img);
      return img;
    });
    this.objects = state.objects.map((o, i) => {
      if (!o) return null;
      const img = this.scene.add.image((i % state.width) * TILE, Math.floor(i / state.width) * TILE, OBJ_TEX[o]).setOrigin(0);
      root.add(img);
      return img;
    });
    // player.png is 16×18: it sticks out 2 px at the top
    this.player = this.scene.add.image(state.player.x * TILE, state.player.y * TILE, 'player').setOrigin(0, 2 / 18);
    this.player.setFlipX(state.facing === 'left');
    if (state.status === 'drowned') this.player.setAlpha(0.4);
    root.add(this.player);
  }

  setLayout(layout: BoardLayout): void {
    this.layout = layout;
    this.root?.setPosition(layout.x, layout.y).setScale(layout.scale);
  }

  /** Immediately finishes all running animations (final positions). */
  finishAll(): void {
    const list = this.pending;
    this.pending = [];
    for (const p of list) {
      if (p.done) continue;
      p.done = true;
      p.stop();
      p.finish();
    }
  }

  apply(_state: GameState, events: GameEvent[], durationMs: number): void {
    this.finishAll();
    for (const e of events) {
      switch (e.type) {
        case 'turned':
          if (e.facing === 'left' || e.facing === 'right') this.player.setFlipX(e.facing === 'left');
          break;
        case 'moved':
          this.slide(this.player, e.to, durationMs);
          break;
        case 'pushed': {
          const from = this.at(e.from);
          const img = this.objects[from] ?? null;
          this.objects[from] = null;
          if (img) {
            this.objects[this.at(e.to)] = img;
            this.slide(img, e.to, durationMs);
          }
          break;
        }
        case 'blockSank': {
          const i = this.at(e.at);
          const img = this.objects[i] ?? null;
          this.objects[i] = null;
          this.later(durationMs, () => {
            img?.destroy();
            this.terrain[i]?.setTexture(TERRAIN_TEX.floor);
          });
          break;
        }
        case 'keyPicked':
        case 'doorOpened': {
          const i = this.at(e.at);
          const img = this.objects[i] ?? null;
          this.objects[i] = null;
          this.later(durationMs, () => img?.destroy());
          break;
        }
        case 'drowned':
          this.later(durationMs, () => this.player.setAlpha(0.4));
          break;
        case 'won':
          break;
      }
    }
  }

  destroy(): void {
    this.finishAll();
    this.root?.destroy();
    this.root = null;
  }

  private at(p: Pos): number {
    return p.y * this.width + p.x;
  }

  private slide(img: Phaser.GameObjects.Image, to: Pos, durationMs: number): void {
    const x = to.x * TILE;
    const y = to.y * TILE;
    const finish = () => img.setPosition(x, y);
    if (durationMs <= 0) {
      finish();
      return;
    }
    const entry: Pending = { stop: () => {}, finish, done: false };
    const tween = this.scene.tweens.add({
      targets: img,
      x,
      y,
      duration: durationMs,
      ease: 'Linear',
      onComplete: () => {
        if (entry.done) return;
        entry.done = true;
        finish();
      },
    });
    entry.stop = () => tween.stop();
    this.pending.push(entry);
  }

  private later(durationMs: number, fn: () => void): void {
    if (durationMs <= 0) {
      fn();
      return;
    }
    const entry: Pending = { stop: () => {}, finish: fn, done: false };
    const timer = this.scene.time.delayedCall(durationMs, () => {
      if (entry.done) return;
      entry.done = true;
      fn();
    });
    entry.stop = () => timer.remove(false);
    this.pending.push(entry);
  }
}
```
(If `tween.stop()` triggers `onComplete` in Phaser 4, the `done` flag prevents a double call.)

- [ ] **Step 3: `GameScene.ts`**

```ts
import Phaser from 'phaser';
import { Session, award, recordRun, type Dir, type LevelData, type Mode, type RunResult } from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { formatTime } from '../format';
import { t } from '../i18n';
import { InputController, type Action } from '../input/InputController';
import { directionLabels } from '../input/keyboardLabels';
import { levelById } from '../levels';
import { syncMusic } from '../music';
import { AnimClock } from '../render/animTiming';
import { BoardView } from '../render/BoardView';
import { boardLayout, type BoardLayout } from '../render/layout';
import { COLORS, makeButton, px, textStyle } from '../ui';

export interface GameSceneData {
  levelId: string;
  mode: Mode;
}

export class GameScene extends Phaser.Scene {
  protected level!: LevelData;
  protected mode: Mode = 'normal';
  protected session!: Session;
  protected board!: BoardView;
  protected hud: Phaser.GameObjects.GameObject[] = [];
  private controls!: InputController;
  private readonly anim = new AnimClock();
  private startTime: number | null = null;
  private finished = false;
  private movesText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private keysText?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.level = levelById(data.levelId);
    this.mode = data.mode;
    this.session = new Session(this.level, this.mode);
    this.startTime = null;
    this.finished = false;
    this.anim.reset();
    this.overlay = undefined;
    this.hud = [];
  }

  create(): void {
    this.board = new BoardView(this, this.session.state, this.computeLayout());
    this.buildHud();
    this.controls = new InputController((a) => this.handle(a), app.data.settings.repeatRate);
    const down = (e: KeyboardEvent) => {
      if (this.controls.keydown(e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => this.controls.keyup(e);
    const blur = () => this.controls.reset();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    const onResize = () => {
      this.board.setLayout(this.computeLayout());
      this.buildHud();
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      this.scale.off('resize', onResize);
      this.controls.reset();
    });
    syncMusic(this, app.data.settings.sound, 'music-game');
    setDebug({ scene: 'Game', levelId: this.level.id, mode: this.mode });
  }

  override update(): void {
    if (this.startTime !== null && this.session.state.status === 'playing') {
      this.timeText?.setText(`${t('time')} ${formatTime(performance.now() - this.startTime)}`);
    }
  }

  /** Area reserved at the bottom of the screen (keyboard help; enlarged on touch, Task 15). */
  protected bottomReserve(): number {
    return px(24);
  }

  protected computeLayout(): BoardLayout {
    return boardLayout(this.scale.width, this.scale.height, this.level.width, this.level.height, 16, px(40), this.bottomReserve());
  }

  protected buildHud(): void {
    for (const o of this.hud) o.destroy();
    this.hud = [];
    const w = this.scale.width;
    const y = px(20);
    this.movesText = this.add.text(px(12), y, '', textStyle(14)).setOrigin(0, 0.5);
    this.timeText = this.add.text(px(120), y, '', textStyle(14)).setOrigin(0, 0.5);
    this.keysText = this.add.text(px(250), y, '', textStyle(14)).setOrigin(0, 0.5);
    this.hud.push(this.movesText, this.timeText, this.keysText);
    if (this.mode === 'platinum') {
      this.hud.push(this.add.text(px(330), y, t('platinumMode'), textStyle(14, '#9be7ff')).setOrigin(0, 0.5));
    }
    const buttons: [string, Action][] = [
      [t('menu'), { type: 'menu' }],
      [t('restart'), { type: 'restart' }],
      [t('undo'), { type: 'undo' }],
    ];
    let x = w - px(12);
    for (const [label, action] of buttons) {
      const b = makeButton(this, x, y, label, () => this.handle(action), 13).setOrigin(1, 0.5);
      x -= b.width + px(8);
      this.hud.push(b);
    }
    const help = this.add.text(w / 2, this.scale.height - px(12), '', textStyle(11, COLORS.dim)).setOrigin(0.5);
    this.hud.push(help);
    void directionLabels().then((dirs) => {
      if (help.active) help.setText(t('help', { dirs }));
    });
    this.updateHud();
  }

  private updateHud(): void {
    const s = this.session.state;
    this.movesText?.setText(`${t('moves')} ${s.moves}`);
    this.keysText?.setText(`${t('keys')} ${s.keys}`);
    if (this.startTime === null) this.timeText?.setText(`${t('time')} ${formatTime(0)}`);
  }

  protected handle(a: Action): void {
    if (this.finished) return;
    switch (a.type) {
      case 'move':
        this.move(a.dir);
        return;
      case 'undo':
        if (this.session.undo()) {
          this.board.rebuild(this.session.state);
          this.anim.reset();
          this.updateHud();
        }
        return;
      case 'restart':
        this.session.restart();
        this.startTime = null;
        this.anim.reset();
        this.board.rebuild(this.session.state);
        this.overlay?.destroy();
        this.overlay = undefined;
        this.updateHud();
        return;
      case 'menu':
        this.finished = true;
        this.scene.start('Select', { levelId: this.level.id });
        return;
    }
  }

  private move(dir: Dir): void {
    const before = this.session.state;
    if (before.status !== 'playing') return;
    const events = this.session.move(dir);
    if (events.length === 0) return;
    const after = this.session.state;
    const now = performance.now();
    const moved = after.moves > before.moves;
    if (moved && this.startTime === null) this.startTime = now;
    this.board.apply(after, events, moved ? this.anim.next(now) : 0);
    this.updateHud();
    if (after.status === 'won') this.finish(now);
    else if (after.status === 'drowned') this.showDrowned();
  }

  private showDrowned(): void {
    this.overlay = this.add
      .text(this.scale.width / 2, this.scale.height / 2, `${t('drowned')}\n${t('drownedHint')}`, {
        ...textStyle(22, '#9be7ff'),
        align: 'center',
        backgroundColor: '#000000aa',
        padding: { x: px(16), y: px(12) },
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  private finish(now: number): void {
    this.finished = true;
    this.controls.reset();
    const result: RunResult = {
      moves: this.session.state.moves,
      timeMs: Math.round(now - (this.startTime ?? now)),
      mode: this.mode,
    };
    const medals = award(this.level, result);
    const previous = app.data.levels[this.level.id];
    app.data.levels[this.level.id] = recordRun(previous, result, medals);
    app.persist();
    setDebug({ lastResult: result });
    const moveLog = this.session.moveLog;
    this.time.delayedCall(250, () =>
      this.scene.start('Result', { levelId: this.level.id, mode: this.mode, result, award: medals, previous, moveLog }),
    );
  }
}
```

- [ ] **Step 4: `ResultScene.ts`**

```ts
import Phaser from 'phaser';
import {
  formatMoves, isLevelUnlocked, resolveThresholds,
  type Award, type Dir, type LevelRecord, type Mode, type RunResult,
} from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { formatTime } from '../format';
import { t } from '../i18n';
import { chapters, levelById, locate } from '../levels';
import { COLORS, drawMedal, makeButton, px, textStyle } from '../ui';

export interface ResultSceneData {
  levelId: string;
  mode: Mode;
  result: RunResult;
  award: Award;
  previous?: LevelRecord;
  moveLog: Dir[];
}

export class ResultScene extends Phaser.Scene {
  private info!: ResultSceneData;
  constructor() {
    super('Result');
  }
  init(data: ResultSceneData): void {
    this.info = data;
  }
  create(): void {
    const { levelId, mode, result, award, previous, moveLog } = this.info;
    const level = levelById(levelId);
    const cx = this.scale.width / 2;
    let y = px(60);
    this.add.text(cx, y, t('won'), textStyle(26, COLORS.accent)).setOrigin(0.5);
    y += px(36);
    this.add.text(cx, y, level.name, textStyle(16)).setOrigin(0.5);
    y += px(48);

    const g = this.add.graphics();
    const th = resolveThresholds(level.thresholds, level.platinum);
    const line = (label: string, value: string, medal: Award['moves'], best: string | undefined, isRecord: boolean) => {
      drawMedal(g, cx - px(130), y, px(10), medal);
      this.add.text(cx - px(110), y, `${label} : ${value}`, textStyle(16)).setOrigin(0, 0.5);
      if (best) this.add.text(cx + px(60), y, `${t('record')} ${best}`, textStyle(12, COLORS.dim)).setOrigin(0, 0.5);
      if (isRecord) this.add.text(cx + px(60), y + px(16), t('newRecord'), textStyle(11, COLORS.accent)).setOrigin(0, 0.5);
      y += px(40);
    };
    line(
      t('moves'), String(result.moves), award.moves, previous?.bestMoves?.toString(),
      previous?.bestMoves === undefined || result.moves < previous.bestMoves,
    );
    line(
      t('time'), formatTime(result.timeMs), award.time,
      previous?.bestTimeMs !== undefined ? formatTime(previous.bestTimeMs) : undefined,
      previous?.bestTimeMs === undefined || result.timeMs < previous.bestTimeMs,
    );
    if (mode === 'platinum' && th.platinumTime !== undefined) {
      drawMedal(g, cx - px(130), y, px(10), award.platinum ? 'platinum' : undefined);
      this.add.text(cx - px(110), y, `${t('platinum')} ≤ ${th.platinumTime} s`, textStyle(14)).setOrigin(0, 0.5);
      y += px(40);
    }

    const next = this.nextLevel(levelId);
    y += px(16);
    makeButton(this, cx - px(80), y, t('replay'), () => this.scene.start('Game', { levelId, mode }));
    if (next) makeButton(this, cx + px(80), y, t('next'), () => this.scene.start('Game', { levelId: next, mode: 'normal' }));
    y += px(44);
    makeButton(this, cx, y, t('menu'), () => this.scene.start('Select', { levelId }), 13);

    if (app.author) {
      y += px(56);
      const props = `goldMoves = ${result.moves}\ngoldTime = ${(result.timeMs / 1000).toFixed(2)}`;
      const tiled = makeButton(this, cx, y, t('copyTiled'), () => void copy(props, tiled), 12);
      y += px(36);
      const sol = makeButton(this, cx, y, t('copySolution'), () => void copy(formatMoves(moveLog), sol), 12);
    }

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && next) this.scene.start('Game', { levelId: next, mode: 'normal' });
      else if (e.key.toLowerCase() === 'r') this.scene.start('Game', { levelId, mode });
      else if (e.key === 'Escape') this.scene.start('Select', { levelId });
    });
    setDebug({ scene: 'Result' });
  }

  private nextLevel(id: string): string | undefined {
    const pos = locate(id);
    if (!pos) return undefined;
    const ch = chapters[pos.chapterIndex]!;
    if (pos.levelIndex + 1 < ch.levels.length) return ch.levels[pos.levelIndex + 1];
    const nextCi = pos.chapterIndex + 1;
    if (chapters[nextCi] && (app.author || isLevelUnlocked(chapters, nextCi, 0, app.data.levels))) {
      return chapters[nextCi]!.levels[0];
    }
    return undefined;
  }
}

async function copy(text: string, button: Phaser.GameObjects.Text): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.setText(t('copied'));
  } catch {
    console.log(text);
  }
}
```

- [ ] **Step 5: Wire up** — `main.ts`: `import { app } from './app';` then `app.init();` before `new Phaser.Game(...)`; scenes `[BootScene, MenuScene, GameScene, ResultScene]`. Temporary `MenuScene`: add `this.input.keyboard?.once('keydown-ENTER', () => this.scene.start('Game', { levelId: 'pc-01', mode: 'normal' }));`. (The `Select` scene arrives in Task 14: until then, `Esc`/Menu in game is not usable — expected.)

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test` → PASS.
Real verification in a browser via a one-shot Playwright script (`ONESHOT`, with `npx playwright@latest install chromium` if needed, and `playwright` installed in `ONESHOT`): `npm run dev` in the background; the script opens `http://localhost:5173/`, waits for `window.__pc.scene === 'Menu'`, presses `Enter`, plays `levels/solutions/pc-01.txt` (U/D/L/R → arrows) **with no delay** between keys, waits for `window.__pc.scene === 'Result'`, checks `__pc.lastResult.moves` = solution length, and takes a screenshot mid-game (after a few moves) and one of the result screen. Read the screenshots: crisp tiles at an integer factor, consistent auto-tiled walls, aligned character, readable HUD. Stop the server.
- [ ] **Step 7: Commit** `feat(game): animated board, game scene, result screen and music` (+ trailer).

---

### Task 14: game — menu, options, level selection, progress and platinum challenge

**Files:**
- Create: `packages/game/src/scenes/OptionsScene.ts`, `src/scenes/SelectScene.ts`
- Modify: `src/scenes/MenuScene.ts` (final version), `src/main.ts` (scenes `[BootScene, MenuScene, OptionsScene, SelectScene, GameScene, ResultScene]`)

**Interfaces:**
- Consumes: `isChapterUnlocked`, `isLevelUnlocked` (core); `chapters`, `levelById`, `locate`, `app`, `t`, `getLang`, `setLang`, `syncMusic`, `formatTime`, `setDebug`, `ui` (Tasks 11-13).
- Produces: `SelectScene` (key `'Select'`, data `{ levelId?: string }`), `OptionsScene` (key `'Options'`), `MenuScene` (key `'Menu'`).

Behavior:
- **Menu**: title "puzzleCave", buttons Play (→ `Select`) and Options; `Enter` = Play. `music-menu` music. Restarts on resize.
- **Options**: Sound (On/Off), Language (Français/English), Swipe sensitivity (`−`/`+`, 10…80 in steps of 5 px), Repeat (`−`/`+`, 4…20); every change is applied and saved immediately; `Esc` or Back → Menu.
- **Select**: one chapter shown at a time (clickable `‹ ›`, `PageUp`/`PageDown`); locked chapter: padlock + number of levels required (except in author mode). Tile grid (`px(56)`, columns = `clamp(floor((width − px(32)) / px(64)), 3, 6)`): number + moves/time medals (+ platinum if the level is `platinum`); locked tile greyed out. Arrows = selection, `Enter` = play, `P` = platinum challenge if available, `Esc` = Menu; tap on a tile = select, 2nd tap = play. Panel: name, author, records, Play / Platinum challenge buttons, help. Initial selection: the received `levelId`, otherwise the first unlocked, uncompleted level of the last open chapter (on a blank save: `pc-01`).

- [ ] **Step 1: Final `MenuScene.ts`**

```ts
import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { syncMusic } from '../music';
import { COLORS, makeButton, px, textStyle } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }
  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add.text(cx, cy - px(90), 'puzzleCave', textStyle(36, COLORS.accent)).setOrigin(0.5);
    makeButton(this, cx, cy, t('play'), () => this.scene.start('Select'), 20);
    makeButton(this, cx, cy + px(56), t('options'), () => this.scene.start('Options'), 16);
    this.input.keyboard?.on('keydown-ENTER', () => this.scene.start('Select'));
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Menu' });
  }
}
```

- [ ] **Step 2: `OptionsScene.ts`**

```ts
import Phaser from 'phaser';
import { app } from '../app';
import { setDebug } from '../debug';
import { getLang, setLang, t } from '../i18n';
import { syncMusic } from '../music';
import { COLORS, makeButton, px, textStyle } from '../ui';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class OptionsScene extends Phaser.Scene {
  constructor() {
    super('Options');
  }
  create(): void {
    const s = app.data.settings;
    const cx = this.scale.width / 2;
    let y = px(60);
    this.add.text(cx, y, t('options'), textStyle(24, COLORS.accent)).setOrigin(0.5);
    y += px(60);
    const change = (fn: () => void) => {
      fn();
      app.persist();
      this.scene.restart();
    };
    const row = (label: string, value: string, onMinus: (() => void) | null, onPlus: () => void) => {
      this.add.text(cx - px(150), y, label, textStyle(14)).setOrigin(0, 0.5);
      if (onMinus) makeButton(this, cx + px(50), y, '−', () => change(onMinus), 14);
      this.add.text(cx + px(100), y, value, textStyle(14)).setOrigin(0.5);
      makeButton(this, cx + px(150), y, onMinus ? '+' : '⇄', () => change(onPlus), 14);
      y += px(48);
    };
    row(t('sound'), s.sound ? t('on') : t('off'), null, () => {
      s.sound = !s.sound;
      syncMusic(this, s.sound, 'music-menu');
    });
    row(t('language'), t('langName'), null, () => {
      const next = getLang() === 'fr' ? 'en' : 'fr';
      s.lang = next;
      setLang(next);
    });
    row(
      t('swipe'), `${s.swipeThreshold} px`,
      () => (s.swipeThreshold = clamp(s.swipeThreshold - 5, 10, 80)),
      () => (s.swipeThreshold = clamp(s.swipeThreshold + 5, 10, 80)),
    );
    row(
      t('repeat'), String(s.repeatRate),
      () => (s.repeatRate = clamp(s.repeatRate - 1, 4, 20)),
      () => (s.repeatRate = clamp(s.repeatRate + 1, 4, 20)),
    );
    makeButton(this, cx, y + px(20), t('back'), () => this.scene.start('Menu'), 16);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
    setDebug({ scene: 'Options' });
  }
}
```

- [ ] **Step 3: `SelectScene.ts`**

```ts
import Phaser from 'phaser';
import { isChapterUnlocked, isLevelUnlocked } from '@puzzlecave/core';
import { app } from '../app';
import { setDebug } from '../debug';
import { formatTime } from '../format';
import { getLang, t } from '../i18n';
import { chapters, levelById, locate } from '../levels';
import { syncMusic } from '../music';
import { COLORS, drawMedal, makeButton, px, textStyle } from '../ui';

export class SelectScene extends Phaser.Scene {
  private ci = 0;
  private li = 0;
  constructor() {
    super('Select');
  }

  init(data: { levelId?: string }): void {
    const pos = data.levelId ? locate(data.levelId) : null;
    if (pos) {
      this.ci = pos.chapterIndex;
      this.li = pos.levelIndex;
      return;
    }
    this.ci = 0;
    this.li = 0;
    for (let ci = chapters.length - 1; ci >= 0; ci--) {
      if (!isChapterUnlocked(chapters, ci, app.data.levels)) continue;
      const ch = chapters[ci]!;
      const li = ch.levels.findIndex(
        (id, i) => isLevelUnlocked(chapters, ci, i, app.data.levels) && !app.data.levels[id]?.completed,
      );
      this.ci = ci;
      this.li = li >= 0 ? li : 0;
      return;
    }
  }

  create(): void {
    this.draw();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    const onResize = () => this.scene.restart({ levelId: this.currentId() });
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    syncMusic(this, app.data.settings.sound, 'music-menu');
    setDebug({ scene: 'Select', chapter: chapters[this.ci]?.id, levelId: this.currentId() });
  }

  private chapterOpen(ci: number): boolean {
    return app.author || isChapterUnlocked(chapters, ci, app.data.levels);
  }
  private levelOpen(ci: number, li: number): boolean {
    return app.author || isLevelUnlocked(chapters, ci, li, app.data.levels);
  }
  private currentId(): string {
    return chapters[this.ci]!.levels[this.li]!;
  }
  private cols(): number {
    return Math.min(6, Math.max(3, Math.floor((this.scale.width - px(32)) / px(64))));
  }

  private redraw(): void {
    this.children.removeAll(true);
    this.draw();
    setDebug({ chapter: chapters[this.ci]?.id, levelId: this.currentId() });
  }

  private draw(): void {
    const ch = chapters[this.ci]!;
    const cx = this.scale.width / 2;
    this.add.text(cx, px(30), ch.name[getLang()], textStyle(18, COLORS.accent)).setOrigin(0.5);
    if (this.ci > 0) makeButton(this, px(30), px(30), '‹', () => this.switchChapter(-1), 18);
    if (this.ci < chapters.length - 1) makeButton(this, this.scale.width - px(30), px(30), '›', () => this.switchChapter(1), 18);
    makeButton(this, px(40), this.scale.height - px(40), t('menu'), () => this.scene.start('Menu'), 12);

    if (!this.chapterOpen(this.ci)) {
      this.add.text(cx, px(120), `🔒 ${t('locked')} (${ch.unlockAfter})`, textStyle(16, COLORS.locked)).setOrigin(0.5);
      return;
    }

    const cols = this.cols();
    const cell = px(56);
    const gap = px(8);
    const gridW = cols * cell + (cols - 1) * gap;
    const x0 = (this.scale.width - gridW) / 2;
    const y0 = px(64);
    const g = this.add.graphics();
    ch.levels.forEach((id, i) => {
      const level = levelById(id);
      const rec = app.data.levels[id];
      const x = x0 + (i % cols) * (cell + gap);
      const y = y0 + Math.floor(i / cols) * (cell + gap);
      const open = this.levelOpen(this.ci, i);
      g.fillStyle(i === this.li ? 0x4a4360 : 0x2c2838, 1).fillRect(x, y, cell, cell);
      if (i === this.li) g.lineStyle(px(2), 0xffd25e, 1).strokeRect(x, y, cell, cell);
      this.add
        .text(x + cell / 2, y + cell * 0.35, open ? String(i + 1) : '🔒', textStyle(14, open ? COLORS.text : COLORS.locked))
        .setOrigin(0.5);
      const my = y + cell * 0.75;
      drawMedal(g, x + cell * 0.25, my, px(5), rec?.medals.moves);
      drawMedal(g, x + cell * 0.5, my, px(5), rec?.medals.time);
      if (level.platinum) drawMedal(g, x + cell * 0.75, my, px(5), rec?.medals.platinum ? 'platinum' : undefined);
      const zone = this.add.zone(x, y, cell, cell).setOrigin(0).setInteractive({ useHandCursor: open });
      zone.on('pointerup', () => {
        if (!open) return;
        if (this.li === i) this.play('normal');
        else {
          this.li = i;
          this.redraw();
        }
      });
    });

    const level = levelById(this.currentId());
    const rec = app.data.levels[level.id];
    let y = y0 + Math.ceil(ch.levels.length / cols) * (cell + gap) + px(16);
    this.add.text(cx, y, level.name, textStyle(16)).setOrigin(0.5);
    y += px(22);
    if (level.author) this.add.text(cx, y, t('by', { author: level.author }), textStyle(12, COLORS.dim)).setOrigin(0.5);
    y += px(22);
    if (rec?.completed) {
      const time = rec.bestTimeMs !== undefined ? formatTime(rec.bestTimeMs) : '–';
      this.add
        .text(cx, y, `${t('record')} : ${rec.bestMoves ?? '–'} ${t('moves').toLowerCase()} · ${time}`, textStyle(12, COLORS.dim))
        .setOrigin(0.5);
    }
    y += px(36);
    if (this.levelOpen(this.ci, this.li)) {
      makeButton(this, level.platinum ? cx - px(90) : cx, y, t('play'), () => this.play('normal'), 16);
      if (level.platinum) makeButton(this, cx + px(90), y, t('platinum'), () => this.play('platinum'), 14);
    }
    this.add.text(cx, this.scale.height - px(14), t('selectHelp'), textStyle(11, COLORS.dim)).setOrigin(0.5);
  }

  private switchChapter(delta: number): void {
    const ci = this.ci + delta;
    if (ci < 0 || ci >= chapters.length) return;
    this.ci = ci;
    this.li = 0;
    this.redraw();
  }

  private play(mode: 'normal' | 'platinum'): void {
    if (!this.levelOpen(this.ci, this.li)) return;
    const level = levelById(this.currentId());
    if (mode === 'platinum' && !level.platinum) return;
    this.scene.start('Game', { levelId: level.id, mode });
  }

  private onKey(e: KeyboardEvent): void {
    const n = chapters[this.ci]!.levels.length;
    const cols = this.cols();
    const moveTo = (li: number) => {
      if (li >= 0 && li < n) {
        this.li = li;
        this.redraw();
      }
    };
    switch (e.key) {
      case 'ArrowLeft':
        return moveTo(this.li - 1);
      case 'ArrowRight':
        return moveTo(this.li + 1);
      case 'ArrowUp':
        return moveTo(this.li - cols);
      case 'ArrowDown':
        return moveTo(this.li + cols);
      case 'PageUp':
        return this.switchChapter(-1);
      case 'PageDown':
        return this.switchChapter(1);
      case 'Enter':
        return this.play('normal');
      case 'Escape':
        this.scene.start('Menu');
        return;
      default:
        if (e.key.toLowerCase() === 'p') this.play('platinum');
    }
  }
}
```
Note: the initial selection uses the **real** unlock rules (even in author mode), so that `Menu → Enter → Enter` launches `pc-01` on a blank save (e2e test, Task 16).

- [ ] **Step 4: Wire up** the scenes in `main.ts`.
- [ ] **Step 5: Verify** — `npm run typecheck && npm test` → PASS. One-shot Playwright script: (a) `npm run dev`: Menu → Options (change the language then go back) → Select → screenshots; (b) `npm run build && npm run preview` (without `?dev` ⇒ author mode inactive): on a blank save only `pc-01` is open and the classic levels chapter is locked; finish `pc-01` with the keyboard then go back to the selection: `pc-02` is open. Read the screenshots to check the layout.
- [ ] **Step 6: Commit** `feat(game): menu, options, level selection, unlocking and platinum challenge` (+ trailer).

---

### Task 15: game — mobile: touch, PWA

**Files:**
- Create: `packages/game/src/touch.ts`, `packages/game/public/icons/icon-192.png`, `icon-512.png` (generated one-shot)
- Modify: `packages/game/src/scenes/GameScene.ts` (swipe, directional pad, bottom reserve, keyboard help hidden on touch), `packages/game/vite.config.ts` (PWA)
- Test: `packages/game/src/touch.test.ts`

**Interfaces:**
- Consumes: `swipeDir` (Task 12); `GameScene.handle`, `bottomReserve`, `buildHud`, `hud` (Task 13).
- Produces: `Rect = { x: number; y: number; w: number; h: number }`; `isTouchDevice(): boolean`; `dpadLayout(viewW: number, viewH: number, size: number): { up: Rect; down: Rect; left: Rect; right: Rect }` (pad horizontally centered, square buttons of side `size`, bottom of the pad at `viewH − size/2`).

- [ ] **Step 1: Test (it fails)**

```ts
// src/touch.test.ts
import { expect, test } from 'vitest';
import { dpadLayout } from './touch';

test('pad centered at the bottom of the screen', () => {
  // pad bottom = 2000 − 50 = 1950; center column x = 500 − 50 = 450
  const d = dpadLayout(1000, 2000, 100);
  expect(d.up).toEqual({ x: 450, y: 1650, w: 100, h: 100 });
  expect(d.left).toEqual({ x: 350, y: 1750, w: 100, h: 100 });
  expect(d.right).toEqual({ x: 550, y: 1750, w: 100, h: 100 });
  expect(d.down).toEqual({ x: 450, y: 1850, w: 100, h: 100 });
});
```

- [ ] **Step 2: Implement `touch.ts`**

```ts
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}

export function dpadLayout(viewW: number, viewH: number, size: number): { up: Rect; down: Rect; left: Rect; right: Rect } {
  const cx = viewW / 2 - size / 2;
  const bottom = viewH - size / 2;
  const sq = (x: number, y: number): Rect => ({ x, y, w: size, h: size });
  return {
    up: sq(cx, bottom - 3 * size),
    left: sq(cx - size, bottom - 2 * size),
    right: sq(cx + size, bottom - 2 * size),
    down: sq(cx, bottom - size),
  };
}
```
Run: `npx vitest run packages/game/src/touch.test.ts` → PASS.

- [ ] **Step 3: Touch GameScene**

In `GameScene.ts`:
- `bottomReserve()`: `isTouchDevice() ? px(48) * 3 + px(24) + px(24) : px(24)`.
- In `buildHud()`: only show the keyboard help text if `!isTouchDevice()`. If `isTouchDevice()`: for each direction of `dpadLayout(this.scale.width, this.scale.height, px(48))`, add a rectangle `this.add.rectangle(r.x, r.y, r.w, r.h, 0x2c2838, 0.8).setOrigin(0).setInteractive()` and a centered text `▲ ▼ ◀ ▶`, `pointerdown` → `this.handle({ type: 'move', dir })`; push both objects into `this.hud`.
- Swipe, in `create()`:
```ts
let downAt: { x: number; y: number } | null = null;
this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
  downAt = over.length ? null : { x: p.x, y: p.y };
});
this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
  if (!downAt) return;
  const r = window.devicePixelRatio || 1;
  const dir = swipeDir((p.x - downAt.x) / r, (p.y - downAt.y) / r, app.data.settings.swipeThreshold);
  downAt = null;
  if (dir) this.handle({ type: 'move', dir });
});
```

- [ ] **Step 4: Icons** — script `ONESHOT/icons.mjs` (pngjs): background `#1d1b26`, `LEGACY/levels/textures/perso.png` enlarged with nearest-neighbour and centered (×8 for 192 px, ×22 for 512 px) → `packages/game/public/icons/icon-192.png` and `icon-512.png`. Read both images to check them.

- [ ] **Step 5: PWA** — Run: `npm install -D vite-plugin-pwa@latest -w @puzzlecave/game`. In `vite.config.ts`:
```ts
import { VitePWA } from 'vite-plugin-pwa';
// plugins:
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['textures/*.png', 'music/*.mp3', 'icons/*.png'],
  manifest: {
    name: 'puzzleCave',
    short_name: 'puzzleCave',
    description: 'Turn-based puzzle game: blocks, keys, doors and water.',
    display: 'fullscreen',
    orientation: 'any',
    background_color: '#1d1b26',
    theme_color: '#1d1b26',
    start_url: './',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: { globPatterns: ['**/*.{js,css,html,png,mp3}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
}),
```
If `vite-plugin-pwa` refuses Vite 8 (peer dependency conflict), report it; only use `--legacy-peer-deps` if the build works afterwards.

- [ ] **Step 6: Verify** — `npm run typecheck && npm test && npm run build` → OK; `packages/game/dist/` contains `manifest.webmanifest` and `sw.js`. One-shot Playwright script on `npm run preview`, `devices['Pixel 7']` emulation (`hasTouch: true`): screenshot in portrait then in landscape (`page.setViewportSize`); read the screenshots (board at an integer factor, pad visible, HUD readable). A simulated swipe (`page.touchscreen` or `page.mouse` down/move/up of 80 px to the right on the board) and a tap on the pad's right arrow move the player when the tile is free (compare the displayed move counter, or screenshot).
- [ ] **Step 7: Commit** `feat(game): touch controls, directional pad and installable PWA` (+ trailer).

---

### Task 16: End-to-end test and README

**Files:**
- Create: `packages/game/playwright.config.ts`, `packages/game/e2e/level1.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `window.__pc` (`scene`, `lastResult`); `levels/solutions/pc-01.txt`; `parseMoves` (core).

- [ ] **Step 1: Install Playwright** — `npm install -D @playwright/test@latest -w @puzzlecave/game && npx playwright install chromium`.

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5199/', browserName: 'chromium' },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: `e2e/level1.spec.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseMoves } from '@puzzlecave/core';

const solution = parseMoves(
  readFileSync(fileURLToPath(new URL('../../../levels/solutions/pc-01.txt', import.meta.url)), 'utf8'),
);
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pc?: Record<string, unknown> }).__pc ?? {});
const scene = async (page: Page) => (await debug(page)).scene;

async function startPc01(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => scene(page)).toBe('Menu');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Select');
  await page.keyboard.press('Enter');
  await expect.poll(() => scene(page)).toBe('Game');
  expect((await debug(page)).levelId).toBe('pc-01');
}

test('finish pc-01 with the keyboard, at full speed', async ({ page }) => {
  await startPc01(page);
  for (const d of solution) await page.keyboard.press(KEY[d]);
  await expect.poll(() => scene(page)).toBe('Result');
  expect(((await debug(page)).lastResult as { moves: number }).moves).toBe(solution.length);
});

test('physical keys KeyW/KeyA/KeyS/KeyD and U accepted', async ({ page }) => {
  await startPc01(page);
  for (const k of ['KeyD', 'KeyS', 'KeyA', 'KeyW', 'KeyU']) await page.keyboard.press(k);
  await expect.poll(() => scene(page)).toBe('Game');
});
```

- [ ] **Step 4: Run** `npm run e2e` → 2 PASS.

- [ ] **Step 5: `README.md`**

```markdown
# puzzleCave

A turn-based block-pushing puzzle game: push blocks, pick up keys, open doors, fill the water
and reach the exit. Medals for moves and time, plus a platinum challenge where water drowns you.

## Run

Requirements: Node 24+.

    npm install
    npm run dev        # game on http://localhost:5173 (author mode on)
    npm test           # unit tests
    npm run e2e        # end-to-end test (Playwright)
    npm run build      # publishable build in packages/game/dist (PWA)

## Controls

- Keyboard: arrows or ZQSD (WASD on QWERTY, detected automatically), U undo, R restart, Esc menu.
- Touch: swipe or on-screen pad.

## Creating levels with Tiled

1. Create an orthogonal map, 16×16 tiles, tile layer format **CSV**.
2. Add the tileset `levels/tileset.tsx`.
3. Paint the `terrain` layer (floor, gravel, water, wall, exit). Start, keys, doors and blocks
   are painted in that same layer (placed on floor) or in an object layer (for example,
   a key on gravel).
4. Map properties: `name`, `author`, `initialKeys` (int, can be negative), `platinum` (bool),
   `goldMoves`, `goldTime` (seconds) and, if needed, `silverMoves`, `bronzeMoves`, `silverTime`,
   `bronzeTime`, `platinumTime`.
5. Save as `levels/<id>.tmx` and add `<id>` to `levels/chapters.json`.
6. `npm run validate`, then `npm run solve -- <id> --apply` to compute the optimal solution and `goldMoves`.

In author mode (`npm run dev` or `?dev` in the URL), every level is open and the result screen
lets you copy `goldMoves`/`goldTime` and the solution you played.

## Solutions (spoilers!)

`levels/solutions/` contains one reference solution per level, used by the tests.
They are not included in the published game, but they are readable in the repository.

## Layout

- `packages/core` — rules, medals, progress, solver (pure TypeScript, no dependency)
- `packages/tiled` — reading/writing Tiled maps
- `packages/tools` — `validate` / `solve` CLI
- `packages/game` — Phaser 4 + Vite + PWA game

Credits: see `CREDITS.md`.
```

- [ ] **Step 6: Final verification** — `npm run typecheck && npm test && npm run build && npm run e2e && npm run validate` → all OK.
- [ ] **Step 7: Commit** `test(e2e): pc-01 with the keyboard; docs: README` (+ trailer).
