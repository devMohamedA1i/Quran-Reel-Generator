export function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const tenths = Math.floor((s - Math.floor(s)) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '0.0 MB';
  const mb = b / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = b / 1024;
  return `${kb.toFixed(0)} KB`;
}

export function padSurah(n) {
  return String(Number(n) || 0).padStart(3, '0');
}
