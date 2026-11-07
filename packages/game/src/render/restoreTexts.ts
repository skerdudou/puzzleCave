import Phaser from 'phaser';

/**
 * Each text is a canvas drawn once, kept on the GPU by the browser (Phaser's canvas pool asks
 * for it). Back from the background on a phone, the WebGL context lost then restored, Phaser
 * uploads the texts again from canvases the browser may have wiped meanwhile: every text of every
 * scene is drawn again then (a few dozen; nothing at all the rest of the time).
 */
export function redrawTextsOnRestore(game: Phaser.Game): void {
  game.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, () => {
    const visit = (list: readonly Phaser.GameObjects.GameObject[]) => {
      for (const o of list) {
        if (o instanceof Phaser.GameObjects.Container) visit(o.list);
        else if (o instanceof Phaser.GameObjects.Text) o.updateText();
      }
    };
    for (const scene of game.scene.scenes) visit(scene.children.list);
  });
}
