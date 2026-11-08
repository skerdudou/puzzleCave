import Phaser from 'phaser';
import { setDebug } from '../debug';
import { onSceneKeyDown } from '../input/sceneKeys';
import { hideJournal, showJournal } from '../journalPage';

/**
 * The preview's update journal (main menu › 📜): a screen of the game like the others, so Escape
 * and the browser's Back (backButton.ts) take it back to the menu the same way. The lines are an
 * HTML page over it (journalPage.ts): text to read, scroll, select or share.
 */
export class JournalScene extends Phaser.Scene {
  constructor() {
    super('Journal');
  }

  create(): void {
    const back = () => this.scene.start('Menu');
    showJournal(back);
    this.events.once('shutdown', hideJournal);
    onSceneKeyDown(this, (e) => {
      if (e.key === 'Escape') back();
    });
    setDebug({ scene: 'Journal' });
  }
}
