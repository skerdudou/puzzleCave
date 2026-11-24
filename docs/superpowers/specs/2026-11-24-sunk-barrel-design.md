# Sunk barrel: the barrel stays visible in the water

## Intent

Today a barrel pushed into water vanishes and its cell is drawn as plain floor (the banks around
it are redrawn). The player should instead see the barrel sitting in the water, its lid above the
surface: the cell still reads as water you can now cross. Mockups:
`docs/superpowers/specs/2026-11-24-sunk-barrel-mockup.html` (variant "A-bis" chosen).

## Decided

- **Look (A-bis)**: the barrel 2 art px lower than on land, the water line 12 px down the cell; what
  is under the line shows faintly (the barrel at 38 % over the water), a light rim (`#5c62c4`)
  on the water touching the barrel at the line.
- **Sprites**: two, made at start from `BLOCK.png` (so they follow the art) and smoothed with the
  other sprites: `BLOCK_SUNK_1` (1 px down, while sinking) and `BLOCK_SUNK_2` (at rest). The
  barrel arriving is `BLOCK` itself; a step on it is `BLOCK_SUNK_2` drawn 1 px lower.
- **Effects**: on sinking, a splash (7 drops) and two ripples; a step on the barrel pushes it 1 px
  down with a small ripple. Ripples only colour plain water pixels.
- **No terrain redraw**: the game logic is unchanged (the cell becomes `floor`); the board shows a
  cell that was water at the level's start and is floor now as water plus the sunk barrel. The
  smoothed terrain therefore never changes during a level.
- **Option**: Options › Graphics, "Floating barrels" On (default) / Off. Off keeps the current
  rendering (floor, terrain redrawn) untouched.

## Left to the builder

Timings (sinking ~110 ms per frame, ripples ~750 ms, splash ~480 ms), the effects drawn as art-px
squares over the board, in a layer under the keys, doors, blocks and the player.
