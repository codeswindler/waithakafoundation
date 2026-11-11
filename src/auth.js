'use strict';
const session = require('express-session');
const { get, run } = require('./db');
const { token } = require('./helpers');

/** Session store on MySQL, so admins stay signed in across restarts and PM2 reloads. */
class MysqlStore extends session.Store {
  get(sid, cb) {
    get('SELECT data, expires FROM sessions WHERE sid=?', sid).then((r) => {
      if (!r) return cb(null, null);
      if (Number(r.expires) < Date.now()) return run('DELETE FROM sessions WHERE sid=?', sid).then(() => cb(null, null));
      cb(null, JSON.parse(r.data));
    }).catch(cb);
  }
  set(sid, sess, cb) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
    run('INSERT INTO sessions(sid,data,expires) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), expires=VALUES(expires)', sid, JSON.stringify(sess), exp)
      .then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  destroy(sid, cb) { run('DELETE FROM sessions WHERE sid=?', sid).then(() => cb && cb(null)).catch((e) => cb && cb(e)); }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

async function sessionMiddleware() {
  await run('DELETE FROM sessions WHERE expires < ?', Date.now());
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    const row = await get("SELECT svalue FROM settings WHERE skey='_session_secret'");
    secret = row ? row.svalue : token();
    if (!row) await run("INSERT INTO settings(skey,svalue) VALUES('_session_secret',?)", secret);
  }
  return session({
    store: new MysqlStore(),
    secret,
    name: 'wf.sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 1000 * 60 * 60 * 8 },
  });
}

/** CSRF: one token per session, checked on every state-changing request. */
function csrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrf) req.session.csrf = token();
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (sent !== req.session.csrf) {
      const e = new Error('Your session expired or the form was out of date. Please go back, refresh the page and try again.');
      e.status = 403;
      return next(e);
    }
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    if (!req.session.userId) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
    const user = await get('SELECT id, name, email, must_change FROM users WHERE id=?', req.session.userId);
    if (!user) { req.session.destroy(() => {}); return res.redirect('/admin/login'); }
    req.user = user;
    res.locals.user = user;
    if (user.must_change && !['/account', '/account/password', '/logout'].includes(req.path)) return res.redirect('/admin/account?first=1');
    next();
  } catch (e) { next(e); }
}

/** Simple in-memory limiter: N attempts per key per window. */
function limiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
    h.push(now);
    hits.set(key, h);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return h.length > max;
  };
}

module.exports = { sessionMiddleware, csrf, requireAdmin, limiter };
