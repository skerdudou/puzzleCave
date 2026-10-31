# Cave ambience and pixel UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dress the game screen as a cave (rock around the board, torchlight, vignette, dust, chapter tint) and give the whole interface a pixel look (Silkscreen font, stepped bevelled buttons, pixel d-pad arrows), with torchlight and dust switchable in Options.

**Architecture:** Pure, unit-tested geometry and colour functions in `render/ambience.ts`; one Phaser object `render/AmbienceView.ts` that owns every ambience layer (baked rock texture behind the board, a low-resolution light/dust overlay redrawn per frame above it, a static vignette, the HUD band) and is used by `GameScene` and `ReplayScene`; the button frame in `ui.ts` via a pure `steppedFrame()` drawn by a Graphics kept in sync with each button Text.

**Tech Stack:** TypeScript, Phaser 4.2 (WebGL, `pixelArt: true`), Vite 8 + vite-plugin-pwa, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-cave-ambience-design.md` (and the mock-up `docs/superpowers/specs/2026-10-30-cave-ambience-mockup.html`, whose `<script>` holds the reference drawing code). Read both before any task.

## Global Constraints

- Do not change any tile, sprite, level, the board zoom rules (`render/layout.ts`), gameplay, timing, medals or input.
- No effect waits for a move; the light follows the hero's displayed sprite position only.
- Board shadow never exceeds ~30 % black; outside the board up to 72 %.
- Chapter tint colours: easy `#4f9a5a`, medium `#4a6fa5`, hard `#c8643c`, expert `#8a6ee0`; ~55 % on the rock, ~12 % on board terrain only (floor, walls, water, gravel, exit); keys, doors, blocks and hero untinted; a level in no chapter gets no tint.
- Font stack `Silkscreen, monospace` everywhere (`textStyle`); font bundled and precached (offline PWA); Silkscreen is SIL OFL 1.1 → `CREDITS.md`.
- Interface chrome unit: `px(2)` (2 CSS px) on every screen; rock, light and dust use the board zoom (`layout.scale`).
- `prefers-reduced-motion: reduce` → no flicker, dust frozen (drawn, not moving), whatever the settings.
- Settings: new fields `torchlight: boolean`, `dust: boolean`, default `true`, no migration, `SAVE_VERSION` stays 2.
- New strings in all 5 languages (`en`, `fr`, `de`, `es`, `it`); repo text (code, comments, commits) in English; commits without any `Co-Authored-By` line.
- Run from `packages/game` unless noted: unit `npx vitest run <file>` (from repo root `npm test`), typecheck `npm run typecheck` (root), e2e `npx playwright test <spec>`.

## Review Focus

1. Resize / rotate during a level (and restart, undo) → rock, vignette and overlay rebuilt to the new layout, no stale layer — Task 6 e2e "ambience follows a resize".
2. Very large levels (19×22, pc-47) and tiny ones, whole and fractional zoom → rock still fades from the board edge, overlay stays crisp — Task 4 unit test with fractional scale, Task 6 e2e on pc-47.
3. Long labels in German/Spanish at 320 px wide with Silkscreen → no text outside the screen, no overlapping buttons — Task 7 e2e.
4. Options toggled off then a level opened (and the replay) → no darkness, no dust; turned back on works without reload — Task 6 e2e.
5. Font not yet loaded on a slow first visit → no text rasterised in the fallback font — Task 1 boot waits on `document.fonts.load`, e2e checks `document.fonts.check`.

---

### Task 1: Silkscreen font everywhere

**Files:**
- Modify: `packages/game/package.json` (dependency `@fontsource/silkscreen`; if unavailable, put `Silkscreen-Regular.woff2` from Google Fonts in `public/fonts/` with an `@font-face` in `index.html`)
- Modify: `packages/game/src/main.ts` (import the font CSS; start Phaser only after `document.fonts.load('16px Silkscreen')` resolves, or after 3 s, whichever first)
- Modify: `packages/game/src/ui.ts` (`textStyle`: `fontFamily: 'Silkscreen, monospace'`; export `export const FONT = 'Silkscreen, monospace'`)
- Modify: `packages/game/vite.config.ts` (`globPatterns: ['**/*.{js,css,html,png,mp3,woff2}']`)
- Modify: `CREDITS.md` (Silkscreen — Jason Kottke, SIL Open Font License 1.1)
- Test: `packages/game/src/ui.test.ts` (new), `packages/game/e2e/font.spec.ts` (new)

