'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { get, run, setSetting, getPool, DATA_DIR, UPLOAD_DIR } = require('./db');
const { processImage } = require('./media');

/** Creates the first admin if none exists. Password comes from env or is generated and written to data/. */
async function ensureAdmin() {
  if ((await get('SELECT COUNT(*) c FROM users')).c > 0) return null;
  const email = process.env.ADMIN_EMAIL || 'admin@waithakafoundation.org';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await run('INSERT INTO users(name,email,password_hash,must_change) VALUES(?,?,?,1)', 'Administrator', email, bcrypt.hashSync(password, 11));
  if (!process.env.ADMIN_PASSWORD) {
    const f = path.join(DATA_DIR, 'ADMIN_CREDENTIALS.txt');
    fs.writeFileSync(f, `First admin login for the Waithaka Foundation website\n\nEmail:    ${email}\nPassword: ${password}\n\nYou will be asked to set a new password on first login.\nDelete this file afterwards.\n`);
    console.log(`\n  First admin account created. Credentials written to ${f}\n`);
  }
  return { email };
}

// The land fundraiser took place on 7 November 2026 (the date of the foundation's brief).
const FUNDRAISER = {
  title: 'Fundraiser: Land for the Waithaka Foundation Complex', date: '2026-11-07', t1: null, t2: null, venue: '',
  summary: 'Friends, families, partners and well-wishers came together to raise funds to buy land for a permanent home for our elders.',
  body: 'Today the foundation hires halls and open fields for every gathering, and many elders cannot attend because of transport challenges.\n\nThis fundraiser was the first step towards the Waithaka Foundation Complex: a permanent, accessible home where we can reach many more senior citizens. Contributions towards the land are still welcome: see Support us.',
  ach: '', cover: null, featured: 0,
};
// Upcoming: the foundation's 5th anniversary in December 2026. The day is not fixed yet, so the event is
// dated the last day of the month (keeps it "upcoming" all December) and shown as "December 2026 · date to be confirmed".
const ANNIVERSARY = {
  slug: '5th-anniversary-celebration-december-2026', title: '5th Anniversary Celebration', date: '2026-12-31', tbc: true, t1: null, t2: null, venue: '',
  summary: 'Celebrating five years of the Waithaka Foundation with our elders, their families, volunteers, partners and friends.',
  body: 'Join us in December as we celebrate five years of walking with the elders of Kabuku and Limuru: five years of fellowship, care and dignity.\n\nThe date and venue will be announced here soon. Partners and well-wishers who would like to be part of the celebration are warmly invited to get in touch.',
  ach: '', cover: null, featured: 1,
};

