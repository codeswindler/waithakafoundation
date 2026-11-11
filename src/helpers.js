'use strict';
const crypto = require('crypto');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));

/** Today's date in Kenya (EAT, UTC+3) as YYYY-MM-DD, so "upcoming" flips at local midnight. */
function today() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function parts(iso) { const [y, m, d] = String(iso || '').split('-').map(Number); return { y, m, d }; }
function fmtDate(iso) { const { y, m, d } = parts(iso); if (!y) return ''; return `${d} ${MONTHS[m - 1]} ${y}`; }
function fmtDay(iso) { return String(parts(iso).d || ''); }
function fmtMon(iso) { const { m } = parts(iso); return MON[m - 1] || ''; }
function fmtYear(iso) { return String(parts(iso).y || ''); }
function weekday(iso) { const { y, m, d } = parts(iso); if (!y) return ''; return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }); }
function fmtTime(t) {
  if (!t) return '';
  const [h, mi] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${mi ? ':' + String(mi).padStart(2, '0') : ''}${ap}`;
}
function timeRange(a, b) { return a ? (b ? `${fmtTime(a)} – ${fmtTime(b)}` : fmtTime(a)) : ''; }

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'event';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Plain text -> safe paragraphs. Blank line = new paragraph, single newline = <br>. */
function paras(text) {
  return String(text || '').trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}
function lines(text) { return String(text || '').split('\n').map((l) => l.replace(/^[\s•*\-–]+/, '').trim()).filter(Boolean); }

function money(n, currency = 'KES') {
  const v = Number(String(n || '').replace(/[^0-9.]/g, ''));
  if (!v) return '';
  return `${currency} ${v.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}
function num(n) { return Number(String(n || '').replace(/[^0-9.]/g, '')) || 0; }

function token() { return crypto.randomBytes(24).toString('hex'); }

function excerpt(text, n = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
}

/** Only allow http(s) links; add https:// to bare domains. Anything else becomes '#'. */
function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return 'https://' + s;
  return '#';
}

/** iCalendar file for an event (times are Kenya time, UTC+3). */
function icsFor(e, s, baseUrl) {
  const utc = (date, time) => {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = (time || '09:00').split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh - 3, mm)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  const escI = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const start = utc(e.start_date, e.start_time);
  const [sh, sm] = (e.start_time || '09:00').split(':').map(Number);
  const end = e.end_time ? utc(e.start_date, e.end_time) : utc(e.start_date, `${Math.min(sh + 3, 23)}:${sm}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Waithaka Foundation//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:event-${e.id}@${String(baseUrl).replace(/^https?:\/\//, '').replace(/[:/].*$/, '')}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${escI(e.title)}`, `LOCATION:${escI(e.venue || s.address)}`,
    `DESCRIPTION:${escI((e.summary || '') + '\n\n' + baseUrl + '/events/' + e.slug)}`, `URL:${baseUrl}/events/${e.slug}`,
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

/** WhatsApp click-to-chat number: Kenyan 07XX/01XX numbers become 2547XX/2541XX. */
function waNumber(n) {
  let d = String(n || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) d = '254' + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) d = '254' + d;
  return d;
}

/** srcset for an uploaded photo: phones get the 640px copy, larger screens the 1800px one. */
function srcset(file) {
  if (!file || !/-lg\.webp$/.test(file)) return '';
  return `/uploads/${file.replace(/-lg\.webp$/, '-sm.webp')} 640w, /uploads/${file} 1800w`;
}
function smallOf(file) { return file && /-lg\.webp$/.test(file) ? file.replace(/-lg\.webp$/, '-sm.webp') : file; }

function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

module.exports = { today, fmtDate, fmtDay, fmtMon, fmtYear, weekday, fmtTime, timeRange, slugify, esc, paras, lines, money, num, token, excerpt, isEmail, safeUrl, icsFor, waNumber, srcset, smallOf, MONTHS };
