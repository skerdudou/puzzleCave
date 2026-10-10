export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const cc = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
