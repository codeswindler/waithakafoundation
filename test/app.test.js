'use strict';
// End-to-end tests against a real server on a throwaway database and upload folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_EMAIL = 'test-admin@example.test';
// A dedicated, throwaway MySQL/MariaDB database. Its tables are dropped at the start of every run.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://root:@127.0.0.1:3306/waithaka_test';
if (!/test/i.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"');
process.env.ADMIN_PASSWORD = 'first-test-pass-123';

const sharp = require('sharp');
const { createApp } = require('../src/app');
const { ensureAdmin, seedContent } = require('../src/seed');
const db = require('../src/db');

let server, base;
const NEW_PW = 'second-test-pass-456';

// --- a tiny cookie-keeping client ---
function client() {
  const jar = {};
  async function req(method, url, { form, body, headers = {} } = {}) {
    const h = { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload = body;
    if (form) { payload = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    res.text_ = await res.text();
    return res;
  }
  return { req, jar };
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];

async function loggedIn() {
  const c = client();
  let r = await c.req('GET', '/admin/login');
  const csrf = csrfOf(r.text_);
  r = await c.req('POST', '/admin/login', { form: { _csrf: csrf, email: process.env.ADMIN_EMAIL, password: NEW_PW, next: '' } });
  assert.equal(r.status, 302, 'login should redirect');
  r = await c.req('GET', '/admin');
  c.csrf = csrfOf(r.text_);
  return c;
}

before(async () => {
  await db.init();
  for (const t of ['sessions', 'messages', 'team', 'partners', 'milestones', 'events', 'media', 'settings', 'users']) await db.run(`DROP TABLE IF EXISTS ${t}`);
  db.clearSettingsCache();
  await db.init();
  await ensureAdmin();
  await seedContent();
  const app = await createApp();
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server && server.close(); await db.close(); });

test('every public page renders with the brief content', async () => {
  const c = client();
  const checks = {
    '/': ['Dignity, comfort', 'Three programmes', 'Waithaka Foundation Complex'],
    '/about': ['2022', 'Compassion', 'Audit Committee', 'Governance Committee', 'Human Resource Committee'],
    '/programmes': ['Companionship', 'Food', 'Health', 'Transport'],
    '/events': ['Upcoming', 'Past events'],
    '/gallery': ['Photos'],
    '/impact': ['Milestones', '100 registered senior citizens'],
    '/support': ['Sponsor a gathering', 'Payment details'],
    '/contact': ['Send a message', 'Limuru'],
  };
  for (const [url, needles] of Object.entries(checks)) {
    const r = await c.req('GET', url);
    assert.equal(r.status, 200, url);
    for (const n of needles) assert.ok(r.text_.includes(n), `${url} should mention "${n}"`);
    assert.ok(!/undefined|NaN|\[object Object\]/.test(r.text_.replace(/<script[\s\S]*?<\/script>/g, '')), `${url} has a rendering glitch`);
  }
  assert.equal((await c.req('GET', '/does-not-exist')).status, 404);
  assert.equal((await c.req('GET', '/brief.pdf')).status, 404, 'the brief PDF is not published');
  assert.ok(Object.keys(c.jar).length === 0, 'public pages must not set cookies');
});

test('seeded events split into upcoming and past and their pages work', async () => {
  const c = client();
  const r = await c.req('GET', '/events');
  const slugs = [...r.text_.matchAll(/href="\/events\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(slugs.length >= 4);
  for (const s of new Set(slugs)) assert.equal((await c.req('GET', '/events/' + s)).status, 200, s);
});

test('contact and partner forms store messages, validate, and trap bots', async () => {
  const c = client();
  const t = String(Date.now() - 5000);
  let r = await c.req('POST', '/contact', { form: { type: 'contact', name: 'Jane Wanjiku', email: 'jane@example.test', message: 'How can our church help?', t } });
  assert.equal(r.status, 302);
  r = await c.req('POST', '/support/enquiry', { form: { type: 'partner', name: 'Peter', organisation: 'Acme Ltd', phone: '0700000000', message: 'Sponsorship', t } });
  assert.equal(r.status, 302);
  r = await c.req('POST', '/contact', { form: { type: 'contact', name: '', email: 'bad', message: '', t } });
  assert.equal(r.status, 400);
  assert.ok(r.text_.includes('Please tell us your name'));
  r = await c.req('POST', '/contact', { form: { type: 'contact', name: 'Bot', email: 'b@b.co', message: 'spam', website: 'http://spam', t } });
  assert.equal(r.status, 302); // silently dropped
  assert.equal(Number((await db.get('SELECT COUNT(*) c FROM messages')).c), 2);
});

test('admin requires login, forces a password change, and rejects bad CSRF', async () => {
  const c = client();
  let r = await c.req('GET', '/admin/events');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/admin\/login/);

  r = await c.req('GET', '/admin/login');
  const csrf = csrfOf(r.text_);
  r = await c.req('POST', '/admin/login', { form: { _csrf: csrf, email: process.env.ADMIN_EMAIL, password: 'wrong', next: '' } });
  assert.equal(r.status, 401);
  r = await c.req('POST', '/admin/login', { form: { _csrf: csrf, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, next: '' } });
  assert.equal(r.status, 302);

  r = await c.req('GET', '/admin');
  assert.equal(r.status, 302, 'first login must be sent to change password');
  assert.match(r.headers.get('location'), /account\?first=1/);
  r = await c.req('GET', '/admin/account?first=1');
  const csrf2 = csrfOf(r.text_);
  r = await c.req('POST', '/admin/account/password', { form: { _csrf: 'nope', current: process.env.ADMIN_PASSWORD, password: NEW_PW, confirm: NEW_PW } });
  assert.equal(r.status, 403);
  r = await c.req('POST', '/admin/account/password', { form: { _csrf: csrf2, current: process.env.ADMIN_PASSWORD, password: NEW_PW, confirm: NEW_PW } });
  assert.equal(r.status, 302, 'password change should succeed: ' + r.text_.slice(0, 300));
  r = await c.req('GET', '/admin');
  assert.equal(r.status, 200);
  assert.ok(r.text_.includes('Launch checklist'));
});

test('admin can create an event, upload photos/videos/YouTube, and it appears publicly', async () => {
  const c = await loggedIn();
  let r = await c.req('POST', '/admin/events', { form: { _csrf: c.csrf, title: 'Test Health Day', start_date: '2025-03-15', start_time: '09:00', end_time: '13:00', venue: 'Kabuku Hall', summary: 'Free screening', body: 'Para one.\n\nPara two.', achievements: '80 elders screened\n12 referrals', attendance: '86', published: '1' } });
  assert.equal(r.status, 302);
  const id = r.headers.get('location').match(/events\/(\d+)/)[1];

  // multipart upload: a real JPEG, a small "video" and a YouTube link, sent the way the progress-bar script sends it
  const jpg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2b5239' } }).jpeg().toBuffer();
  const fd = new FormData();
  fd.append('_csrf', c.csrf); fd.append('event_id', id); fd.append('back', `/admin/events/${id}#media`);
  fd.append('caption', 'Screening line');
  fd.append('files', new Blob([jpg], { type: 'image/jpeg' }), 'screening.jpg');
  fd.append('files', new Blob([Buffer.alloc(2048)], { type: 'video/mp4' }), 'clip.mp4');
  fd.append('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  fd.append('youtube_title', 'Event video');
  r = await c.req('POST', '/admin/media/upload', { body: fd, headers: { 'x-upload': '1' } });
  assert.equal(r.status, 200, r.text_.slice(0, 300));
  assert.deepEqual(JSON.parse(r.text_), { redirect: `/admin/events/${id}#media` });

  const { all, get } = db;
  const media = await all('SELECT * FROM media WHERE event_id=?', id);
  assert.equal(media.length, 3);
  const img = media.find((m) => m.kind === 'image');
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, img.file)) && fs.existsSync(path.join(process.env.UPLOAD_DIR, img.thumb)));
  assert.equal(img.width, 1200);

  // flash message survives to the next page view
  r = await c.req('GET', `/admin/events/${id}`);
  assert.ok(r.text_.includes('3 items added'));

  const slug = (await get('SELECT slug FROM events WHERE id=?', id)).slug;
  r = await client().req('GET', '/events/' + slug);
  assert.equal(r.status, 200);
  for (const n of ['Test Health Day', '80 elders screened', 'What we achieved', '86', img.thumb, 'dQw4w9WgXcQ', 'Para two.']) assert.ok(r.text_.includes(n), 'event page should show ' + n);
  const g = await client().req('GET', '/gallery?type=videos');
  assert.ok(g.text_.includes('dQw4w9WgXcQ'));
  const served = await fetch(base + '/uploads/' + img.file);
  assert.equal(served.status, 200);

  // bad upload type is refused cleanly
  const bad = new FormData();
  bad.append('_csrf', c.csrf);
  bad.append('files', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');
  r = await c.req('POST', '/admin/media/upload', { body: bad });
  assert.equal(r.status, 400);
  assert.ok(r.text_.includes('not a supported photo or video'));

  // set as banner, then delete photo
  r = await c.req('POST', `/admin/media/${img.id}/hero`, { form: { _csrf: c.csrf } });
  assert.equal((await db.getSettings()).hero_image, img.file);
  r = await c.req('POST', `/admin/media/${img.id}/delete`, { form: { _csrf: c.csrf } });
  assert.ok(!fs.existsSync(path.join(process.env.UPLOAD_DIR, img.file)));
  assert.equal((await db.getSettings()).hero_image, '');

  // calendar file for the event
  const ics = await fetch(`${base}/events/${slug}.ics`);
  assert.equal(ics.status, 200);
  assert.match(await ics.text(), /DTSTART:20250315T060000Z/);

  // copy for next month: hidden draft, one month later, no media
  r = await c.req('POST', `/admin/events/${id}/duplicate`, { form: { _csrf: c.csrf } });
  assert.equal(r.status, 302);
  const copyId = r.headers.get('location').match(/events\/(\d+)/)[1];
  const copy = await get('SELECT * FROM events WHERE id=?', copyId);
  assert.equal(copy.start_date, '2025-04-15');
  assert.equal(copy.published, 0);
  assert.equal(Number((await get('SELECT COUNT(*) c FROM media WHERE event_id=?', copyId)).c), 0);
  await c.req('POST', `/admin/events/${copyId}/delete`, { form: { _csrf: c.csrf } });

  // impact page totals attendance
  assert.ok((await client().req('GET', '/impact')).text_.includes('Total attendance'));

  // validation: end before start
  r = await c.req('POST', `/admin/events/${id}`, { form: { _csrf: c.csrf, title: 'X', start_date: '2025-03-15', start_time: '14:00', end_time: '10:00' } });
  assert.equal(r.status, 400);
  assert.ok(r.text_.includes('end time must be after'));

  // edit and delete event
  r = await c.req('POST', `/admin/events/${id}`, { form: { _csrf: c.csrf, title: 'Test Health Day (edited)', start_date: '2025-03-15', published: '1' } });
  assert.equal(r.status, 302);
  r = await c.req('POST', `/admin/events/${id}/delete`, { form: { _csrf: c.csrf, with_media: '1' } });
  assert.equal(Number((await get('SELECT COUNT(*) c FROM events WHERE id=?', id)).c), 0);
  assert.equal(Number((await get('SELECT COUNT(*) c FROM media WHERE event_id=?', id)).c), 0);
});

test('admin edits site settings, campaign progress, milestones, partners, team', async () => {
  const c = await loggedIn();
  db.clearSettingsCache();
  const fd = new FormData();
  fd.append('_csrf', c.csrf);
  for (const [k, v] of Object.entries({ campaign_goal: '5,000,000', campaign_raised: '1250000', mpesa_paybill: '123456', mpesa_account: 'LAND', phone: '0712 345 678', email: 'info@example.test', facebook: 'javascript:alert(1)', hero_title: 'Edited headline' })) fd.append(k, v);
  let r = await c.req('POST', '/admin/settings', { body: fd });
  assert.equal(r.status, 302);
  const home = await client().req('GET', '/');
  assert.ok(home.text_.includes('Edited headline'));
  assert.ok(home.text_.includes('KES 1,250,000') && home.text_.includes('25%'), 'campaign progress should show');
  assert.ok(!home.text_.includes('javascript:alert'), 'unsafe social links must be neutralised');
  const sup = await client().req('GET', '/support');
  assert.ok(sup.text_.includes('123456') && sup.text_.includes('LAND'));

  r = await c.req('POST', '/admin/milestones', { form: { _csrf: c.csrf, period: '2025', title: '1,000 hampers delivered', description: 'Across the year', sort: '9' } });
  assert.ok((await client().req('GET', '/impact')).text_.includes('1,000 hampers delivered'));

  const pf = new FormData();
  pf.append('_csrf', c.csrf); pf.append('name', 'Limuru Rotary Club'); pf.append('tier', 'Event sponsor'); pf.append('url', 'limururotary.example');
  pf.append('image', new Blob([await sharp({ create: { width: 300, height: 120, channels: 4, background: '#ffffff00' } }).png().toBuffer()], { type: 'image/png' }), 'logo.png');
  r = await c.req('POST', '/admin/partners', { body: pf });
  assert.equal(r.status, 302);
  const h2 = await client().req('GET', '/');
  assert.ok(h2.text_.includes('alt="Limuru Rotary Club"') && h2.text_.includes('https://limururotary.example'));

  const tf = new FormData();
  tf.append('_csrf', c.csrf); tf.append('name', 'Mary Njeri'); tf.append('role', 'Chairperson'); tf.append('grp', 'board');
  r = await c.req('POST', '/admin/team', { body: tf });
  assert.ok((await client().req('GET', '/about')).text_.includes('Mary Njeri'));

  r = await c.req('GET', '/admin');
  assert.ok(/class="ok"><span class="tick">.*Add M-Pesa/s.test(r.text_) || r.text_.includes('Add M-Pesa'));
  r = await c.req('GET', '/admin/messages');
  assert.ok(r.text_.includes('Acme Ltd') && r.text_.includes('Jane Wanjiku'));
});

test('XSS in admin content is escaped on the public site', async () => {
  const c = await loggedIn();
  await c.req('POST', '/admin/events', { form: { _csrf: c.csrf, title: '<script>alert(1)</script>Evil', start_date: '2030-01-01', body: '<img src=x onerror=alert(1)>', published: '1' } });
  const r = await client().req('GET', '/events');
  assert.ok(!r.text_.includes('<script>alert(1)</script>'));
  assert.ok(r.text_.includes('&lt;script&gt;'));
});

test('health check reports the database is reachable', async () => {
  const r = await fetch(base + '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('every admin page opens without errors', async () => {
  const c = await loggedIn();
  const ev = await db.get('SELECT id FROM events ORDER BY id LIMIT 1');
  const pages = ['/admin', '/admin/events', '/admin/events/new', `/admin/events/${ev.id}`, '/admin/media', '/admin/media?event=none',
    '/admin/milestones', '/admin/milestones?edit=1', '/admin/partners', '/admin/team', '/admin/settings', '/admin/messages',
    '/admin/messages?type=partner', '/admin/account'];
  for (const p of pages) {
    const r = await c.req('GET', p);
    assert.equal(r.status, 200, `${p} returned ${r.status}`);
    assert.ok(!/undefined|NaN|\[object Object\]/.test(r.text_.replace(/<script[\s\S]*?<\/script>/g, '')), `${p} has a rendering glitch`);
  }
});

test('flash messages survive the redirect after an admin action', async () => {
  const c = await loggedIn();
  let r = await c.req('POST', '/admin/milestones', { form: { _csrf: c.csrf, title: 'Flash check', period: '2026' } });
  assert.equal(r.status, 302);
  r = await c.req('GET', '/admin/milestones');
  assert.ok(r.text_.includes('Milestone saved.'));
});
