'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { run, get, UPLOAD_DIR } = require('./db');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB || 300);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmp = path.join(UPLOAD_DIR, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    cb(null, tmp);
  },
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex')),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype) || VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
    const err = new Error(`"${file.originalname}" is not a supported photo or video. Use JPG, PNG, WEBP, MP4 or WEBM.`);
    err.status = 400;
    cb(err);
  },
});

function safeUnlink(p) { try { if (p) fs.unlinkSync(p); } catch { /* already gone */ } }

/** Turn an uploaded image into web-friendly large + small WEBP copies. */
async function processImage(tmpPath, { maxLarge = 1800, maxSmall = 640 } = {}) {
  const id = crypto.randomBytes(10).toString('hex');
  const large = `${id}-lg.webp`;
  const small = `${id}-sm.webp`;
  const img = sharp(tmpPath, { failOn: 'error' }).rotate();
  const meta = await img.metadata();
  const lgInfo = await img.clone().resize({ width: maxLarge, height: maxLarge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toFile(path.join(UPLOAD_DIR, large));
  await img.clone().resize({ width: maxSmall, height: maxSmall, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 }).toFile(path.join(UPLOAD_DIR, small));
  safeUnlink(tmpPath);
  return { file: large, thumb: small, width: lgInfo.width || meta.width, height: lgInfo.height || meta.height };
}

function storeVideo(tmpPath, originalName) {
  const ext = (path.extname(originalName || '').toLowerCase().match(/^\.(mp4|webm|mov)$/) || ['.mp4'])[0];
  const name = `${crypto.randomBytes(10).toString('hex')}${ext}`;
  fs.renameSync(tmpPath, path.join(UPLOAD_DIR, name));
  return name;
}

/** Save one uploaded file as a media row. Returns the new media id. */
async function saveUpload(file, { title = '', caption = '', eventId = null, featured = 0 } = {}) {
  const baseTitle = title || path.parse(file.originalname || '').name.replace(/[-_]+/g, ' ').slice(0, 120);
  if (IMAGE_TYPES.includes(file.mimetype)) {
    const r = await processImage(file.path);
    return (await run(`INSERT INTO media(kind,file,thumb,title,caption,event_id,featured,width,height) VALUES('image',?,?,?,?,?,?,?,?)`,
      r.file, r.thumb, baseTitle, caption, eventId, featured ? 1 : 0, r.width, r.height)).insertId;
  }
  const name = storeVideo(file.path, file.originalname);
  return (await run(`INSERT INTO media(kind,file,title,caption,event_id,featured) VALUES('video',?,?,?,?,?)`,
    name, baseTitle, caption, eventId, featured ? 1 : 0)).insertId;
}

/** Accepts any common YouTube URL form (watch, youtu.be, shorts, embed) or a bare 11-char id. */
function parseYouTubeId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

function deleteMediaFiles(m) {
  if (!m) return;
  if (m.file) safeUnlink(path.join(UPLOAD_DIR, m.file));
  if (m.thumb) safeUnlink(path.join(UPLOAD_DIR, m.thumb));
}

/** Upload a single image used for a logo/portrait/hero; returns the large file name. */
async function saveSingleImage(file, opts) {
  if (!file) return null;
  if (!IMAGE_TYPES.includes(file.mimetype)) { safeUnlink(file.path); const e = new Error('Please choose a photo (JPG, PNG or WEBP).'); e.status = 400; throw e; }
  const r = await processImage(file.path, opts);
  safeUnlink(path.join(UPLOAD_DIR, r.thumb));
  return r.file;
}

async function mediaById(id) { return id ? get('SELECT * FROM media WHERE id=?', id) : null; }

module.exports = { upload, saveUpload, parseYouTubeId, deleteMediaFiles, saveSingleImage, processImage, mediaById, safeUnlink, IMAGE_TYPES, VIDEO_TYPES, MAX_VIDEO_MB };
