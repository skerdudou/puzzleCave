import type Phaser from 'phaser';
import { setDebug } from './debug';
import { t } from './i18n';

/**
 * Buttons that destroy something ask first: a first press turns one to "Sure?" (and puts back
 * another one that asked), a second one acts and puts it back. No `app` or Phaser at run time:
 * tested on its own.
 */
export class TwoPress {
  private armed: { id: string; button: Phaser.GameObjects.Text; label: string } | null = null;

  /** `restColor`: a button's colour when it does not ask */
  constructor(private readonly restColor: string) {}

  /** True on the second press of the same button. */
  arm(id: string, button: Phaser.GameObjects.Text, label: string): boolean {
    const prev = this.armed;
    if (prev) prev.button.setText(prev.label).setColor(this.restColor);
    this.armed = prev?.id === id ? null : { id, button, label };
    if (this.armed) button.setText(t('confirmReset')).setColor('#ff8080');
    setDebug({ armed: this.armed?.id ?? null });
    return !this.armed;
  }

  /** The asking button put back, if any. */
  reset(): void {
    const prev = this.armed;
    if (prev) prev.button.setText(prev.label).setColor(this.restColor);
    this.armed = null;
    setDebug({ armed: null });
  }
}
