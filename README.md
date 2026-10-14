# puzzleCave

A turn-based block-pushing puzzle game for the browser and your phone. Push blocks, fill the water,
collect keys, open doors… and find your way to the exit in as few moves as possible.

**▶ [Play puzzleCave](https://skerdudou.github.io/puzzleCave/)** — free, no account, works offline
once loaded, and can be installed as an app on Android.

## How to play

You are trapped in a cave: reach the **exit** to finish the level. There are no enemies and no clock
running out (except in master mode, below) — take your time, every move counts.

- **Blocks** — walk into a block to push it one cell, if the cell behind it is free floor. You cannot
  pull a block, and you can only push one at a time: a block stuck in a corner stays there.
- **Water** — you cannot walk on water, but a block pushed into it sinks and becomes a bridge. Each
  block fills a single water cell, so think before you use one.
- **Gravel** — you can walk on gravel, but blocks cannot be pushed onto it.
- **Keys and doors** — walk over a key to pick it up; walk into a door to open it, which uses one key.
  Some levels give you more doors than keys, or start you in debt: choose which doors to open.
- **Exit** — step onto it to win.

Made a mistake? **Undo** as many moves as you like, or **restart** the level (master mode, below,
has no undo).

## Medals

Each level awards a medal for the number of **moves** — gold, silver or bronze (a few levels also
have a medal for the **time** you took). The level selection screen shows the limits for each
medal. Gold means a good, honest solution; you do not need to find the cleverest route to get it.

### Master mode and platinum

From the **Medium** chapter on, earning gold on a level unlocks its **master mode** (the
**Master** button, or **P** on the selection screen). In master mode:

- **no undo** — and restarting starts a brand-new attempt;
- water no longer stops you… **it drowns you**;
- **against the clock**: on a level with time medals, you must finish within its **bronze time**.
  The clock starts with your first move (study the map as long as you like before it) and the
  remaining time is shown at the top, in red for the last seconds. Past it the attempt fails,
  like drowning: restart for a new one. The clock stops while the game is hidden (another app,
  screen locked); leaving for the menu ends the attempt.

Finish in master mode within the **platinum** limit to earn the **platinum medal**. The
platinum limit is the best solution known, often a different, cleverer route than the gold one.
Master mode is a separate achievement, with its own line on the selection and result screens
(the light-blue medal, the platinum move limit and the time limit, and your best master run). A
master finish also counts for the gold, silver and bronze medals it qualifies for.

The Easy chapter has no master mode.

## Chapters

The levels are grouped into chapters — **Easy**, **Medium**, **Hard** and **Expert**. Finish a level to unlock the
next one; finish a few levels of a chapter to open the next chapter.

## Controls

- **Keyboard**: arrows or ZQSD (WASD on a QWERTY keyboard, detected automatically) to move, **U** to
  undo, **R** to restart, **Esc** for the menu.
- **Touch**:
  - **drag** anywhere on the play area and keep your finger down: you take one step each time
    your finger travels a short distance, so a long drag walks several cells; steer by dragging
    the other way (right, then up…) without lifting your finger. A simple tap does nothing
    (unless tap zones are on, below). Set the distance per step in Options (**Drag: distance
    per move**, 40 px by default, about a fingertip; lower is more sensitive);
  - or use the on-screen **d-pad**: tap for one step, hold a button to keep walking (at the
    **Repeat** rate set in Options);
  - optional **tap zones** (Options, **Tap zones**: off by default, around the centre of the
    play area, or around the player): the play area is cut in an X into four triangles, up,
    down, left and right. Tap a triangle for one step that way (the step is taken when you lift
    your finger), or keep your finger still on it to keep walking (after the same delay and at
    the same rate as the d-pad). A finger that moves turns into a normal drag. Taps on a
    diagonal or right at the centre do nothing, so that no step goes the wrong way, and so do
    taps on the top bar or just beside a button or the d-pad (a finger that just missed Undo
    does not walk);
  - the undo and restart buttons are on screen;
  - on phones that support it (not iPhone), a short **vibration** tells you a move did not
    happen (a wall, a stuck block, a door without a key; once per press, not at every repeat);
    longer ones mark the end of a level and a failed master attempt. Turn it off in Options
    (**Vibration**).

The game is available in English, French, German, Spanish and Italian (it follows your browser's language; change it in Options).

## Credits

Music by Eric Matyas — see [CREDITS.md](CREDITS.md).

Want to build the game, create levels or play with the solver? See [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Code under the [GNU General Public License v3.0](LICENSE). The music has its own license (see
[CREDITS.md](CREDITS.md)).