**Interfaces:**
- Produces: `FONT` constant; every `textStyle()` uses it.

- [ ] **Step 1: Write the failing tests** — `ui.test.ts`: `test('text uses the pixel font with a monospace fallback', () => expect(textStyle(14).fontFamily).toBe('Silkscreen, monospace'))` (mock Phaser import if `ui.ts` pulls it at module level: `vi.mock('phaser', () => ({ default: {} }))`). `e2e/font.spec.ts`: after `page.goto('/')` and the Menu scene is up (poll `__pc.scene === 'Menu'`), `expect(await page.evaluate(() => document.fonts.check('16px Silkscreen'))).toBe(true)`.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement** as listed above (any other hard-coded `fontFamily` in `src/` switches to `FONT`: `grep -rn "fontFamily" src`).
- [ ] **Step 4: Run** `npx vitest run src/ui.test.ts` and `npx playwright test e2e/font.spec.ts` → PASS; `npm run build` succeeds and `dist/sw.js` lists the `.woff2`.
- [ ] **Step 5: Commit** `git commit -m "UI: Silkscreen pixel font everywhere, bundled and precached"`

### Task 2: Stepped bevelled buttons and pixel d-pad arrows

**Files:**
- Create: `packages/game/src/render/frame.ts`
- Modify: `packages/game/src/ui.ts` (`makeButton`, `setButtonFocus`)
- Modify: `packages/game/src/scenes/GameScene.ts:438` (d-pad glyphs → drawn arrows)
- Test: `packages/game/src/render/frame.test.ts`

