# Saved replays — design

## Intent

Let any player (not only the author) keep the replay of a run, watch it again later from the level
select, and pass it around as text (export to the clipboard, import by pasting).

## Goals

- One replay per level, kept in the save.
- End of a level: a button opens the replay player on the run just played; saving happens in the
  player (keeps the result screen light).
- Level select: a camera button per level — coloured when a replay is saved (opens the player),
  grey when not (opens the import screen).
- Player: export, import, delete (and save, for a run not saved yet).

## Non-goals

- No level id in the exported text, no validation of an imported replay (the moves are pasted as
  they are; only characters that are not moves are refused, as `parseMoves` already does).
- No list of several replays per level.
- The author tools (save solution to the dev server, "Replay solution") stay as they are.

## Constraints

- Anything that overwrites or deletes a saved replay asks first, with the existing two-press
  confirmation of Options › Progress (the button turns to "Sure?", a second press acts).
- No camera button on a locked level (an import would show a level not unlocked yet).
- Every label in the 5 languages (fr, en, de, es, it).

## Approaches

- **Storage — chosen: in the save (A1).** `SaveData.replays: Record<levelId, string>` (the moves as
  letters, `formatMoves`). Travels with Options › Export/Import; an older save loads with `{}`.
  Rejected: a separate localStorage key (lost when moving to another device with the export).
- **Import screen — chosen: a scene of its own (B1)** with an HTML textarea over the canvas, like
  `JournalScene`: browser Back, Escape and Close behave as on the other screens. Rejected: an overlay
  on the current scene (Back/Escape handled separately in Select and Replay).

## Design

**Result screen.** One more button, "Watch replay", opens `ReplayScene` on `moveLog`, marked as an
unsaved run; Back returns to the result.

**Replay player, buttons by context** (in addition to the playback controls):

| Opened from | Buttons |
|---|---|
| Result (run not saved) | Save · Export |
| Select / after save or import (saved replay) | Export · Import · Delete |

- **Save**: writes `replays[levelId]`; if one already exists, two-press confirmation. Then the
  player switches to the saved context.
- **Export**: copies the letters to the clipboard (the existing `copy()` helper), "Copied" on the
  button.
- **Import**: opens the import screen; back to the player afterwards.
- **Delete**: two-press confirmation, then back to the level select (camera grey).

**Import screen** (`ImportReplayScene`): title (level name), a textarea, "Import" and "Back".
Import parses the text; an unreadable text shows an error notice. If the level already has a
replay, "Import" asks with the two-press confirmation. Once imported: the player opens on it.

**Level select.** A camera icon button (open levels only): coloured when `replays[id]` exists →
player (saved context); grey → import screen. Back from either returns to the select on that level.

Placement (user's decision): on the Play row, at `buttonsY` — "Play · Master · 📷" when master mode
is open, "Play · 📷" otherwise. No height added, portrait or landscape: the landscape column has no
vertical margin left (at 320 px high Play is centred at 285; one more line overflows). Play and
Master are today at `icx ∓ px(80)`; with three buttons, spread them across `infoW` (~330 CSS px in
landscape at 740 wide), at least TOUCH_TARGET (44 px) each on a touch screen. Not next to the level
name (`shrinkToFit` already shrinks it within `infoW - px(16)`). Build on origin/main once the
`ux-feedback` branch (db2689b, daa2a3a: `detailsHeight`, compact master block, `selectCompact`) is
merged. Check in landscape at 740×360, 667×375, 640×320 and 568×320 on an Expert level with master
mode open (the worst case).

**Options › Erase progress** also clears `replays`.

## Left to the builder

- The art of the camera button (icon drawn or glyph).
- The keyboard shortcuts for the new buttons, if any.
- The debug fields and e2e tests, following the existing `setDebug` / e2e conventions.
