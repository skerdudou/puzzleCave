export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const cc = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

/**
 * `text`, or its longest start followed by "…" that `fits` (a width test), or "" when even
 * "…" does not fit.
 */
export function ellipsize(text: string, fits: (s: string) => boolean): string {
  if (fits(text)) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n >= 0; n--) {
    const s = `${chars.slice(0, n).join('').trimEnd()}…`;
    if (fits(s)) return s;
  }
  return '';
}