**Interfaces:**
- Produces: `export interface FrameRect { x: number; y: number; w: number; h: number; tone: 'fill' | 'light' | 'dark' }` and `export function steppedFrame(w: number, h: number, u: number, pressed = false): FrameRect[]` — rectangles in local coordinates (0,0 top-left) covering a `w×h` box with one `u×u` notch cut at each corner (corners left empty), a `u`-wide `light` edge along top and left and a `dark` edge along bottom and right (swapped when `pressed`), the rest `fill`. `export function arrowPixels(dir: Dir): [number, number][]` — the filled cells of a 7×7 arrow (the mock-up's `<svg>` paths: up = rows `3`,`2..4`,`1..5`,`0..6` from top row 1 to row 4).
- Consumes: `COLORS.panel` (fill), `COLORS.focus` (light, and fill when focused), `#15131c` (dark).

- [ ] **Step 1: Failing tests** in `frame.test.ts`: `steppedFrame(20, 10, 2)` — no rect intersects any of the four 2×2 corners; union of rects covers every other pixel exactly once; rects touching `y=0` (excluding fill) are `light`, touching `y=10` are `dark`; with `pressed=true` the tones on top/bottom are swapped. `arrowPixels('up')` has 16 cells, symmetric about column 3, apex `[3,1]`; `arrowPixels('down')` is its vertical mirror; left/right are its transposes.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `frame.ts`; in `makeButton`, drop the Text `backgroundColor`, add a `Phaser.GameObjects.Graphics` at depth `text.depth - 1` that draws `steppedFrame(bounds.w, bounds.h, px(2), pressed)` at the Text's bounds; resync on the scene's `Phaser.Scenes.Events.PRE_RENDER` (position, size, visible, alpha, scroll factor, depth) and destroy it on the Text's `destroy`. `pointerdown` → pressed, `pointerup`/`pointerout` → not pressed. `setButtonFocus` keeps its signature; focus = `COLORS.focus` fill (store in `setData('focused')`, the frame reads it). D-pad: replace the glyph text with a Graphics filling `arrowPixels(dir)` cells of size `px(2)·k` (k so the arrow is ~42 % of the button), centred, colour `COLORS.text`; keep the button's hit area and its debug coordinates unchanged.
- [ ] **Step 4: Run** `npx vitest run src/render/frame.test.ts`, then the existing `npx playwright test e2e/options.spec.ts e2e/hud.spec.ts e2e/touch.spec.ts e2e/tapZones.spec.ts` → PASS (buttons still clickable, focus still works).
- [ ] **Step 5: Commit** `git commit -m "UI: stepped bevelled buttons and pixel d-pad arrows"`

### Task 3: Graphics options (torchlight, dust)

**Files:**
- Modify: `packages/game/src/save.ts` (`Settings`, `defaultSave`, `sanitiseSettings`)
- Modify: `packages/game/src/i18n.ts` (5 tables)
- Modify: `packages/game/src/scenes/OptionsScene.ts` (new section after vibrations, before progress)
- Test: `packages/game/src/save.test.ts`, `packages/game/e2e/options.spec.ts`

**Interfaces:**
- Produces: `Settings.torchlight: boolean`, `Settings.dust: boolean`; i18n keys `graphics`, `torchlight`, `dust`; option button ids `torchlight`, `dust` in `__pc.buttons`.
- Copy: en `Graphics` / `Torchlight` / `Dust`; fr `Graphismes` / `Lueur` / `Poussière`; de `Grafik` / `Fackelschein` / `Staub`; es `Gráficos` / `Antorcha` / `Polvo`; it `Grafica` / `Torcia` / `Polvere`.

- [ ] **Step 1: Failing tests** — `save.test.ts`: `defaultSave().settings.torchlight === true && .dust === true`; `parseSave` of a v2 save without the fields gives both `true`; with `torchlight: false, dust: false` keeps `false`; with `torchlight: 'x'` gives `true`. `options.spec.ts`: new test "graphics toggles persist" — open Options, click `torchlight` and `dust` buttons (coordinates from `__pc.buttons`, scroll as the file's other tests do), reload, reopen Options, both read `Off` (assert via saved `localStorage['puzzlecave.save.v1']` JSON `settings.torchlight === false`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: label `t('graphics')`, two buttons `labelValue` like the music/effects pair (`t('torchlight')` / `t('dust')` with `t('on')`/`t('off')`), spaced like music/sfx.
- [ ] **Step 4: Run** `npx vitest run src/save.test.ts src/i18n.test.ts` and `npx playwright test e2e/options.spec.ts e2e/optionsScroll.spec.ts` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Options: Graphics section with torchlight and dust switches"`

### Task 4: Pure ambience functions

**Files:**
- Create: `packages/game/src/render/ambience.ts`
- Test: `packages/game/src/render/ambience.test.ts`

**Interfaces (all coordinates in art pixels of the screen, i.e. device px / `scale`):**
- `export interface Rect { x: number; y: number; w: number; h: number }`
- `export interface Stone { x: number; y: number; alpha: number }` (top-left of a 16×16 `WALL` stone)
- `export function rockStones(screen: Rect, board: Rect): Stone[]` — the mock-up's `drawRock`: one stone per 16-px cell of the screen (from −1 to +1 cell beyond), centre jittered −2…+2 by `hash`, alpha `max(0, 1 − d/150)·(0.75 + (hash % 25)/100)`, `d` = distance from cell centre to `board` (cells with `d < 1` skipped, `alpha ≤ 0.02` dropped), plus an extra stone at (+6, +7) when `hash(3x, y) % 3 === 0`. Deterministic.
- `export function hash(x: number, y: number): number` — the mock-up's integer hash (copy it).
- `export function lightRadius(tSeconds: number, reducedMotion: boolean): number` — `78 + sin(9.1t)·1.5 + sin(23.7t)·1`, or `78` when reduced.
- `export const DARK_OUTSIDE = 0.72; export const BOARD_LIGHT_CUT = 0.6;` (board darkness `≤ 0.72·0.4 ≈ 0.29`)
- `export interface Mote { x: number; y: number; speed: number; phase: number }`, `export function initMotes(w: number, h: number, n = 46): Mote[]`, `export function motePosition(m: Mote, tSeconds: number, w: number, h: number, reducedMotion: boolean): [number, number]` (upward `speed·60` px/s, sway `sin(0.6t + phase)·6`, wrapped into `[0,w)×[0,h)`; reduced → initial position).
- `export function moteAlpha(dist: number, torchlight: boolean): number` — `0.25 + 0.5·(torchlight ? max(0.15, 1 − dist/110) : 0.5)`.
- `export function chapterTint(levelId: string): number | null` — via `locate(levelId)` and `chapters[i].id` from `../levels`: `easy 0x4f9a5a`, `medium 0x4a6fa5`, `hard 0xc8643c`, `expert 0x8a6ee0`, else `null`.
- `export function mixTowards(color: number, amount: number): number` — `0xffffff` blended towards `color` by `amount` (for the board terrain multiply tint, `amount = 0.12`).

- [ ] **Step 1: Failing tests** — `rockStones`: deterministic (two calls equal); no stone centre inside `board`; every alpha in `(0.02, 1]`; mean alpha of stones within 16 px of the board > mean of stones 100+ px away; no stone with `d ≥ 150`; works with a fractional-size board (`{x: 10.5, …}`). `lightRadius(0, true) === 78`, `|lightRadius(t,false) − 78| ≤ 2.5` for t in 0..10 step 0.1. `DARK_OUTSIDE·(1−BOARD_LIGHT_CUT) ≤ 0.3`. `motePosition` stays in bounds over t 0..100, reduced returns the same point for any t. `moteAlpha(0,true) === 0.75`, `moteAlpha(1000,true) ≈ 0.325`, `moteAlpha(x,false) === 0.5`. `chapterTint` of the first level of each chapter (read `chapters` in the test) gives the colour above; `chapterTint('nope') === null`. `mixTowards(0x000000, 0) === 0xffffff`, `mixTowards(0x4a6fa5, 1) === 0x4a6fa5`.
- [ ] **Step 2: Run** `npx vitest run src/render/ambience.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Ambience: pure rock, light, dust and tint functions"`

### Task 5: AmbienceView (Phaser layers)

**Files:**
- Create: `packages/game/src/render/AmbienceView.ts`
- Modify: `packages/game/src/render/BoardView.ts` (expose hero position and terrain tint)

**Interfaces:**
- Consumes: Task 4 functions; `BoardLayout` (`render/layout.ts`); `app.data.settings.torchlight/dust`.
- `BoardView` gains `heroCentre(): [number, number]` (world/device px centre of the player sprite, following its tween) and `setTerrainTint(color: number | null): void` (multiply tint `mixTowards(color, 0.12)` on terrain images only, kept across `rebuild`, cleared with `null`).
- Produces: `export class AmbienceView { constructor(scene: Phaser.Scene, opts: { levelId: string; hudHeight: number }); layout(board: BoardLayout): void; update(timeMs: number, hero: [number, number]): void; destroy(): void }` and `export const AMBIENCE_DEPTH = { rock: -20, overlay: 2, vignette: 3, hudBand: 4 }` (board stays at depth 0; HUD buttons/text must be above `hudBand`: set their depth ≥ 6 if needed).
- Layers: **rock** — one CanvasTexture of size screen/scale art px, filled `COLORS.bg`, stones from `rockStones` drawn with alpha, then (if tint) a `globalCompositeOperation = 'color'` fill at alpha 0.55; shown as an Image scaled by `scale`, rebuilt only in `layout()`. **overlay** — a CanvasTexture at art-px resolution redrawn each `update`: if torchlight, darkness `DARK_OUTSIDE` everywhere, board rect cut by `BOARD_LIGHT_CUT` (`destination-out`), radial hole at the hero (radius 4 → `lightRadius`), then a warm radial `rgba(255,170,80,…)` glow drawn as a separate Image with `Phaser.BlendModes.ADD` at low alpha (canvas soft-light cannot see the scene; tune to match the mock-up); dust motes (1 px, `moteAlpha`) if dust. **vignette** — static CanvasTexture built in `layout()` with the spec's gradient. **HUD band** — rect `COLORS.bg` alpha 0.55 over the top `hudHeight`.
- Reads `torchlight`/`dust` from `app.data.settings` at each `update` (no reload needed); `reducedMotion` from `matchMedia` once in the constructor.
- `setDebug({ ambience: { rock: number /* stone count */, torchlight: boolean, dust: boolean, tint: string | null } })` on layout and when a setting changes.

- [ ] **Step 1:** Implement `BoardView.heroCentre` / `setTerrainTint` and `AmbienceView` (no unit test: Phaser objects; covered by Task 6 e2e).
- [ ] **Step 2: Run** `npm run typecheck` (root) and `npx vitest run src/render` → PASS.
- [ ] **Step 3: Commit** `git commit -m "Ambience: Phaser view with rock, light, dust, vignette and HUD band"`

### Task 6: Ambience in the game and the replay

**Files:**
- Modify: `packages/game/src/scenes/GameScene.ts` (`create`, the resize/layout path at `:188`, `update`, restart/destroy paths)
- Modify: `packages/game/src/scenes/ReplayScene.ts` (`create`, its layout path `layoutNow`, update)
- Test: `packages/game/e2e/ambience.spec.ts` (new)

**Interfaces:**
- Consumes: `AmbienceView`, `BoardView.heroCentre`, `BoardView.setTerrainTint`, `chapterTint`.

- [ ] **Step 1: Failing e2e** `ambience.spec.ts` (reach levels with `e2e/select.ts` `goToLevel`): (a) a Medium level → `__pc.ambience` `{ torchlight: true, dust: true, tint: '#4a6fa5' }` and `rock > 0`; (b) "ambience follows a resize": `page.setViewportSize` to another size during the level → `__pc.ambience.rock` changes and the board's debug layout matches the new size; (c) switch torchlight and dust off in Options, open a level and its replay → `torchlight: false, dust: false` in both scenes; switch back on → `true` without reload; (d) pc-47 opens with `rock > 0` and no console error.
- [ ] **Step 2: Run** `npx playwright test e2e/ambience.spec.ts` → FAIL.
- [ ] **Step 3: Implement**: create the view before the board, `setTerrainTint(chapterTint(level.id))`, call `ambience.layout(layout)` wherever `board.setLayout` / `rebuild` is called, `ambience.update(time, board.heroCentre())` in `update`, destroy on shutdown. `hudHeight` = `topReserve()`.
- [ ] **Step 4: Run** `npx playwright test` (whole suite) → PASS; `npm test` (root) → PASS.
- [ ] **Step 5: Screenshot check**: capture Twin Channels (pc-40) and Gold Teeth (pc-43) at 1280×720 and 740×360 into `.oneshot/shots/ambience-*.png` and compare by eye with the mock-up's "After" preset (Silkscreen); adjust constants within the spec's limits; note differences in the commit message.
- [ ] **Step 6: Commit** `git commit -m "Game and replay: cave ambience (rock, torchlight, dust, vignette, chapter tint)"`

### Task 7: Space budget for Silkscreen

**Files:**
- Modify: `packages/game/src/debug.ts` (add `export function textBoxes(scene: Phaser.Scene): { text: string; x: number; y: number; w: number; h: number; button: boolean }[]` — CSS-px bounds of every visible Text, `button` = interactive; exposed as `window.__pcTexts()` for the active scene)
- Modify: scenes / `i18n.ts` as needed to fix what the test finds (order of remedies: smaller size in that place → shorter wording → in the game HUD only, pixel icons for Undo and Restart drawn like the d-pad arrows, the word kept in `__pc.buttons`)
- Test: `packages/game/e2e/fit.spec.ts` (new)

- [ ] **Step 1: Failing/diagnostic e2e** `fit.spec.ts`: for each language (`en fr de es it`, set via Options or the save) and each viewport (320×568, 360×740, 740×360), visit Menu, Options (scrolled top and bottom), Select (each chapter), Game on pc-40 and on pc-47, Result (win pc-01 via its gold solution, as `resultReveal.spec.ts` does); assert every box from `__pcTexts()` lies within the viewport horizontally (`x ≥ 0`, `x + w ≤ width`) and no two `button` boxes intersect; no button box intersects a non-button text box in the game HUD.
- [ ] **Step 2: Run** `npx playwright test e2e/fit.spec.ts`, list the failures.
- [ ] **Step 3: Fix** each failure with the remedies above (keep every existing e2e green).
- [ ] **Step 4: Run** `npx playwright test` and `npm test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "UI: every screen fits with Silkscreen in all five languages"`
