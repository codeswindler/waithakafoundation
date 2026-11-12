'use strict';
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { all, get, run, getSettings, setSetting, DEFAULT_SETTINGS, UPLOAD_DIR } = require('../db');
const h = require('../helpers');
const { requireAdmin, limiter } = require('../auth');
const M = require('../media');

const router = express.Router();
const loginLimit = limiter({ windowMs: 15 * 60 * 1000, max: 10 });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const count = async (sql, ...p) => Number((await get(sql, ...p)).c);
const backTo = (req, fallback) => (req.body.back && /^\/admin\//.test(req.body.back) ? req.body.back : fallback);

function checkCsrf(req, res, next) {
  if ((req.body && req.body._csrf) !== req.session.csrf) {
    for (const f of [].concat(req.files || [], req.file || [])) M.safeUnlink(f.path);
    const e = new Error('Your session expired or the form was out of date. Please refresh the page and try again.');
    e.status = 403;
    return next(e);
  }
  next();
}
function flash(req, type, text) { req.session.flash = { type, text }; }
/** Uploads are sent by script with a progress bar; tell the script where to go instead of redirecting. */
function go(req, res, url) { return req.get('x-upload') === '1' ? res.json({ redirect: url }) : res.redirect(url); }

router.use(wrap(async (req, res, next) => {
  // Save the session (e.g. a flash message) to MySQL *before* redirecting; otherwise the browser can
  // request the next page before the save lands and the message is lost.
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => (req.session ? req.session.save(() => redirect(...args)) : redirect(...args));
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.unread = req.session.userId ? await count('SELECT COUNT(*) c FROM messages WHERE is_read=0') : 0;
  next();
}));

// ---------------- auth ----------------
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Sign in', error: null, email: '', next: req.query.next || '' });
});
router.post('/login', wrap(async (req, res, next) => {
  const email = String(req.body.email || '').trim();
  const nextUrl = /^\/admin(\/|$)/.test(req.body.next || '') ? req.body.next : '/admin';
  if (loginLimit(req.ip + '|' + email.toLowerCase())) {
    return res.status(429).render('admin/login', { title: 'Sign in', error: 'Too many attempts. Please wait 15 minutes and try again.', email, next: nextUrl });
  }
  const u = await get('SELECT * FROM users WHERE email=?', email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    return res.status(401).render('admin/login', { title: 'Sign in', error: 'That email and password do not match.', email, next: nextUrl });
  }
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = u.id;
    req.session.csrf = h.token();
    res.redirect(nextUrl);
  });
}));
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.use(requireAdmin);

// ---------------- dashboard ----------------
router.get('/', wrap(async (req, res) => {
  const s = await getSettings();
  const t = h.today();
  const [upcoming, past, photos, videos, mediaTotal, team, sampleEvents, upList, messages] = await Promise.all([
    count('SELECT COUNT(*) c FROM events WHERE start_date >= ?', t),
    count('SELECT COUNT(*) c FROM events WHERE start_date < ?', t),
    count("SELECT COUNT(*) c FROM media WHERE kind='image'"),
    count("SELECT COUNT(*) c FROM media WHERE kind!='image'"),
    count('SELECT COUNT(*) c FROM media'),
    count('SELECT COUNT(*) c FROM team'),
    all('SELECT id, title FROM events WHERE sample=1 ORDER BY start_date'),
    all('SELECT * FROM events WHERE start_date >= ? ORDER BY start_date LIMIT 5', t),
    all('SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT 5'),
  ]);
  const checklist = [
    { ok: !!s.email || !!s.phone, text: 'Add the foundation\'s phone number and email', href: '/admin/settings#contact' },
    { ok: !!s.mpesa_paybill || !!s.bank_details, text: 'Add M-Pesa Paybill or bank details so people can give', href: '/admin/settings#giving' },
    { ok: !!h.num(s.campaign_goal), text: 'Set the land campaign target (and amount raised so far)', href: '/admin/settings#campaign' },
    { ok: sampleEvents.length === 0, text: sampleEvents.length ? `Check the details of ${sampleEvents.length} event${sampleEvents.length > 1 ? 's' : ''} added at setup (venue, attendance, what was achieved)` : 'Events added at setup have been checked', href: '/admin/events' },
    { ok: mediaTotal >= 6, text: 'Upload photos and videos from past gatherings (aim for 6+)', href: '/admin/media' },
    { ok: team > 0, text: 'Introduce the Board of Directors and Executive Officer', href: '/admin/team' },
    { ok: !!(s.facebook || s.instagram || s.youtube || s.x || s.tiktok), text: 'Link the foundation\'s social media pages', href: '/admin/settings#social' },
  ];
  res.render('admin/dashboard', { title: 'Dashboard', counts: { upcoming, past, photos, videos }, checklist, upcoming: upList, messages });
}));

