'use strict';
const express = require('express');
const { all, get, run, getSettings } = require('../db');
const h = require('../helpers');
const { limiter } = require('../auth');
const { notify } = require('../notify');

const router = express.Router();
const formLimit = limiter({ windowMs: 60 * 60 * 1000, max: 8 });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Cover = the chosen cover photo, or else the event's best photo.
const EVENT_COLS = `e.*,
  COALESCE(m.file,  (SELECT x.file  FROM media x WHERE x.event_id=e.id AND x.kind='image' ORDER BY x.featured DESC, x.sort, x.id LIMIT 1)) AS cover_file,
  COALESCE(m.thumb, (SELECT x.thumb FROM media x WHERE x.event_id=e.id AND x.kind='image' ORDER BY x.featured DESC, x.sort, x.id LIMIT 1)) AS cover_thumb,
  (SELECT COUNT(*) FROM media x WHERE x.event_id=e.id) AS media_count,
  (SELECT COUNT(*) FROM media x WHERE x.event_id=e.id AND x.kind='image') AS photo_count`;
const EVENT_FROM = 'events e LEFT JOIN media m ON m.id = e.cover_media_id';

const upcoming = (limit = 50) => all(`SELECT ${EVENT_COLS} FROM ${EVENT_FROM} WHERE e.published=1 AND e.start_date >= ? ORDER BY e.start_date ASC, e.start_time ASC LIMIT ?`, h.today(), limit);
const past = (limit = 200) => all(`SELECT ${EVENT_COLS} FROM ${EVENT_FROM} WHERE e.published=1 AND e.start_date < ? ORDER BY e.start_date DESC LIMIT ?`, h.today(), limit);
const partners = () => all('SELECT * FROM partners ORDER BY sort, id');

async function stats() {
  const r = await get(`SELECT
    (SELECT COUNT(*) FROM events WHERE published=1 AND start_date < ?) AS eventsHeld,
    (SELECT COALESCE(SUM(attendance),0) FROM events WHERE published=1 AND start_date < ?) AS attendance,
    (SELECT COUNT(*) FROM media WHERE kind='image') AS photos,
    (SELECT COUNT(*) FROM media WHERE kind!='image') AS videos`, h.today(), h.today());
  return { eventsHeld: Number(r.eventsHeld), attendance: Number(r.attendance), photos: Number(r.photos), videos: Number(r.videos) };
}

router.get('/', wrap(async (req, res) => {
  const [featuredMedia, up, pastList, milestones, partnerList, st] = await Promise.all([
    all(`SELECT m.*, e.title AS event_title, e.slug AS event_slug FROM media m LEFT JOIN events e ON e.id=m.event_id
      ORDER BY m.featured DESC, m.sort, m.created_at DESC, m.id DESC LIMIT 12`),
    upcoming(3), past(3), all('SELECT * FROM milestones ORDER BY sort, id LIMIT 6'), partners(), stats(),
  ]);
  // Hero slideshow: the chosen banner first, then wide "Show on homepage" photos (portrait shots crop badly behind text).
  const hero = res.locals.s.hero_image;
  const wide = await all("SELECT file, title FROM media WHERE kind='image' AND featured=1 AND width >= height * 1.25 ORDER BY sort, id LIMIT 7");
  const slides = [...(hero ? [{ file: hero, title: '' }] : []), ...wide.filter((m) => m.file !== hero)].slice(0, 6);
  const featuredUp = up.find((e) => e.featured) || (await get(`SELECT ${EVENT_COLS} FROM ${EVENT_FROM} WHERE e.published=1 AND e.featured=1 AND e.start_date >= ? LIMIT 1`, h.today()));
  res.render('home', { title: null, slides, upcoming: up, next: featuredUp || up[0] || null, past: pastList, featuredMedia, milestones, partners: partnerList, stats: st });
}));

router.get('/about', wrap(async (req, res) => {
  res.render('about', {
    title: 'About us',
    board: await all("SELECT * FROM team WHERE grp='board' ORDER BY sort, id"),
    secretariat: await all("SELECT * FROM team WHERE grp='secretariat' ORDER BY sort, id"),
  });
}));

router.get('/programmes', wrap(async (req, res) => {
  res.render('programmes', { title: 'Our programmes', photos: await all("SELECT * FROM media WHERE kind='image' ORDER BY featured DESC, created_at DESC LIMIT 3") });
}));

router.get('/events', wrap(async (req, res) => {
  const [up, p] = await Promise.all([upcoming(), past()]);
  const years = [...new Set(p.map((e) => h.fmtYear(e.start_date)))];
  res.render('events', { title: 'Events', upcoming: up, past: p, years });
}));

async function findEvent(slug) { return get(`SELECT ${EVENT_COLS} FROM ${EVENT_FROM} WHERE e.slug=? AND e.published=1`, slug); }

