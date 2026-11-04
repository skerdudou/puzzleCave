import type Phaser from 'phaser';
import { KONAMI } from './achievements';
import { app } from './app';
import { setDebug } from './debug';
import { t } from './i18n';
import { showNotice } from './notice';
import { runAcross } from './render/konamiRunner';
import { KONAMI_TUNE, playTune } from './sfx';

/**
 * ↑ ↑ ↓ ↓ ← → ← → B A, entered on the menu or the level selection: a fanfare, the explorer
 * running across, and every chapter open (the effect plays each time; the achievement and the
 * chapters, once). True when it has just opened the chapters.
 */
export function konamiEntered(scene: Phaser.Scene): boolean {
  playTune(KONAMI_TUNE, app.data.settings.sfx);
  runAcross(scene);
  const fresh = app.earn([KONAMI]).length > 0;
  if (fresh) showNotice(t('konamiOpen'));
  setDebug({ konami: true });
  return fresh;
}
