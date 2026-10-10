// labels following the actual layout (Chrome/Edge/Android)
export async function directionLabels(): Promise<string> {
  try {
    const kb = (
      navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }
    ).keyboard;
    if (kb?.getLayoutMap) {
      const map = await kb.getLayoutMap();
      const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => map.get(c));
      if (keys.every((k): k is string => Boolean(k))) return keys.join('').toUpperCase();
    }
  } catch {
    /* API missing or denied */
  }
  return 'ZQSD / WASD';
}