router.get('/events/:slug.ics', wrap(async (req, res, next) => {
  const e = await findEvent(req.params.slug);
  if (!e) return next();
  const s = await getSettings();
  res.type('text/calendar').attachment(`${e.slug}.ics`).send(h.icsFor(e, s, res.locals.baseUrl));
}));

router.get('/events/:slug', wrap(async (req, res, next) => {
  const e = await findEvent(req.params.slug);
  if (!e) return next();
  const [media, related] = await Promise.all([
    all('SELECT * FROM media WHERE event_id=? ORDER BY sort, id', e.id),
    all(`SELECT ${EVENT_COLS} FROM ${EVENT_FROM} WHERE e.published=1 AND e.id!=? ORDER BY ABS(DATEDIFF(e.start_date, ?)) LIMIT 3`, e.id, e.start_date),
  ]);
  res.render('event', { title: e.title, e, media, isUpcoming: e.start_date >= h.today(), related, ogImage: e.cover_file, description: e.summary });
}));

router.get('/gallery', wrap(async (req, res) => {
  const type = ['photos', 'videos'].includes(req.query.type) ? req.query.type : 'all';
  const where = type === 'photos' ? "WHERE m.kind='image'" : type === 'videos' ? "WHERE m.kind!='image'" : '';
  const [media, counts] = await Promise.all([
    all(`SELECT m.*, e.title AS event_title, e.slug AS event_slug, e.start_date FROM media m LEFT JOIN events e ON e.id=m.event_id ${where}
      ORDER BY COALESCE(e.start_date, DATE(m.created_at)) DESC, m.sort, m.id`),
    stats(),
  ]);
  res.render('gallery', { title: 'Gallery', media, type, counts });
}));

router.get('/impact', wrap(async (req, res) => {
  const [milestones, p, st] = await Promise.all([all('SELECT * FROM milestones ORDER BY sort, id'), past(12), stats()]);
  res.render('impact', { title: 'Our impact', milestones, past: p, stats: st });
}));

router.get('/support', wrap(async (req, res) => {
  res.render('support', { title: 'Support our work', partners: await partners(), sent: req.query.sent, kind: req.query.kind });
}));

router.get('/contact', (req, res) => res.render('contact', { title: 'Contact us', sent: req.query.sent, errors: null, form: {} }));

// One handler for contact, volunteer and partner enquiries.
router.post(['/contact', '/support/enquiry'], wrap(async (req, res) => {
  const b = req.body || {};
  const type = ['volunteer', 'partner', 'contact'].includes(b.type) ? b.type : 'contact';
  const back = req.path === '/contact' ? '/contact' : '/support';
  // Spam traps: hidden field must be empty, form must take more than 2 seconds to fill.
  if (b.website || (b.t && Date.now() - Number(b.t) < 2000)) return res.redirect(`${back}?sent=1&kind=${type}#form`);
  if (formLimit(req.ip)) return res.status(429).render('error', { title: 'Too many messages', status: 429, message: 'You have sent several messages in a short time. Please wait a while, or call us directly.' });

  const form = { name: (b.name || '').trim().slice(0, 120), email: (b.email || '').trim().slice(0, 160), phone: (b.phone || '').trim().slice(0, 40), organisation: (b.organisation || '').trim().slice(0, 160), message: (b.message || '').trim().slice(0, 5000) };
  const errors = [];
  if (!form.name) errors.push('Please tell us your name.');
  if (!form.email && !form.phone) errors.push('Please give an email address or phone number so we can reply.');
  if (form.email && !h.isEmail(form.email)) errors.push('That email address does not look right.');
  if (!form.message && type === 'contact') errors.push('Please write a short message.');
  if (errors.length) {
    if (back === '/contact') return res.status(400).render('contact', { title: 'Contact us', sent: null, errors, form });
    return res.status(400).render('support', { title: 'Support our work', partners: await partners(), sent: null, kind: type, errors, form });
  }
  await run('INSERT INTO messages(type,name,email,phone,organisation,message) VALUES(?,?,?,?,?,?)', type, form.name, form.email, form.phone, form.organisation, form.message);
  notify({ type, ...form }, res.locals.s, res.locals.baseUrl); // email the team if configured; never blocks the visitor
  res.redirect(`${back}?sent=1&kind=${type}#form`);
}));

router.get('/sitemap.xml', wrap(async (req, res) => {
  const base = res.locals.baseUrl;
  const urls = ['/', '/about', '/programmes', '/events', '/gallery', '/impact', '/support', '/contact',
    ...(await all('SELECT slug FROM events WHERE published=1')).map((e) => `/events/${e.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${h.esc(base + u)}</loc></url>`).join('')}</urlset>`);
}));

module.exports = router;
