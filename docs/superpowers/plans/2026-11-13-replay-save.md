# Saved Replays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any player can keep one replay per level, watch it from the level select, and export/import it as text.

**Architecture:** Replays live in the save (`SaveData.replays`), behind a small `replays.ts` module (text format + get/set/delete). `ReplayScene` gains a mode and an action row whose buttons depend on whether the replay is saved. A new `ImportReplayScene` shows an HTML textarea page (like `JournalScene`/`journalPage.ts`). The result screen gets a "Watch replay" button, the level select a camera button on the Play row.

**Tech Stack:** TypeScript, Phaser 4, Vitest (`npm test` at the repo root), Playwright (`npm run e2e -w packages/game` or `npx playwright test` in `packages/game`), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-11-13-replay-save-design.md`

## Global Constraints

- One replay per level, key = level id.
- Anything that overwrites or deletes a saved replay asks with a two-press confirmation (the button turns to `t('confirmReset')` "Sure?" in `#ff8080`, a second press acts) — same behaviour as `OptionsScene.confirmed`.
- No camera button on a locked level.
- Every new message key in the 5 dictionaries of `packages/game/src/i18n.ts` (fr, en, de, es, it); `fr` defines the keys.
- No level id in the exported text; no check that an imported replay wins. Only an unreadable text (a character that is not a move, or no move at all) is refused.
- Author flows (`replayMine`, `replaySaved`, save to the dev server) stay unchanged.
- Code, comments and commits in English; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Plan decision (not in the spec, needed for correctness): master mode changes the rules (`step.ts`: water is only blocked in normal mode), so a replay stores its mode. The exported text is the letters of `formatMoves`, preceded by a `# master` line for a master replay; `parseMoves` already skips `#` comments.

## Review Focus

- A replay of a master run must replay in master mode (moves through water) — Task 1 test `master replay round-trips its mode`, Task 2 Session built with the mode.
- An old save (no `replays` field) and a save with a malformed `replays` entry must load, not be set aside as corrupt — Task 1 tests.
- Pasted text with spaces, newlines, lowercase letters and Windows line ends imports fine; empty text is refused — Task 1 tests.
- Options › Erase progress must also clear the replays, and Options › Import replaces them with the file's — Task 1.
- A resize of the replay screen (it restarts the scene) must keep the saved/unsaved context and the armed state reset — Task 2: context lives in `ReplaySceneData`.

---

### Task 1: Replays in the save, text format

**Files:**
- Modify: `packages/game/src/save.ts` (SaveData, defaultSave, parseSave, a `sanitiseReplays`)
- Create: `packages/game/src/replays.ts`
- Test: `packages/game/src/replays.test.ts`, `packages/game/src/save.test.ts`
- Modify: `packages/game/src/scenes/OptionsScene.ts` (`eraseProgress`: also `app.data.replays = {}`)

**Interfaces:**
- Produces (save.ts): `export interface SavedReplay { mode: Mode; moves: string }` (`moves` = letters `UDLR`, no newline); `SaveData.replays: Record<string, SavedReplay>`. Version stays 2 (an absent field loads as `{}`; no migration).
- Produces (replays.ts):
  - `replayText(r: SavedReplay): string` — `"# master\n"` prefix when master, then `formatMoves(dirs)`.
  - `parseReplayText(text: string): SavedReplay` — throws `Error('empty')` when no move, rethrows `parseMoves`' error on a bad character; mode `master` when a line, trimmed, equals `# master` (case-insensitive), else `normal`.
  - `toSaved(moves: readonly Dir[], mode: Mode): SavedReplay`, `movesOf(r: SavedReplay): Dir[]`.
  - `getReplay(levelId: string): SavedReplay | undefined`, `setReplay(levelId: string, r: SavedReplay): void`, `deleteReplay(levelId: string): void` — on `app.data.replays`, each write calls `app.persist()`.

- [ ] **Step 1: Write failing tests**

