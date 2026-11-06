import type Phaser from 'phaser';

// state readable by the e2e tests
export function setDebug(patch: Record<string, unknown>): void {
  const w = window as unknown as { __pc?: Record<string, unknown> };
  w.__pc = { ...(w.__pc ?? {}), ...patch };
}

/** A visible text's box on the screen, CSS px; `button`: it answers the pointer. */
export interface TextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  button: boolean;
  /** fixed on the screen while the content scrolls (the band at the top of a menu screen) */
  fixed: boolean;
}

/**
 * Every visible text of a scene with its box on the screen (the camera's scroll taken off), for
 * the e2e tests that check that nothing overflows or overlaps.
 */
export function textBoxes(scene: Phaser.Scene): TextBox[] {
  const ratio = window.devicePixelRatio || 1;
  const cam = scene.cameras.main;
  const out: TextBox[] = [];
  const visit = (list: readonly Phaser.GameObjects.GameObject[]) => {
    for (const o of list) {
      if (o.type === 'Container') {
        const c = o as Phaser.GameObjects.Container;
        if (c.visible && c.alpha > 0) visit(c.list);
        continue;
      }
      if (o.type !== 'Text') continue;
      const t = o as Phaser.GameObjects.Text;
      const button = !!t.input?.enabled;
      // a blank text is nothing to read, unless it is a button (an icon is drawn over it)
      if (!t.active || !t.visible || t.alpha === 0 || (!t.text.trim() && !button)) continue;
      const b = t.getBounds();
      out.push({
        text: t.text,
        x: (b.x - cam.scrollX * t.scrollFactorX) / ratio,
        y: (b.y - cam.scrollY * t.scrollFactorY) / ratio,
        w: b.width / ratio,
        h: b.height / ratio,
        button,
        fixed: t.scrollFactorY === 0,
      });
    }
  };
  visit(scene.children.list);
  return out;
}