/** Seeds starting content taken from the foundation's brief (7 Nov 2026). Only runs on an empty database. */
async function seedContent() {
  if ((await get('SELECT COUNT(*) c FROM milestones')).c > 0 || (await get('SELECT COUNT(*) c FROM events')).c > 0) return false;

  // The real photo from the brief: elders at a monthly fellowship gathering.
  let photoId = null;
  const src = path.join(__dirname, '..', 'seed', 'fellowship-gathering.jpg');
  if (fs.existsSync(src)) {
    const tmp = path.join(UPLOAD_DIR, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const copy = path.join(tmp, 'seed-' + Date.now());
    fs.copyFileSync(src, copy);
    const r = await processImage(copy);
    photoId = (await run(`INSERT INTO media(kind,file,thumb,title,caption,featured,width,height) VALUES('image',?,?,?,?,1,?,?)`,
      r.file, r.thumb, 'Elders at a monthly fellowship gathering',
      'Members of the foundation sharing fellowship, conversation and song at one of our monthly gatherings in Limuru.', r.width, r.height)).insertId;
    await setSetting('hero_image', r.file);
  }

  // Milestones: facts stated in the brief.
  const ms = [
    ['2022', 'The foundation is born', 'Started by the late Waithaka\'s family as Corporate Social Responsibility: a way of giving back to the Kabuku and Limuru community.'],
    ['2022', 'Monthly fellowship begins', 'Monthly gatherings for fellowship, conversation, listening and emotional support, held in rented halls and open grounds.'],
    ['Ongoing', 'Food and essential supplies', 'Food stuff and essential home supplies distributed to members at every monthly gathering.'],
    ['Ongoing', 'Health and wellness support', 'Health check-ups, referrals to health facilities and follow-up support for members living with chronic illness.'],
    ['Today', '100 registered senior citizens', 'One hundred registered members over the age of 80 across Limuru Sub-County, Kiambu County.'],
    ['2026', 'Fundraising for land', 'Fundraising launched to buy land for a permanent home: the Waithaka Foundation Complex.'],
  ];
  for (const [i, m] of ms.entries()) await run('INSERT INTO milestones(period,title,description,sort) VALUES(?,?,?,?)', m[0], m[1], m[2], i);

  // The land fundraiser (7 Nov 2026) and the upcoming 5th anniversary (December, date to be confirmed).
  // (Real past gatherings come from seed/gallery/events via importEvents.)
  const ev = [
    { slug: 'land-fundraiser-waithaka-foundation-complex', ...FUNDRAISER, sample: 1 },
    { ...ANNIVERSARY, sample: 0 },
  ];
  for (const e of ev) {
    await run(`INSERT INTO events(slug,title,start_date,date_tbc,start_time,end_time,venue,summary,body,achievements,cover_media_id,featured,sample)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, e.slug, e.title, e.date, e.tbc ? 1 : 0, e.t1, e.t2, e.venue, e.summary, e.body, e.ach, e.cover, e.featured || 0, e.sample);
  }
  return true;
}

/**
 * Imports the foundation's photos from seed/gallery (listed in photos.json) into the media library.
 * Each photo is imported once; the list of imported files is remembered, so a photo deleted in the
 * admin is not brought back on the next restart.
 */
async function importGallery() {
  const dir = path.join(__dirname, '..', 'seed', 'gallery');
  const listFile = path.join(dir, 'photos.json');
  if (!fs.existsSync(listFile)) return 0;
  const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  // A database lock makes this safe when two processes start at once (e.g. a PM2 reload).
  const conn = await getPool().getConnection();
  let n = 0;
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('waithaka_import_gallery', 60) AS ok");
    if (!lock.ok) return 0;
    const row = await get("SELECT svalue FROM settings WHERE skey='_imported_photos'");
    const done = new Set(row ? JSON.parse(row.svalue) : []);
    const base = Number((await get('SELECT COALESCE(MAX(sort),0) AS m FROM media')).m) + 1;
    const tmp = path.join(UPLOAD_DIR, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    for (const [i, p] of list.entries()) {
      const src = path.join(dir, p.file);
      if (done.has(p.file) || !fs.existsSync(src)) continue;
      const copy = path.join(tmp, 'import-' + Date.now() + '-' + i);
      fs.copyFileSync(src, copy);
      const r = await processImage(copy);
      await run("INSERT INTO media(kind,file,thumb,title,caption,featured,width,height,sort) VALUES('image',?,?,?,?,1,?,?,?)",
        r.file, r.thumb, p.title || '', p.caption || '', r.width, r.height, base + i);
      done.add(p.file);
      await setSetting('_imported_photos', JSON.stringify([...done])); // record each one immediately
      n++;
    }
    if (n) console.log(`  Imported ${n} photo${n > 1 ? 's' : ''} into the gallery.`);
  } finally {
    await conn.query("SELECT RELEASE_LOCK('waithaka_import_gallery')").catch(() => {});
    conn.release();
  }
  return n;
}

// Invented past examples from the first version of the site; removed once real gatherings exist,
// but only if nobody has edited them (editing clears the sample flag).
const INVENTED_PAST_EXAMPLES = ['monthly-fellowship-gathering-october-2026', 'health-check-up-and-referral-day-september-2026'];

/**
 * Creates the foundation's real past gatherings from seed/gallery/events/events.json, each with its photos.
 * Runs once per gathering (remembered in settings), safe if two processes start together.
 */
async function importEvents() {
  const dir = path.join(__dirname, '..', 'seed', 'gallery', 'events');
  const listFile = path.join(dir, 'events.json');
  if (!fs.existsSync(listFile)) return 0;
  const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  const conn = await getPool().getConnection();
  let made = 0;
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('waithaka_import_gallery', 120) AS ok");
    if (!lock.ok) return 0;
    const row = await get("SELECT svalue FROM settings WHERE skey='_imported_events'");
    const done = new Set(row ? JSON.parse(row.svalue) : []);
    const tmp = path.join(UPLOAD_DIR, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    for (const ev of list) {
      if (done.has(ev.date)) continue;
      let slug = ('fellowship-gathering-' + ev.date).toLowerCase();
      if (await get('SELECT id FROM events WHERE slug=?', slug)) slug += '-2';
      const { insertId: eventId } = await run(`INSERT INTO events(slug,title,start_date,summary,body,achievements,published,sample)
        VALUES(?,?,?,?,?,'',1,1)`, slug, ev.title, ev.date, ev.summary || '', ev.body || '');
      let cover = null;
      for (const [i, p] of (ev.photos || []).entries()) {
        const src = path.join(dir, p.file);
        if (!fs.existsSync(src)) continue;
        const copy = path.join(tmp, 'event-' + Date.now() + '-' + i);
        fs.copyFileSync(src, copy);
        const r = await processImage(copy);
        const { insertId } = await run("INSERT INTO media(kind,file,thumb,title,caption,event_id,featured,width,height,sort) VALUES('image',?,?,?,?,?,?,?,?,?)",
          r.file, r.thumb, p.title || '', p.caption || '', eventId, p.featured ? 1 : 0, r.width, r.height, i);
        if (!cover) cover = insertId;
      }
      if (cover) await run('UPDATE events SET cover_media_id=? WHERE id=?', cover, eventId);
      done.add(ev.date);
      await setSetting('_imported_events', JSON.stringify([...done]));
      made++;
    }
    if (made) {
      console.log(`  Added ${made} past gathering${made > 1 ? 's' : ''} with photos.`);
      // Real gatherings now document the track record: retire the invented examples if untouched.
      for (const slug of INVENTED_PAST_EXAMPLES) {
        const e = await get('SELECT id FROM events WHERE slug=? AND sample=1', slug);
        if (!e) continue;
        await run('UPDATE media SET event_id=NULL WHERE event_id=?', e.id);
        await run('DELETE FROM events WHERE id=?', e.id);
      }
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('waithaka_import_gallery')").catch(() => {});
    conn.release();
  }
  return made;
}

/**
 * One-off corrections to content created by earlier versions of the site. Each runs once and never
 * overwrites an event the team has already edited (editing in the admin clears the sample flag).
 */
async function applyContentFixes() {
  // Same lock as the photo imports: two processes starting together must not both apply a fix.
  const conn = await getPool().getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('waithaka_import_gallery', 120) AS ok");
    if (lock.ok) await applyContentFixesLocked();
  } finally {
    await conn.query("SELECT RELEASE_LOCK('waithaka_import_gallery')").catch(() => {});
    conn.release();
  }
}
async function applyContentFixesLocked() {
  // 1. The land fundraiser happened on 7 November 2026 (not the placeholder 28 November).
  if (!(await get("SELECT skey FROM settings WHERE skey='_fix_fundraiser_2026_11_07'"))) {
    await run(`UPDATE events SET start_date=?, start_time=NULL, end_time=NULL, venue='', summary=?, body=?, featured=0
      WHERE slug='land-fundraiser-waithaka-foundation-complex' AND sample=1 AND start_date='2026-11-28'`,
      FUNDRAISER.date, FUNDRAISER.summary, FUNDRAISER.body);
    await setSetting('_fix_fundraiser_2026_11_07', new Date().toISOString());
  }
  // 5. Clearer wording for the "80+" headline number, unless the team changed it.
  if (!(await get("SELECT skey FROM settings WHERE skey='_fix_age_label'"))) {
    await run("UPDATE settings SET svalue='Elders aged 80 and above' WHERE skey='stat_age_label' AND svalue='Years: the elders we serve'");
    await setSetting('_fix_age_label', new Date().toISOString());
  }
  // 3. The official tagline from the foundation's logo, unless the team has set their own.
  if (!(await get("SELECT skey FROM settings WHERE skey='_fix_tagline_logo'"))) {
    await run("UPDATE settings SET svalue='Celebrating Life' WHERE skey='tagline' AND svalue='Honouring the pillars of our community'");
    await setSetting('_fix_tagline_logo', new Date().toISOString());
  }
  // 4. Founder profile, phone/WhatsApp and social links supplied by the foundation (fills only empty settings).
  const founderFile = path.join(__dirname, '..', 'seed', 'team', 'founder.json');
  if (fs.existsSync(founderFile) && !(await get("SELECT skey FROM settings WHERE skey='_fix_founder_2026_11'"))) {
    const f = JSON.parse(fs.readFileSync(founderFile, 'utf8'));
    if (!(await get('SELECT id FROM team WHERE name=?', f.name))) {
      let photo = null;
      const src = path.join(__dirname, '..', 'seed', 'team', f.photo || '');
      if (f.photo && fs.existsSync(src)) {
        const tmp = path.join(UPLOAD_DIR, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
        const copy = path.join(tmp, 'team-' + Date.now()); fs.copyFileSync(src, copy);
        const r = await processImage(copy, { maxLarge: 900, maxSmall: 360 });
        photo = r.file;
      }
      await run("INSERT INTO team(name,role,bio,photo,grp,sort) VALUES(?,?,?,?, 'founder', 0)", f.name, f.role, f.bio, photo);
    }
    for (const [k, v] of Object.entries(f.settings || {})) {
      const cur = await get('SELECT svalue FROM settings WHERE skey=?', k);
      if (!cur || !String(cur.svalue || '').trim()) await setSetting(k, v);
    }
    await setSetting('_fix_founder_2026_11', new Date().toISOString());
  }
  // 2. The upcoming event is the 5th anniversary in December (date to be confirmed), not the Christmas placeholder.
  if (!(await get("SELECT skey FROM settings WHERE skey='_fix_anniversary_2026'"))) {
    if (!(await get('SELECT id FROM events WHERE slug=?', ANNIVERSARY.slug))) {
      const placeholder = await get("SELECT id FROM events WHERE slug='monthly-fellowship-gathering-december-2026' AND sample=1");
      const vals = [ANNIVERSARY.slug, ANNIVERSARY.title, ANNIVERSARY.date, ANNIVERSARY.summary, ANNIVERSARY.body];
      if (placeholder) {
        await run(`UPDATE events SET slug=?, title=?, start_date=?, date_tbc=1, start_time=NULL, end_time=NULL, venue='', summary=?, body=?,
          achievements='', featured=1, sample=0 WHERE id=?`, ...vals, placeholder.id);
      } else {
        await run(`INSERT INTO events(slug,title,start_date,date_tbc,summary,body,achievements,published,featured,sample) VALUES(?,?,?,1,?,?,'',1,1,0)`, ...vals);
      }
      await run('UPDATE events SET featured=0 WHERE slug<>?', ANNIVERSARY.slug);
    }
    await setSetting('_fix_anniversary_2026', new Date().toISOString());
  }
}

module.exports = { ensureAdmin, seedContent, importGallery, importEvents, applyContentFixes };