`replays.test.ts` (pure functions only, no `app`):
```ts
test('text round-trips a normal replay', () => {
  const r = toSaved(['up', 'right', 'down', 'left'], 'normal');
  expect(r.moves).toBe('URDL');
  expect(parseReplayText(replayText(r))).toEqual(r);
});
test('master replay round-trips its mode', () => {
  const r = toSaved(['up'], 'master');
  expect(replayText(r).startsWith('# master\n')).toBe(true);
  expect(parseReplayText(replayText(r))).toEqual(r);
});
test('pasted text is forgiving', () => {
  expect(parseReplayText('  ur\r\n dl \n')).toEqual({ mode: 'normal', moves: 'URDL' });
});
test('unreadable text is refused', () => {
  expect(() => parseReplayText('')).toThrow();
  expect(() => parseReplayText('# master\n')).toThrow();
  expect(() => parseReplayText('URX')).toThrow();
});
```
`save.test.ts`: a save without `replays` parses with `replays: {}`; a save with `replays: { a: { mode: 'master', moves: 'UD' }, b: { mode: 'x', moves: 'UD' }, c: { moves: 'UZ' }, d: 5 }` keeps only `a` (mode must be normal/master, moves must match `/^[UDLR]+$/`); `exportSave`→`importSave` keeps `replays`; `defaultSave().replays` is `{}`.

- [ ] **Step 2: Run `npm test -- packages/game/src/replays.test.ts packages/game/src/save.test.ts`** — Expected: FAIL (module / field missing).
- [ ] **Step 3: Implement** the interfaces above. `replays.ts` imports `app` from `./app` only in the get/set/delete functions' module scope (the pure functions must stay testable: if importing `app` breaks the test environment, put the pure functions in `replayText.ts` and re-export). Add `app.data.replays = {}` to `OptionsScene.eraseProgress`.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`** — Expected: PASS.
- [ ] **Step 5: Commit** — `Saved replays: kept in the save, with a text format`.

### Task 2: Replay player — mode and action row

**Files:**
- Modify: `packages/game/src/scenes/ReplayScene.ts`
- Modify: `packages/game/src/i18n.ts`
- Create: `packages/game/src/twoPress.ts` (+ `twoPress.test.ts`)

