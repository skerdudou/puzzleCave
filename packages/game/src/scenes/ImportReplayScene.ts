import Phaser from 'phaser';
import { setDebug } from '../debug';
import { t } from '../i18n';
import { hideImportReplay, showImportReplay } from '../importReplayPage';
import { onSceneKeyDown } from '../input/sceneKeys';
import { levelById, levelTitle } from '../levels';
import { showNotice } from '../notice';
import { getReplay, movesOf, parseReplayText, setReplay } from '../replays';

export interface ImportReplayData {
  levelId: string;
  /** Where Escape and Back go. */
  back: { scene: string; data?: object };
}

/**
 * Pasting a replay in for a level (replay player › Import): an HTML page over the game
 * (importReplayPage.ts). A good text is saved as the level's replay and played.
 */
export class ImportReplayScene extends Phaser.Scene {
  constructor() {
    super('ImportReplay');
  }

  create(data: ImportReplayData): void {
    const back = () => this.scene.start(data.back.scene, data.back.data);
    showImportReplay({
      title: t('importReplayTitle', { name: levelTitle(levelById(data.levelId)) }),
      replace: !!getReplay(data.levelId),
      onImport: (text) => {
        let replay;
        try {
          replay = parseReplayText(text);
        } catch {
          showNotice(t('importReplayFailed'), '#ff8080');
          return false;
        }
        // the storage full: nothing kept, the page stays open
        if (!setReplay(data.levelId, replay)) {
          showNotice(t('saveFailed'), '#ff8080');
          return false;
        }
        this.scene.start('Replay', {
          levelId: data.levelId,
          moves: movesOf(replay),
          mode: replay.mode,
          label: t('labelSavedReplay'),
          saving: 'saved',
          back: { scene: 'Select', data: { levelId: data.levelId } },
        });
        return true;
      },
      onBack: back,
    });
    this.events.once('shutdown', hideImportReplay);
    // typing in the text box reaches this too, but only Escape means anything here
    onSceneKeyDown(this, (e) => {
      if (e.key === 'Escape') back();
    });
    setDebug({ scene: 'ImportReplay' });
  }
}
