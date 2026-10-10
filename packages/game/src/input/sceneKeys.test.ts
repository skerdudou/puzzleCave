import { describe, expect, it } from 'vitest';
import { onSceneKeyDown } from './sceneKeys';

function fakeScene() {
  let shutdown: (() => void) | undefined;
  const scene = {
    active: true,
    sys: { isActive: () => scene.active },
    events: {
      once: (_e: 'shutdown', fn: () => void) => {
        shutdown = fn;
      },
    },
  };
  return { scene, shutdown: () => shutdown?.() };
}

const key = (type: 'keydown' | 'keyup', k: string) => Object.assign(new Event(type), { key: k });

describe('onSceneKeyDown', () => {
  it('handles each keydown exactly once, even when presses pile up before a frame', () => {
    const target = new EventTarget();
    const { scene } = fakeScene();
    const seen: string[] = [];
    onSceneKeyDown(scene, (e) => seen.push(e.key), target);
    // what Phaser's KeyboardPlugin turned into 5 calls: two presses within one game step
    for (const e of [
      key('keydown', 'ArrowRight'),
      key('keyup', 'ArrowRight'),
      key('keydown', 'ArrowRight'),
      key('keyup', 'ArrowRight'),
    ])
      target.dispatchEvent(e);
    expect(seen).toEqual(['ArrowRight', 'ArrowRight']);
  });

  it('ignores keys while the scene is inactive and stops at shutdown', () => {
    const target = new EventTarget();
    const { scene, shutdown } = fakeScene();
    const seen: string[] = [];
    onSceneKeyDown(scene, (e) => seen.push(e.key), target);
    scene.active = false;
    target.dispatchEvent(key('keydown', 'a'));
    scene.active = true;
    target.dispatchEvent(key('keydown', 'b'));
    shutdown();
    target.dispatchEvent(key('keydown', 'c'));
    expect(seen).toEqual(['b']);
  });
});
