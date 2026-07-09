import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

export const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const fmtDateShort = (d) => (d ? dayjs(d).format('DD MMM') : '—');
export const fmtDateTime = (d) => (d ? dayjs(d).format('DD MMM, HH:mm') : '—');
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

export function initials(name = '') {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