**Interfaces:**
- Consumes: Task 1 (`getReplay`, `setReplay`, `deleteReplay`, `toSaved`, `replayText`).
- Produces: `ReplaySceneData` gains `mode?: Mode` (default `'normal'`) and `saving?: 'unsaved' | 'saved'` (absent = author/solution replays: no action row, as today). Both kept across the resize restart (they are in `this.info`).
- Produces: `class TwoPress { arm(id: string, button: Phaser.GameObjects.Text, label: string): boolean; reset(): void }` in `twoPress.ts` — same contract as `OptionsScene.confirmed` (first press shows `t('confirmReset')` in `#ff8080` and returns false; pressing another armed button restores the previous one's label/colour; the second press on the same id restores the label and returns true). `setDebug({ armed: id | null })`.
- i18n keys (fr / en; de, es, it translated alike): `replaySave` "Enregistrer" / "Save", `replayExport` "Exporter" / "Export", `replayImport` "Importer" / "Import", `replayDelete` "Supprimer" / "Delete", `replaySavedNotice` "Replay enregistré" / "Replay saved", `replayDeletedNotice` "Replay supprimé" / "Replay deleted". `copied`/`copyFailed` already exist.

- [ ] **Step 1: Write failing test** `twoPress.test.ts` with a fake button object (`setText`, `setColor` recording calls; cast to the Phaser type): first `arm('a')` → false and text `Sure?`-key; second `arm('a')` → true and label restored; `arm('a')` then `arm('b')` → `a` restored, `b` armed.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement `TwoPress`**, then in `ReplayScene`:
  - `new Session(this.level, this.info.mode ?? 'normal')` in both places.
  - When `saving` is set, an action row of size-12 buttons between the control rows and the progress bar; `bottomReserve()` grows by `px(48)` in that case (only then). Unsaved: `[Save, Export]`. Saved: `[Export, Import, Delete]`.
  - Save: if `getReplay(id)` exists, go through `TwoPress.arm('save', …)`; then `setReplay(id, toSaved(moves, mode))`, `showNotice(t('replaySavedNotice'))`, restart the scene with `saving: 'saved'` (keep `startIndex`/`paused`, keep `back`).
  - Export: copy `replayText(toSaved(moves, mode))` to the clipboard (move ResultScene's `copy()` helper to `ui.ts` as `export async function copyToClipboard(text, button)` and use it from both).
  - Import: `this.scene.start('ImportReplay', { levelId, back: { scene: 'Replay', data: { ...this.info, startIndex: 0 } } })` (Task 3 defines the scene; until then the button may reference the key).
  - Delete: `TwoPress.arm('delete', …)`; then `deleteReplay(id)`, `showNotice(t('replayDeletedNotice'))`, `this.scene.start('Select', { levelId })`.
  - `setDebug({ replayActions: string[] })` with the ids shown, and the buttons' centres in CSS px under `replayActionButtons` (same pattern as `replayStepButtons`).
- [ ] **Step 4: Run `npm test`, `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** — `Replay player: mode, and save/export/import/delete buttons`.

### Task 3: Import screen

**Files:**
- Create: `packages/game/src/scenes/ImportReplayScene.ts`, `packages/game/src/importReplayPage.ts`
- Modify: `packages/game/src/main.ts` (register the scene), `packages/game/src/i18n.ts`

**Interfaces:**
- Consumes: Task 1 (`parseReplayText`, `getReplay`, `setReplay`, `movesOf`), Task 2 (`ReplaySceneData.saving`, `TwoPress` semantics — here on an HTML button, so implement the two-press inline: first click with an existing replay changes the text to `t('confirmReset')` and colour `#ff8080`, second acts).
- Produces: scene key `'ImportReplay'`, data `ImportReplayData { levelId: string; back: { scene: string; data?: object } }`.
- Produces: `showImportReplay(opts: { title: string; replace: boolean; onImport(text: string): boolean; onBack(): void }): void` and `hideImportReplay(): void` in `importReplayPage.ts`, styled like `journalPage.ts` (fixed full-page div `id="import-replay"`, same colours, `FONT`, 44px min-height buttons, `zIndex 30`). A `<textarea id="import-replay-text">` focused on open, monospace, takes the remaining height. `onImport` returns false to keep the page open.
- i18n: `importReplayTitle` "Importer un replay — {name}" / "Import a replay — {name}", `importReplayHint` "Colle ici le replay copié avec Exporter." / "Paste the replay copied with Export here.", `importReplayFailed` "Ce texte n'est pas un replay" / "This text is not a replay".

- [ ] **Step 1: Implement** the page and the scene, modelled on `JournalScene` (Escape and the page's Back button → `back`; `hideImportReplay` on `shutdown`). Import: `parseReplayText`; on error `showNotice(t('importReplayFailed'), '#ff8080')` and stay; on success `setReplay`, then `scene.start('Replay', { levelId, moves: movesOf(r), mode: r.mode, label: t('labelSavedReplay'), saving: 'saved', back: { scene: 'Select', data: { levelId } } })`. Add `labelSavedReplay` "replay enregistré" / "saved replay" for the player's title (used by Tasks 4 and 5 too). `setDebug({ scene: 'ImportReplay' })`.
- [ ] **Step 2: Run `npm run typecheck` and `npm test`** — PASS (covered by e2e in Task 6).
- [ ] **Step 3: Commit** — `Import screen for a replay`.

### Task 4: Result screen — Watch replay

**Files:**
- Modify: `packages/game/src/scenes/ResultScene.ts`, `packages/game/src/i18n.ts`

**Interfaces:**
- Consumes: Task 2 (`ReplaySceneData.mode`, `saving: 'unsaved'`).
- i18n: `watchReplay` "Voir le replay" / "Watch replay", `resultKeyWatch` "V voir le replay" / "V watch replay" (match the wording style of the existing `resultKey*` entries).

- [ ] **Step 1: Implement**: a `{ id: 'watch', label: t('watchReplay'), press, key: 'resultKeyWatch' }` item appended to the `first` row (Replay, Master?, Watch). `press` starts `'Replay'` with `{ levelId, moves: moveLog, mode, label: t('labelMine'), saving: 'unsaved', back: { scene: 'Result', data: { ...this.info, instant: true } } }`. Key `v` does the same in the scene's key handler. The two-row layout places a row of n buttons evenly around `cx` (today's ±80 for two); check that three buttons of `sameWidth` fit the screen width — if not, spacing shrinks to button width + `px(8)`. The column layout (`low`) just gets one more entry.
- [ ] **Step 2: Run `npm run typecheck`, `npm test`** — PASS.
- [ ] **Step 3: Commit** — `Result screen: watch the replay of the run`.

### Task 5: Level select — camera on the Play row

**Precondition:** `ux-feedback` (db2689b, daa2a3a) merged into origin/main; rebase this branch on origin/main first (`git fetch && git rebase origin/main`). If it is not merged yet, stop and report.

**Files:**
- Modify: `packages/game/src/scenes/SelectScene.ts`, `packages/game/src/i18n.ts` (if a label is needed)

**Interfaces:**
- Consumes: Task 1 (`getReplay`, `movesOf`), Task 3 (`'ImportReplay'`), Task 2 (`saving: 'saved'`).

- [ ] **Step 1: Implement**: on an open level only, a camera button on the Play row at `buttonsY`: "Play · Master · camera" when master is open, "Play · camera" otherwise. No height added in portrait or landscape. The three (or two) buttons spread across `infoW`, each at least `TOUCH_TARGET` (44 CSS px) wide on a touch screen. Camera art: drawn (Graphics or a generated texture), `COLORS.accent` when `getReplay(id)` exists, `COLORS.dim` otherwise, with a small "+" on the grey one. Press (and key `v`): replay → `scene.start('Replay', { levelId, moves, mode, label: t('labelSavedReplay'), saving: 'saved', back: { scene: 'Select', data: { levelId } } })`; none → `scene.start('ImportReplay', { levelId, back: { scene: 'Select', data: { levelId } } })`. The swipe guard of `this.button(...)` applies. `setDebug({ cameraButton: [x, y] | null, cameraHasReplay: boolean })` in CSS px. The author "Replay solution" button stays as it is.
- [ ] **Step 2: Visual check** with Playwright screenshots at 740×360, 667×375, 640×320, 568×320 landscape on an Expert level with master mode open (save with gold on that level), plus one portrait size: nothing overflows, no overlap; `selectCompact` as on main.
- [ ] **Step 3: Run `npm run typecheck`, `npm test`** — PASS.
- [ ] **Step 4: Commit** — `Level select: camera button for the saved replay`.

### Task 6: End-to-end tests

**Files:**
- Create: `packages/game/e2e/savedReplay.spec.ts` (helpers from `e2e/select.ts`, `e2e/storedSave.ts`; the solution of a level from `levels/solutions/`, as `replay.spec.ts` does)

- [ ] **Step 1: Write tests**:
  1. Finish a level (play its solution with the keyboard) → Result → `v` → scene `Replay`, `replayActions` = `['save','export']` → press Save → stored save has `replays[id]` with the moves → `replayActions` = `['export','import','delete']`.
  2. Select on a level with no replay → `cameraHasReplay` false → press camera → scene `ImportReplay` → fill `#import-replay-text` with the solution letters → Import → scene `Replay`, stored replay present; back to Select → `cameraHasReplay` true.
  3. Import of `"hello"` → notice `importReplayFailed` text, still `ImportReplay`.
  4. Saved replay → Delete once → `armed` = `'delete'`, replay still stored → Delete again → scene `Select`, replay gone.
  5. A stored master replay (written with `encodedSave`) that crosses water replays to the end with the player on the exit (mode honoured).
  6. Locked level → `cameraButton` null.
- [ ] **Step 2: Run `npx playwright test e2e/savedReplay.spec.ts` in `packages/game`** — PASS, and `npm test`. The whole e2e suite runs only after the user has checked the screens (user preference).
- [ ] **Step 3: Commit** — `e2e: saved replays`.
