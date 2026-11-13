'use strict';
// MySQL / MariaDB data layer. Configure with DATABASE_URL (mysql://user:pass@host:3306/dbname)
// or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function config() {
  const base = {
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true, // DATE -> 'YYYY-MM-DD', DATETIME -> 'YYYY-MM-DD HH:MM:SS' (UTC)
    timezone: 'Z',
    connectionLimit: Number(process.env.DB_POOL || 10),
    waitForConnections: true,
    enableKeepAlive: true,
  };
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return { ...base, host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, '') };
  }
  return {
    ...base,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'waithaka',
  };
}

let pool = null;
function getPool() {
  if (!pool) {
    pool = mysql.createPool(config());
    pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

// ---------- query helpers ----------
async function all(sql, ...p) { const [rows] = await getPool().query(sql, p); return rows; }
async function get(sql, ...p) { return (await all(sql, ...p))[0]; }
async function run(sql, ...p) { const [r] = await getPool().query(sql, p); return r; }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL, must_change TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (skey VARCHAR(64) PRIMARY KEY, svalue MEDIUMTEXT)`,
  `CREATE TABLE IF NOT EXISTS media (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, kind ENUM('image','video','youtube') NOT NULL,
    file VARCHAR(120), thumb VARCHAR(120), youtube_id VARCHAR(20), title VARCHAR(200), caption TEXT,
    event_id INT UNSIGNED NULL, featured TINYINT NOT NULL DEFAULT 0, width INT, height INT,
    sort INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_media_event (event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(190) NOT NULL UNIQUE, title VARCHAR(200) NOT NULL,
    start_date DATE NOT NULL, date_tbc TINYINT NOT NULL DEFAULT 0, start_time CHAR(5), end_time CHAR(5), venue VARCHAR(200),
    summary TEXT, body MEDIUMTEXT, achievements TEXT, attendance INT NULL,
    cover_media_id INT UNSIGNED NULL, published TINYINT NOT NULL DEFAULT 1, featured TINYINT NOT NULL DEFAULT 0,
    sample TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_events_date (start_date)
  )`,
  `CREATE TABLE IF NOT EXISTS milestones (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, period VARCHAR(40), title VARCHAR(200) NOT NULL, description TEXT,
    sort INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS partners (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, url VARCHAR(300), logo VARCHAR(120),
    tier VARCHAR(80), sort INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS team (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, role VARCHAR(120), bio TEXT, photo VARCHAR(120),
    grp VARCHAR(20) NOT NULL DEFAULT 'board', sort INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, type VARCHAR(20) NOT NULL, name VARCHAR(120), email VARCHAR(160),
    phone VARCHAR(40), organisation VARCHAR(160), message TEXT, is_read TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (sid VARCHAR(128) PRIMARY KEY, data MEDIUMTEXT NOT NULL, expires BIGINT NOT NULL, INDEX idx_sess_exp (expires))`,
];

/** Create the database (if the user may) and all tables. Safe to run on every start. */
async function init() {
  const cfg = config();
  try {
    const c = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
  } catch (e) {
    if (e.code === 'ECONNREFUSED' || e.code === 'ER_ACCESS_DENIED_ERROR' || e.code === 'ENOTFOUND') throw friendly(e, cfg);
    // No CREATE DATABASE permission (shared hosting): the database must already exist. Carry on.
  }
  try {
    for (const sql of SCHEMA) await run(sql);
    // Columns added after the first release (works on MySQL 8 and MariaDB)
    const addColumn = async (table, column, ddl) => {
      const r = await get('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', table, column);
      if (!Number(r.n)) await run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    await addColumn('events', 'date_tbc', 'date_tbc TINYINT NOT NULL DEFAULT 0 AFTER start_date');
  } catch (e) { throw friendly(e, cfg); }
}
function friendly(e, cfg) {
  const where = `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  const hint = {
    ECONNREFUSED: 'MySQL is not running or not reachable on that host/port.',
    ER_ACCESS_DENIED_ERROR: 'The MySQL username or password is wrong.',
    ER_BAD_DB_ERROR: 'The database does not exist. Create it, or give this user CREATE permission.',
    ENOTFOUND: 'The database host name could not be found.',
  }[e.code] || e.message;
  const err = new Error(`Could not connect to the database (${where}): ${hint}\nSet DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in .env.`);
  err.cause = e;
  return err;
}
async function close() { if (pool) { const p = pool; pool = null; await p.end(); } }

// ---------- settings (cached; the site reads them on every page) ----------
const DEFAULT_SETTINGS = {
  site_name: 'Waithaka Foundation',
  site_full_name: 'Waithaka Foundation for the Elderly',
  tagline: 'Celebrating Life',
  hero_title: 'Dignity, comfort and companionship for our elders',
  hero_text: 'A community-based organisation in Kabuku, Limuru, caring for senior citizens over 80 through fellowship, food support and health care. Every month, with families, volunteers and local leaders.',
  hero_image: '',
  stat_members: '100',
  stat_members_label: 'Registered senior citizens',
  stat_since: '2022',
  stat_since_label: 'Serving Kabuku since',
  stat_age: '80+',
  stat_age_label: 'Elders aged 80 and above',
  stat_events: '12',
  stat_events_label: 'Gatherings every year',
  about_story: 'The Waithaka Foundation is a non-profit Community Based Organization (CBO) dedicated to promoting the health, dignity and well-being of senior citizens over 80 years of age.\n\nThe foundation was started in 2022 as a response to the growing challenges faced by senior citizens in Kabuku, Limuru areas of Kiambu County: isolation, poor health, poverty and limited access to healthcare and social support.\n\nIt began as Corporate Social Responsibility by the late Waithaka\'s family, as a way of giving back to the society. Today the foundation is based in Limuru Sub-County, where it serves one hundred registered members.',
  mission: 'The elderly are important repositories of our heritage and pillars of our community. Yet, the twilight years for many of our senior citizens are marked by profound neglect, isolation and acute healthcare challenges. The foundation exists to honour, protect, restore hope, comfort and dignity to senior citizens by providing compassionate care, community-based support and spiritual nourishment.',
  vision: 'Every elderly person deserves safety, comfort, love and peace in their sunset years.',
  slogan: 'Restoring Dignity. Sharing Love. Giving Hope.',
  campaign_title: 'Help us build the Waithaka Foundation Complex',
  campaign_text: 'Today we hire halls and open fields for every gathering. Many elders who would like to join cannot make it because of transport challenges. A permanent home, the Waithaka Foundation Complex, will let us reach far more senior citizens. The first step is buying a piece of land, and we are raising funds for it now.',
  campaign_goal: '',
  campaign_raised: '',
  currency: 'KES',
  email: '',
  phone: '',
  whatsapp: '',
  address: 'Kabuku, Limuru Sub-County, Kiambu County, Kenya',
  mpesa_paybill: '',
  mpesa_account: '',
  bank_details: '',
  facebook: '', instagram: '', youtube: '', x: '', tiktok: '',
  notify_email: '',
};

let cache = null, cachedAt = 0;
async function getSettings() {
  if (!cache || Date.now() - cachedAt > 30000) {
    const s = { ...DEFAULT_SETTINGS };
    for (const r of await all('SELECT skey, svalue FROM settings')) s[r.skey] = r.svalue ?? '';
    cache = s; cachedAt = Date.now();
  }
  return cache;
}
async function setSetting(key, value) {
  await run('INSERT INTO settings(skey,svalue) VALUES(?,?) ON DUPLICATE KEY UPDATE svalue=VALUES(svalue)', key, value ?? '');
  cache = null;
}
function clearSettingsCache() { cache = null; }

module.exports = { all, get, run, init, close, getPool, getSettings, setSetting, clearSettingsCache, DEFAULT_SETTINGS, DATA_DIR, UPLOAD_DIR };
