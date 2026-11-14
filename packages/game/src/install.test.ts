import { expect, test, vi } from 'vitest';

/** A fresh install module (its offer is module state) watching a window of its own. */
async function setUp() {
  vi.resetModules();
  const m = await import('./install');
  const win = new EventTarget();
  m.watchInstall(win);
  const seen = vi.fn();
  m.onInstallChange(seen);
  return { m, win, seen };
}

/** The browser's install offer: `outcome` once its box is answered. */
function offer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  return Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome }) });
}

test('no offer from the browser (Safari, already installed): no button', async () => {
  const { m } = await setUp();
  expect(m.canInstall()).toBe(false);
  await m.promptInstall(); // nothing to do
  expect(m.canInstall()).toBe(false);
});

test("the browser's offer: kept for the button, its own bar prevented", async () => {
  const { m, win, seen } = await setUp();
  const e = offer();
  win.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(m.canInstall()).toBe(true);
  expect(seen).toHaveBeenCalledTimes(1);
});

test.each(['accepted', 'dismissed'] as const)(
  'the button opens the box once; %s, the offer is used up',
  async (outcome) => {
    const { m, win, seen } = await setUp();
    const e = offer(outcome);
    win.dispatchEvent(e);
    await m.promptInstall();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(m.canInstall()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    // a new offer later: the button again
    win.dispatchEvent(offer());
    expect(m.canInstall()).toBe(true);
  },
);

test('installed some other way (the browser menu): the button goes', async () => {
  const { m, win } = await setUp();
  win.dispatchEvent(offer());
  win.dispatchEvent(new Event('appinstalled'));
  expect(m.canInstall()).toBe(false);
});

test('a listener stopped is no longer called', async () => {
  const { m, win, seen } = await setUp();
  const other = vi.fn();
  const stop = m.onInstallChange(other);
  stop();
  win.dispatchEvent(offer());
  expect(other).not.toHaveBeenCalled();
  expect(seen).toHaveBeenCalledTimes(1);
});
