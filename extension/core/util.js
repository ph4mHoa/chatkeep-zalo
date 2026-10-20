// Shared helpers for every module: local-time date keys, safe file names, a string hash.
// All date grouping uses the browser's local time zone, which is how the content was read.

export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function localParts(ts) {
  const d = new Date(ts);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds() };
}

export const dayKey = ts => { const p = localParts(ts); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const monthKey = ts => { const p = localParts(ts); return `${p.y}-${pad(p.m)}`; };

// ISO-8601 week (weeks start on Monday; week 1 contains the year's first Thursday).
export function weekKey(ts) {
  const d = new Date(ts);
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week1Thursday = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thursday - week1Thursday) / (7 * 86400000));
  return `${thursday.getFullYear()}-W${pad(week)}`;
}

export function periodKey(ts, split) {
  if (split === 'day') return dayKey(ts);
  if (split === 'week') return weekKey(ts);
  if (split === 'month') return monthKey(ts);
  return 'all';
}

// "2026-09-24 12:41:10"
export const fmtLocal = ts => { const p = localParts(ts); return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`; };
// "2026-09-24T12:41:10+07:00"
export function isoLocal(ts) {
  const off = -new Date(ts).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return fmtLocal(ts).replace(' ', 'T') + `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

// Path segments keep letters, digits, '.', '-' and '_': no spaces or brackets, so exported paths
// work in a shell unquoted, and nothing Chrome's downloads API rejects.
export function safeName(s, max = 80) {
  const clean = String(s || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_')
    .replace(/_{2,}/g, '_')
    .replace(/_+(?=\.)/g, '')
    .replace(/^[._]+/, '')
    .slice(0, max)
    .replace(/[._]+$/, '');
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return '_';
  return clean;
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
