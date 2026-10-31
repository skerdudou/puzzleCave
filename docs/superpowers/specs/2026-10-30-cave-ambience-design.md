# Cave ambience and pixel UI — design

Date: 2026-10-30. Branch: `worktree-graphics-ambiance` (trial branch, merged only after Steven plays it).

Reference mock-up (interactive, uses the game's real textures and levels): a copy is committed next
to this file, `2026-10-30-cave-ambience-mockup.html` (open it in a browser; its script holds the
exact drawing code and constants, see "Mock-up constants" below). Online copy:
https://claude.ai/artifact/1wm6XLqACWeWc8HTkvrkFw. The target look is its "After" preset with the
"Silkscreen" interface. The board itself must look as it does today.

## Intent

The game reads well but looks bare: the board floats in a large flat dark area and the interface is
plain system monospace. Steven wants it to feel like a cave and look like a pixel-art game,
**without changing the tiles** (he tried other tile sets and a redrawn hero, water and gravel, and
kept the current art). Everything here is dressing around and over the board, plus the interface.

## Goals

1. **Rock around the board.** The empty area of the game screen becomes a rock mass built from the
   game's own wall stone (`textures/WALL.png`), dense next to the board and fading out with
   distance, so the level looks dug into the rock.
2. **Torchlight.** A warm light around the hero with a slight flicker; the rest is in shadow.
3. **Vignette.** Darkened screen edges.
4. **Dust.** A few motes of dust drifting slowly.
5. **Chapter tint.** One dominant colour per chapter: Easy = moss green, Medium = cold rock blue,
   Hard = ember orange, Expert = crystal violet. Strong on the surrounding rock, very light on the
   board.
6. **Pixel font: Silkscreen** for the whole interface (all scenes).
7. **Stepped-corner buttons with a bevel** (all scenes), and pixel-drawn d-pad arrows.
8. **Graphics options:** torchlight and dust can each be switched off in Options.

## Non-goals

- No change to any tile, sprite or level, to the board's layout or zoom rules, or to gameplay,
  timing, medals or input.
- No light or dust on menus, level select or results: there only the font and buttons change.
- No new animation of game pieces (moves, pushes, sinking stay as they are).

## Anti-goals (a failure even if it works)

- **A cell that is hard to read.** It is a puzzle: shadow on the board never hides anything (see
  limits below), tint never changes what a tile looks like enough to be confused with another.
- **Anything slowing fast keyboard play.** No effect waits for a move, no effect depends on moves
  other than the light following the hero; the light follows the hero's displayed position, so it
  takes the existing move animation's (already shortened) time and nothing more.
- **Text that overflows or overlaps** in any of the 5 languages on a phone (Silkscreen is wide).
- Frame drops on a mid-range phone.

## Decided by Steven

- Keep the current textures. Silkscreen, not Pixelify Sans (he finds Pixelify hard to read), but
  "watch the space it takes". Torchlight and dust: yes, and switchable in graphics options. Chapter
  tints: yes. Rock around the board, vignette, stepped buttons: yes.
- Animations never block input (existing rule: `AnimClock` caps at 100 ms, `finishAll()` on each
  move).

## Behaviour details (my calls, from the mock-up; Steven can still change them)

- **Torchlight limits:** outside the board, darkness up to ~72 % black; on the board it never
  exceeds ~30 %; fully lit within about 2–3 cells of the hero, smooth fall-off to ~5 cells, flicker
  of ±2–3 % of the radius. With torchlight off: no darkness at all (rock fade and vignette stay).
- **Vignette:** always on, not an option (it is cheap and never covers the board's centre).
- **Dust:** ~40–50 motes over the whole screen, 1 art pixel each, slow upward drift with a sideways
  sway, brighter near the hero when torchlight is on. Drawn above the board (it is tiny and faint).
- **Tint** comes from the level's chapter id (`easy`, `medium`, `hard`, `expert`); a level found
  in no chapter (author mode, test levels) gets no tint. Colours from the mock-up: `#4f9a5a`,
  `#4a6fa5`, `#c8643c`, `#8a6ee0`, applied as a hue/"color" blend at ~55 % on the rock and ~12 % on
  the board. Not an option.
- **Options:** a new section "Graphics" with two on/off buttons, "Torchlight" and "Dust", both on by
  default. When the browser reports `prefers-reduced-motion: reduce`, the flicker is off and the
  dust is frozen (motes still drawn, not moving) whatever the setting.
- **Replay scene** gets the same ambience as the game scene (it shows a level being played).
- **HUD band:** the top strip with counters and buttons stays readable over the rock (a
  semi-transparent band of the background colour, as in the mock-up).
- **Buttons:** stepped corners (one notch of 2 art pixels at each corner), a light top-left edge
  (`COLORS.focus`) and a dark bottom-right edge; pressed state swaps the two edges; hover/focus keep
  today's accent text colour. Touch targets (`TOUCH_TARGET`) unchanged. Applies to `makeButton` and
  so to every screen, including the language list and the options steppers.
- **Silkscreen space budget:** check every screen in all 5 languages at 320×568 and 360×740 portrait
  and 740×360 landscape. If a label does not fit: first a smaller size, then shorter wording; in the
  game HUD, Undo and Restart may become pixel icons (with the word kept for screen readers / as
  tooltip) if needed. The level name may wrap under the counters, as in the mock-up.

## Mock-up constants

All in art pixels on the game screen (1 art pixel = one texture pixel at the board's zoom,
`layout.scale`), from the mock-up's `drawRock` / `frame` functions:

- **Rock:** one `WALL.png` stone per 16×16 cell of the whole screen outside the board, centred on
  the cell, jittered by −2…+2 px (deterministic hash of the cell), plus a second stone offset by
  (+6, +7) on one cell in three. Opacity = `max(0, 1 − d / 150) × (0.75…1.0)` where `d` is the
  distance from the cell centre to the board rectangle (0 inside). Drawn on the background colour
  `COLORS.bg`. The stones simply sit next to the board's own outer walls (no joining with the
  autotile).
- **Torchlight:** darkness layer `rgba(6,5,12,0.72)` over the whole screen; on the board rectangle
  60 % of it is removed (so ≤ ~0.29); a radial hole centred on the hero from radius 4 (fully lit)
  to R = 78 (no effect), R flickering by `sin(9.1 t)·1.5 + sin(23.7 t)·1`; then a warm
  "soft-light" radial glow `rgba(255,170,80,0.55)` to `0.9 R`.
- **Dust:** 46 motes of 1 art pixel, upward speed 0.08–0.19 px per frame at 60 fps, sideways sway
  `sin(0.6 t + phase) · 6`, colour `rgb(220,212,235)` at alpha 0.25 + 0.5 × light (light =
  `max(0.15, 1 − dist_to_hero / 110)` with torchlight, 0.5 without).
- **Vignette:** radial gradient centred at (42 % W, 55 % H), transparent up to `0.35 × min(W,H)`,
  `rgba(0,0,0,0.6)` at `0.72 × max(W,H)`.
- **HUD band:** `COLORS.bg` at alpha 0.55 over the top 26 art px (in the game: over the HUD's
  reserved top area).

## Answers to the builder check (my calls)

- **Art pixel outside the board:** interface chrome (button notches and bevels, d-pad arrows) uses a
  fixed unit of `px(2)` (2 CSS px) on every screen, independent of the board zoom, so buttons look
  the same everywhere. Rock, light and dust live in the board's world and use the board zoom.
- **Glyphs missing from Silkscreen** (🔊 🔇 🔒 ♛ ✦ ● ≤ ≥ → ← ‹ › ▾ − …): keep them; the font
  stack is `Silkscreen, monospace` and the browser falls back per glyph. Only the d-pad arrows are
  redrawn. Check that the mixed lines still align; if a symbol looks clearly wrong next to
  Silkscreen, flag it rather than build an icon set.
- **What the board tint and shadow cover:** the ~12 % tint applies to the terrain layer only (floor,
  walls, water, gravel, exit), not to keys, doors, blocks or the hero, so pieces keep their exact
  colours. The torchlight darkness (≤ ~30 % on the board) covers everything, pieces included.
- **Replay:** follows the same Torchlight and Dust options as the game.

## Constraints

- Phaser 4.2 (WebGL), `pixelArt: true`, board zoom rules in `render/layout.ts` unchanged; the rock
  and effects must stay crisp at whole and fractional zoom (DPR ≥ 2).
- The game works offline (PWA): the font file must be bundled and precached (today
  `globPatterns` is `**/*.{js,css,html,png,mp3}` — add the font's format). Font licence: Silkscreen
  is SIL OFL 1.1 — add it to `CREDITS.md`.
- Text must not be created before the font is loaded (Phaser text rasterises with whatever font is
  available at creation).
- New settings fields follow the save rules in `save.ts`: a field added with a default needs no
  migration, the sanitising fills it in; `SAVE_VERSION` stays 2.
- New strings in all 5 languages (`i18n.ts`, tests check the tables).
- Public repo is in English (code, comments, commits); only the `fr` UI table is French.

## Left to the builder

- How to render the rock, light, vignette, dust and tint in Phaser (canvas textures baked per
  level/layout, Phaser 4 filters, render textures, blend modes…), as long as the result matches the
  mock-up and holds 60 fps on a phone. The rock only needs rebuilding when the level or layout
  changes.
- Exact constants (radius, alphas, mote count) within the limits above; tune by eye against the
  mock-up.
- How to bundle the font (an npm package such as `@fontsource/silkscreen`, or the woff2 file in
  `public/`) and how to wait for it before the first scene.
- Tests: pure functions (rock fade, light falloff limits, tint lookup, settings defaults) unit
  tested; options toggles covered by the existing e2e style; a screenshot pass of the screens above
  in all languages for the space budget.