// ---------------- events ----------------
router.get('/events', wrap(async (req, res) => {
  const t = h.today();
  const list = await all(`SELECT e.*, COALESCE(m.thumb, (SELECT x.thumb FROM media x WHERE x.event_id=e.id AND x.kind='image' ORDER BY x.featured DESC, x.sort, x.id LIMIT 1)) AS cover_thumb,
    (SELECT COUNT(*) FROM media x WHERE x.event_id=e.id) AS media_count
    FROM events e LEFT JOIN media m ON m.id=e.cover_media_id ORDER BY e.start_date DESC`);
  res.render('admin/events', { title: 'Events', upcoming: list.filter((e) => e.start_date >= t).reverse(), past: list.filter((e) => e.start_date < t) });
}));
router.get('/events/new', (req, res) => res.render('admin/event-form', { title: 'New event', e: { published: 1, start_date: h.today() }, media: [], errors: null }));

function eventFromBody(b) {
  return {
    title: String(b.title || '').trim().slice(0, 160),
    start_date: String(b.start_date || '').trim(),
    date_tbc: b.date_tbc ? 1 : 0,
    start_time: /^\d\d:\d\d$/.test(b.start_time) ? b.start_time : null,
    end_time: /^\d\d:\d\d$/.test(b.end_time) ? b.end_time : null,
    venue: String(b.venue || '').trim().slice(0, 200),
    summary: String(b.summary || '').trim().slice(0, 400),
    body: String(b.body || '').trim().slice(0, 20000),
    achievements: String(b.achievements || '').trim().slice(0, 5000),
    attendance: b.attendance === '' || b.attendance == null ? null : Math.max(0, parseInt(b.attendance, 10) || 0),
    published: b.published ? 1 : 0,
    featured: b.featured ? 1 : 0,
    cover_media_id: b.cover_media_id ? Number(b.cover_media_id) || null : null,
  };
}
function eventErrors(e) {
  const errors = [];
  if (!e.title) errors.push('Give the event a title.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.start_date) || Number.isNaN(Date.parse(e.start_date))) errors.push('Choose the event date.');
  if (e.start_time && e.end_time && e.end_time <= e.start_time) errors.push('The end time must be after the start time.');
  // Month only: store the last day of that month so the event stays "upcoming" all month.
  if (e.date_tbc && !errors.length) { e.start_date = h.endOfMonth(e.start_date); e.start_time = null; e.end_time = null; }
  return errors;
}
async function uniqueSlug(title, date, ignoreId = 0) {
  const base = h.slugify(`${title}-${h.fmtMon(date)}-${h.fmtYear(date)}`.toLowerCase());
  let slug = base; let i = 2;
  while (await get('SELECT id FROM events WHERE slug=? AND id!=?', slug, ignoreId)) slug = `${base}-${i++}`;
  return slug;
}
const eventMedia = (id) => all('SELECT * FROM media WHERE event_id=? ORDER BY sort, id', id);

router.post('/events', wrap(async (req, res) => {
  const e = eventFromBody(req.body);
  const errors = eventErrors(e);
  if (errors.length) return res.status(400).render('admin/event-form', { title: 'New event', e, media: [], errors });
  const { insertId: id } = await run(`INSERT INTO events(slug,title,start_date,date_tbc,start_time,end_time,venue,summary,body,achievements,attendance,published,featured)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, await uniqueSlug(e.title, e.start_date), e.title, e.start_date, e.date_tbc, e.start_time, e.end_time, e.venue, e.summary, e.body, e.achievements, e.attendance, e.published, e.featured);
  if (e.featured) await run('UPDATE events SET featured=0 WHERE id!=?', id);
  flash(req, 'ok', 'Event created. Now add photos and videos below.');
  res.redirect(`/admin/events/${id}#media`);
}));
router.get('/events/:id', wrap(async (req, res, next) => {
  const e = await get('SELECT * FROM events WHERE id=?', req.params.id);
  if (!e) return next();
  res.render('admin/event-form', { title: 'Edit event', e, media: await eventMedia(e.id), errors: null });
}));
router.post('/events/:id', wrap(async (req, res, next) => {
  const old = await get('SELECT * FROM events WHERE id=?', req.params.id);
  if (!old) return next();
  const e = { ...eventFromBody(req.body), id: old.id, slug: old.slug, sample: old.sample };
  const errors = eventErrors(e);
  if (errors.length) return res.status(400).render('admin/event-form', { title: 'Edit event', e, media: await eventMedia(old.id), errors });
  const slug = old.title === e.title && old.start_date === e.start_date ? old.slug : await uniqueSlug(e.title, e.start_date, old.id);
  await run(`UPDATE events SET slug=?,title=?,start_date=?,date_tbc=?,start_time=?,end_time=?,venue=?,summary=?,body=?,achievements=?,attendance=?,published=?,featured=?,cover_media_id=?,sample=0,updated_at=NOW() WHERE id=?`,
    slug, e.title, e.start_date, e.date_tbc, e.start_time, e.end_time, e.venue, e.summary, e.body, e.achievements, e.attendance, e.published, e.featured, e.cover_media_id, old.id);
  if (e.featured) await run('UPDATE events SET featured=0 WHERE id!=?', old.id);
  flash(req, 'ok', 'Event saved.');
  res.redirect(`/admin/events/${old.id}`);
}));
/** Monthly gatherings repeat: copy an event to a new draft one month later, without its photos or results. */
router.post('/events/:id/duplicate', wrap(async (req, res, next) => {
  const e = await get('SELECT * FROM events WHERE id=?', req.params.id);
  if (!e) return next();
  const [y, m, d] = e.start_date.split('-').map(Number);
  const nd = new Date(Date.UTC(y, m, Math.min(d, 28)));
  const date = nd.toISOString().slice(0, 10);
  const { insertId } = await run(`INSERT INTO events(slug,title,start_date,start_time,end_time,venue,summary,body,achievements,published,featured)
    VALUES(?,?,?,?,?,?,?,?,'',0,0)`, await uniqueSlug(e.title, date), e.title, date, e.start_time, e.end_time, e.venue, e.summary, e.body);
  flash(req, 'ok', 'Copy created as a hidden draft one month later. Check the date and details, then tick "Show on website".');
  res.redirect(`/admin/events/${insertId}`);
}));
router.post('/events/:id/delete', wrap(async (req, res) => {
  const e = await get('SELECT * FROM events WHERE id=?', req.params.id);
  if (e) {
    if (req.body.with_media) {
      for (const m of await all('SELECT * FROM media WHERE event_id=?', e.id)) { M.deleteMediaFiles(m); await run('DELETE FROM media WHERE id=?', m.id); }
    } else {
      await run('UPDATE media SET event_id=NULL WHERE event_id=?', e.id);
    }
    await run('DELETE FROM events WHERE id=?', e.id);
    flash(req, 'ok', `"${e.title}" was deleted.`);
  }
  res.redirect('/admin/events');
}));

// ---------------- media ----------------
async function handleUploads(req, eventId) {
  const files = req.files || [];
  let n = 0;
  for (const f of files) {
    try { await M.saveUpload(f, { eventId, caption: req.body.caption || '' }); n++; } catch (err) {
      M.safeUnlink(f.path);
      console.error('Upload failed', f.originalname, err.message);
      for (const rest of files.slice(files.indexOf(f) + 1)) M.safeUnlink(rest.path);
      throw Object.assign(new Error(`"${f.originalname}" could not be processed. Is it a valid photo or video?${n ? ` (${n} earlier file${n > 1 ? 's were' : ' was'} saved.)` : ''}`), { status: 400 });
    }
  }
  const yt = String(req.body.youtube || '').split(/\s+/).filter(Boolean);
  for (const url of yt) {
    const id = M.parseYouTubeId(url);
    if (!id) throw Object.assign(new Error(`"${url}" is not a YouTube link we recognise. Copy the link from YouTube's Share button.`), { status: 400 });
    await run("INSERT INTO media(kind,youtube_id,title,caption,event_id) VALUES('youtube',?,?,?,?)", id, String(req.body.youtube_title || 'Video').slice(0, 160), req.body.caption || '', eventId);
    n++;
  }
  return n;
}

router.get('/media', wrap(async (req, res) => {
  const ev = req.query.event;
  let where = ''; const params = [];
  if (ev === 'none') where = 'WHERE m.event_id IS NULL';
  else if (ev) { where = 'WHERE m.event_id=?'; params.push(Number(ev)); }
  const [media, events] = await Promise.all([
    all(`SELECT m.*, e.title AS event_title FROM media m LEFT JOIN events e ON e.id=m.event_id ${where} ORDER BY m.created_at DESC, m.id DESC`, ...params),
    all('SELECT id, title, start_date FROM events ORDER BY start_date DESC'),
  ]);
  res.render('admin/media', { title: 'Photos & videos', media, events, filter: ev || '', maxMb: M.MAX_VIDEO_MB });
}));
router.post('/media/upload', M.upload.array('files', 40), checkCsrf, wrap(async (req, res) => {
  const eventId = req.body.event_id ? Number(req.body.event_id) : null;
  const n = await handleUploads(req, eventId);
  flash(req, n ? 'ok' : 'warn', n ? `${n} item${n > 1 ? 's' : ''} added.` : 'Choose at least one file or paste a YouTube link.');
  go(req, res, backTo(req, '/admin/media'));
}));
router.post('/media/:id', wrap(async (req, res, next) => {
  const m = await get('SELECT * FROM media WHERE id=?', req.params.id);
  if (!m) return next();
  await run('UPDATE media SET title=?, caption=?, event_id=?, featured=?, sort=? WHERE id=?',
    String(req.body.title || '').slice(0, 160), String(req.body.caption || '').slice(0, 600),
    req.body.event_id ? Number(req.body.event_id) : null, req.body.featured ? 1 : 0, parseInt(req.body.sort, 10) || 0, m.id);
  flash(req, 'ok', 'Saved.');
  res.redirect(backTo(req, '/admin/media'));
}));
router.post('/media/:id/delete', wrap(async (req, res) => {
  const m = await get('SELECT * FROM media WHERE id=?', req.params.id);
  if (m) {
    M.deleteMediaFiles(m);
    await run('DELETE FROM media WHERE id=?', m.id);
    await run('UPDATE events SET cover_media_id=NULL WHERE cover_media_id=?', m.id);
    const s = await getSettings();
    if (s.hero_image && s.hero_image === m.file) await setSetting('hero_image', '');
    flash(req, 'ok', 'Deleted.');
  }
  res.redirect(backTo(req, '/admin/media'));
}));
router.post('/media/:id/hero', wrap(async (req, res) => {
  const m = await get("SELECT * FROM media WHERE id=? AND kind='image'", req.params.id);
  if (m) { await setSetting('hero_image', m.file); flash(req, 'ok', 'Homepage banner photo updated.'); }
  res.redirect(backTo(req, '/admin/media'));
}));

// ---------------- milestones ----------------
router.get('/milestones', wrap(async (req, res) => {
  res.render('admin/milestones', { title: 'Achievements & milestones', items: await all('SELECT * FROM milestones ORDER BY sort, id'), edit: req.query.edit ? await get('SELECT * FROM milestones WHERE id=?', req.query.edit) : null });
}));
router.post('/milestones', wrap(async (req, res) => {
  const b = req.body;
  const title = String(b.title || '').trim();
  if (!title) { flash(req, 'warn', 'Give the milestone a title.'); return res.redirect('/admin/milestones'); }
  const vals = [String(b.period || '').trim().slice(0, 40), title.slice(0, 160), String(b.description || '').trim().slice(0, 1000), parseInt(b.sort, 10) || 0];
  if (b.id) await run('UPDATE milestones SET period=?, title=?, description=?, sort=? WHERE id=?', ...vals, Number(b.id));
  else await run('INSERT INTO milestones(period,title,description,sort) VALUES(?,?,?,?)', ...vals);
  flash(req, 'ok', 'Milestone saved.');
  res.redirect('/admin/milestones');
}));
router.post('/milestones/:id/delete', wrap(async (req, res) => { await run('DELETE FROM milestones WHERE id=?', req.params.id); flash(req, 'ok', 'Milestone deleted.'); res.redirect('/admin/milestones'); }));

// ---------------- partners & team (both have a single image) ----------------
function simpleCrud({ name, table, view, title, fields, imageField }) {
  router.get(`/${name}`, wrap(async (req, res) => {
    res.render(view, { title, items: await all(`SELECT * FROM ${table} ORDER BY sort, id`), edit: req.query.edit ? await get(`SELECT * FROM ${table} WHERE id=?`, req.query.edit) : null });
  }));
  router.post(`/${name}`, M.upload.single('image'), checkCsrf, wrap(async (req, res) => {
    const b = req.body;
    if (!String(b.name || '').trim()) { if (req.file) M.safeUnlink(req.file.path); flash(req, 'warn', 'Please enter a name.'); return go(req, res, `/admin/${name}`); }
    const vals = fields.map((f) => (f === 'sort' ? parseInt(b.sort, 10) || 0 : String(b[f] || '').trim().slice(0, 2000)));
    let img = null;
    if (req.file) img = await M.saveSingleImage(req.file, { maxLarge: 800, maxSmall: 200 });
    if (b.id) {
      const old = await get(`SELECT * FROM ${table} WHERE id=?`, b.id);
      await run(`UPDATE ${table} SET ${fields.map((f) => `${f}=?`).join(',')} WHERE id=?`, ...vals, Number(b.id));
      if (img || b.remove_image) {
        if (old && old[imageField]) M.safeUnlink(path.join(UPLOAD_DIR, old[imageField]));
        await run(`UPDATE ${table} SET ${imageField}=? WHERE id=?`, img, Number(b.id));
      }
    } else {
      await run(`INSERT INTO ${table}(${fields.join(',')},${imageField}) VALUES(${fields.map(() => '?').join(',')},?)`, ...vals, img);
    }
    flash(req, 'ok', 'Saved.');
    go(req, res, `/admin/${name}`);
  }));
  router.post(`/${name}/:id/delete`, wrap(async (req, res) => {
    const old = await get(`SELECT * FROM ${table} WHERE id=?`, req.params.id);
    if (old) { if (old[imageField]) M.safeUnlink(path.join(UPLOAD_DIR, old[imageField])); await run(`DELETE FROM ${table} WHERE id=?`, old.id); }
    flash(req, 'ok', 'Deleted.');
    res.redirect(`/admin/${name}`);
  }));
}
simpleCrud({ name: 'partners', table: 'partners', view: 'admin/partners', title: 'Partners & sponsors', fields: ['name', 'url', 'tier', 'sort'], imageField: 'logo' });
simpleCrud({ name: 'team', table: 'team', view: 'admin/team', title: 'Board & team', fields: ['name', 'role', 'bio', 'grp', 'sort'], imageField: 'photo' });

// ---------------- settings ----------------
const EDITABLE = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'hero_image');
router.get('/settings', (req, res) => res.render('admin/settings', { title: 'Site content & settings', emailReady: !!process.env.SMTP_HOST }));
router.post('/settings', M.upload.single('hero'), checkCsrf, wrap(async (req, res) => {
  for (const k of EDITABLE) if (k in req.body) await setSetting(k, String(req.body[k]).trim().slice(0, 10000));
  if (req.file) {
    const id = await M.saveUpload(req.file, { title: 'Homepage banner', featured: 1 });
    const m = await get('SELECT * FROM media WHERE id=?', id);
    if (m.kind === 'image') await setSetting('hero_image', m.file);
  }
  flash(req, 'ok', 'Website content saved. Changes are live.');
  go(req, res, '/admin/settings' + (req.body.section ? '#' + req.body.section.replace(/[^a-z]/g, '') : ''));
}));

// ---------------- messages ----------------
router.get('/messages', wrap(async (req, res) => {
  const type = ['contact', 'volunteer', 'partner'].includes(req.query.type) ? req.query.type : null;
  const items = type ? await all('SELECT * FROM messages WHERE type=? ORDER BY created_at DESC, id DESC', type) : await all('SELECT * FROM messages ORDER BY created_at DESC, id DESC');
  res.render('admin/messages', { title: 'Messages', items, type });
}));
router.post('/messages/:id/read', wrap(async (req, res) => { await run('UPDATE messages SET is_read = 1 - is_read WHERE id=?', req.params.id); res.redirect('/admin/messages'); }));
router.post('/messages/:id/delete', wrap(async (req, res) => { await run('DELETE FROM messages WHERE id=?', req.params.id); flash(req, 'ok', 'Message deleted.'); res.redirect('/admin/messages'); }));

// ---------------- account & admins ----------------
const users = () => all('SELECT id,name,email,created_at FROM users ORDER BY id');
router.get('/account', wrap(async (req, res) => res.render('admin/account', { title: 'Account & admins', first: req.query.first, users: await users(), errors: null })));
router.post('/account/password', wrap(async (req, res) => {
  const u = await get('SELECT * FROM users WHERE id=?', req.user.id);
  const errors = [];
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) errors.push('Your current password is not correct.');
  if (String(req.body.password || '').length < 10) errors.push('Choose a new password of at least 10 characters.');
  if (req.body.password !== req.body.confirm) errors.push('The two new passwords do not match.');
  if (errors.length) return res.status(400).render('admin/account', { title: 'Account & admins', first: !!u.must_change, users: await users(), errors });
  await run('UPDATE users SET password_hash=?, must_change=0, name=? WHERE id=?', bcrypt.hashSync(req.body.password, 11), String(req.body.name || u.name).trim().slice(0, 120) || u.name, u.id);
  flash(req, 'ok', 'Password updated.');
  res.redirect(u.must_change ? '/admin' : '/admin/account');
}));
router.post('/account/users', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const pw = String(req.body.password || '');
  if (!h.isEmail(email) || pw.length < 10) { flash(req, 'warn', 'Enter a valid email and a temporary password of at least 10 characters.'); return res.redirect('/admin/account'); }
  if (await get('SELECT id FROM users WHERE email=?', email)) { flash(req, 'warn', 'That email already has an admin account.'); return res.redirect('/admin/account'); }
  await run('INSERT INTO users(name,email,password_hash,must_change) VALUES(?,?,?,1)', String(req.body.name || '').trim().slice(0, 120) || email, email, bcrypt.hashSync(pw, 11));
  flash(req, 'ok', `Admin added. Give ${email} their temporary password; they will be asked to change it when they first sign in.`);
  res.redirect('/admin/account');
}));
router.post('/account/users/:id/delete', wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) flash(req, 'warn', 'You cannot remove your own account.');
  else { await run('DELETE FROM users WHERE id=?', req.params.id); flash(req, 'ok', 'Admin removed.'); }
  res.redirect('/admin/account');
}));

module.exports = router;
