# puzzleCave

A turn-based block-pushing puzzle game for the browser and your phone. Push blocks, fill the water,
collect keys, open doors… and find your way to the exit in as few moves as possible.

**▶ [Play puzzleCave](https://skerdudou.github.io/puzzleCave/)** — free, no account, works offline
once loaded, and can be installed as an app on Android.

## How to play

You are trapped in a cave: reach the **exit** to finish the level. There are no enemies and no clock
running out — take your time, every move counts.

- **Blocks** — walk into a block to push it one cell, if the cell behind it is free floor. You cannot
  pull a block, and you can only push one at a time: a block stuck in a corner stays there.
- **Water** — you cannot walk on water, but a block pushed into it sinks and becomes a bridge. Each
  block fills a single water cell, so think before you use one.
- **Gravel** — you can walk on gravel, but blocks cannot be pushed onto it.
- **Keys and doors** — walk over a key to pick it up; walk into a door to open it, which uses one key.
  Some levels give you more doors than keys, or start you in debt: choose which doors to open.
- **Exit** — step onto it to win.

Made a mistake? **Undo** as many moves as you like, or **restart** the level.

## Medals

Each level awards a medal for the number of **moves** and one for the **time** you took — gold, silver
or bronze. The level selection screen shows the limits for each medal. Gold usually means the
shortest solution known.

Some levels also have a **platinum challenge**: the same level against the clock, but water no longer
stops you… it drowns you.

## Chapters

The levels are grouped into chapters — **Easy**, **Medium** and **Hard**. Finish a level to unlock the
next one; finish a few levels of a chapter to open the next chapter.

## Controls

- **Keyboard**: arrows or ZQSD (WASD on a QWERTY keyboard, detected automatically) to move, **U** to
  undo, **R** to restart, **Esc** for the menu.
- **Touch**: swipe, or use the on-screen d-pad; the undo and restart buttons are on screen.

The game is available in English and French (it follows your browser's language; change it in Options).

## Credits

Music by Eric Matyas — see [CREDITS.md](CREDITS.md).

Want to build the game, create levels or play with the solver? See [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Code under the [GNU General Public License v3.0](LICENSE). The music has its own license (see
[CREDITS.md](CREDITS.md)).
