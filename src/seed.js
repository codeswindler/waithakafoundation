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

  // Example events so the site is not empty on day one. Flagged sample=1: replace with real ones in admin.
  const ev = [
    {
      slug: 'monthly-fellowship-gathering-october-2026', title: 'Monthly Fellowship & Wellness Gathering', date: '2026-10-17', t1: '10:00', t2: '15:00',
      venue: 'Community hall, Kabuku, Limuru',
      summary: 'Our elders came together for fellowship, song, a shared meal and health checks, and went home with food and essential supplies.',
      body: 'Our monthly gathering brought members together for an afternoon of fellowship, conversation and listening.\n\nVolunteers and facilitators led the programme, health workers carried out check-ups, and every member received food stuff and essential home supplies to take home. Transport was arranged for members who cannot walk to the venue.',
      ach: 'Fellowship, listening and emotional support sessions\nHealth check-ups with referrals where needed\nFood and essential home supplies distributed to members\nTransport provided for elders with mobility challenges',
      cover: photoId,
    },
    {
      slug: 'health-check-up-and-referral-day-september-2026', title: 'Health Check-up & Referral Day', date: '2026-09-19', t1: '09:00', t2: '14:00',
      venue: 'Kabuku, Limuru',
      summary: 'Free health screening for members, with referrals to health facilities and follow-up for elders living with chronic illness.',
      body: 'Health and wellness is one of the foundation\'s three core programmes. At this gathering members received basic health checks, advice, and referrals to nearby health facilities.\n\nMembers living with chronic illnesses were registered for follow-up support.',
      ach: 'Basic health screening for members\nReferrals to health facilities\nFollow-up plan for members with chronic illness',
      cover: null,
    },
    {
      slug: 'land-fundraiser-waithaka-foundation-complex', title: 'Fundraiser: Land for the Waithaka Foundation Complex', date: '2026-11-28', t1: '10:00', t2: '16:00',
      venue: 'Limuru, Kiambu County',
      summary: 'Join friends, families, partners and well-wishers as we raise funds to buy land for a permanent home for our elders.',
      body: 'Today the foundation hires halls and open fields for every gathering, and many elders cannot attend because of transport challenges.\n\nThis fundraiser is the first step towards the Waithaka Foundation Complex: a permanent, accessible home where we can reach many more senior citizens. Every contribution, large or small, brings us closer to buying the land.',
      ach: '', cover: null, featured: 1,
    },
    {
      slug: 'monthly-fellowship-gathering-december-2026', title: 'Christmas Fellowship with Our Elders', date: '2026-12-12', t1: '10:00', t2: '15:00',
      venue: 'Kabuku, Limuru',
      summary: 'Our end-of-year gathering: fellowship, a festive meal, health checks and Christmas hampers for every member.',
      body: 'We close the year with our elders: a morning of worship and song, a festive meal together, health checks, and a Christmas hamper of food and essential supplies for every registered member.\n\nVolunteers, families and sponsors are warmly invited to join us.',
      ach: '', cover: null,
    },
  ];
  for (const e of ev) {
    const id = (await run(`INSERT INTO events(slug,title,start_date,start_time,end_time,venue,summary,body,achievements,cover_media_id,featured,sample)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`, e.slug, e.title, e.date, e.t1, e.t2, e.venue, e.summary, e.body, e.ach, e.cover, e.featured || 0)).insertId;
    if (e.cover) await run('UPDATE media SET event_id=? WHERE id=?', id, e.cover);
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

module.exports = { ensureAdmin, seedContent, importGallery };
