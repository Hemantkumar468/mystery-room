import dayjs from './dayjs.js';

export const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const fmtDateShort = (d) => (d ? dayjs(d).format('DD MMM') : '—');
export const fmtDateTime = (d) => (d ? dayjs(d).format('DD MMM, HH:mm') : '—');
/** Full date + 12-hour time, e.g. "18 Jul 2026 • 4:35 PM" — used where a decision's timestamp needs to read unambiguously on its own (no relative-year context nearby). */
export const fmtDateTimeLong = (d) => (d ? dayjs(d).format('DD MMM YYYY • h:mm A') : '—');
export const fromNow = (d) => (d ? dayjs(d).fromNow() : '');

export function fmtCurrency(n, currency = 'INR') {
  if (n == null) return '—';
  // Compact Indian-style: ₹48.0L, ₹1.2Cr
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export const fmtNumber = (n) => new Intl.NumberFormat('en-IN').format(n ?? 0);

export function daysUntil(d) {
  if (!d) return null;
  return dayjs(d).startOf('day').diff(dayjs().startOf('day'), 'day');
}

/** Human file size, e.g. 842 -> "842 B", 2_400_000 -> "2.3 MB". */
export function fmtFileSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

/** Media duration in seconds -> "3:07" (or "1:02:07" past an hour). */
export function fmtDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function initials(name = '') {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
