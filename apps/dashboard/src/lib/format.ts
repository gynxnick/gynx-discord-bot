/** Display helpers (pure; safe on server and client). */

export function formatDateTime(value: Date | string | null | undefined, timeZone = 'UTC'): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
}

export function relativeTime(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return 'never';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return 'just now';
}

export const formatNumber = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-US');

export function truncateText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}
