import type Phaser from 'phaser';
import { setDebug } from './debug';
import { t } from './i18n';

/**
 * A button's label changed, its size kept: the size and padding it had at the first change are
 * remembered, and a shorter label gets more padding (evenly) to keep that size; a longer one
 * grows it. The label put back finds the button as it was.
 */
export function relabelKeepSize(b: Phaser.GameObjects.Text, label: string): void {
  type Rest = { left: number; top: number; right: number; bottom: number; w: number; h: number };
  let rest = b.getData('restSize') as Rest | undefined;
  if (!rest) {
    const p = b.padding;
    rest = {
      left: p.left!,
      top: p.top!,
      right: p.right!,
      bottom: p.bottom!,
      w: b.width,
      h: b.height,
    };
    b.setData('restSize', rest);
  }
  b.setPadding(rest.left, rest.top, rest.right, rest.bottom).setText(label);
  const extraW = Math.max(0, rest.w - b.width);
  const extraH = Math.max(0, rest.h - b.height);
  if (extraW || extraH) {
    const l = Math.floor(extraW / 2);
    const tp = Math.floor(extraH / 2);
    b.setPadding(rest.left + l, rest.top + tp, rest.right + extraW - l, rest.bottom + extraH - tp);
  }
}

/**
 * Buttons that destroy something ask first: a first press turns one to "Sure?" (and puts back
 * another one that asked), a second one acts and puts it back. The button keeps its size, and
 * stops asking by itself after CONFIRM_MS. No `app` or Phaser at run time: tested on its own.
 */
export class TwoPress {
  private armed: { id: string; button: Phaser.GameObjects.Text; label: string } | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;

  /** `restColor`: a button's colour when it does not ask */
  constructor(private readonly restColor: string) {}

  /** True on the second press of the same button. */
  arm(id: string, button: Phaser.GameObjects.Text, label: string): boolean {
    const prev = this.armed;
    this.stopExpiry();
    if (prev) this.putBack(prev.button, prev.label);
    this.armed = prev?.id === id ? null : { id, button, label };
    if (this.armed) {
      relabelKeepSize(button, t('confirmReset'));
      button.setColor('#ff8080');
      this.expiry = setTimeout(() => this.reset(), CONFIRM_MS);
    }
    setDebug({ armed: this.armed?.id ?? null });
    return !this.armed;
  }

  /** The asking button put back, if any. */
  reset(): void {
    const prev = this.armed;
    this.stopExpiry();
    if (prev) this.putBack(prev.button, prev.label);
    this.armed = null;
    setDebug({ armed: null });
  }

  private stopExpiry(): void {
    clearTimeout(this.expiry);
    this.expiry = undefined;
  }

  private putBack(button: Phaser.GameObjects.Text, label: string): void {
    // gone with its screen (left while it asked): nothing to put back
    if ((button as { active?: boolean }).active === false) return;
    relabelKeepSize(button, label);
    button.setColor(this.restColor);
  }
}

/** How long a button asking "Sure?" waits for the second press. */
export const CONFIRM_MS = 3000;
