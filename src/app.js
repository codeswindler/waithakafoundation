'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const h = require('./helpers');
const { icon } = require('./icons');
const { getSettings, get, DEFAULT_SETTINGS, UPLOAD_DIR } = require('./db');
const { sessionMiddleware, csrf } = require('./auth');

async function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
        'media-src': ["'self'", 'blob:'],
        'frame-src': ['https://www.youtube-nocookie.com', 'https://www.google.com'],
        'upgrade-insecure-requests': process.env.COOKIE_SECURE === '1' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0 }));
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
  app.get('/manifest.webmanifest', async (req, res, next) => {
    try {
      const st = await getSettings();
      res.type('application/manifest+json').send(JSON.stringify({
        name: st.site_full_name, short_name: st.site_name, start_url: '/', display: 'standalone',
        background_color: '#FBFAFD', theme_color: '#4A1F86', description: st.tagline,
        icons: [
          { src: '/static/img/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/static/img/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/static/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }));
    } catch (e) { next(e); }
  });
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/logo-mark.svg'));
  app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: /admin\nSitemap: ${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}/sitemap.xml\n`));
  // For uptime checks / PM2 monitoring: confirms the app and the database both answer.
  app.get('/healthz', async (req, res) => {
    try { await get('SELECT 1 AS ok'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false, db: 'unreachable' }); }
  });

  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Shared template data
  app.use(async (req, res, next) => {
    res.locals.s = DEFAULT_SETTINGS;
    try { res.locals.s = await getSettings(); } catch (e) { return next(e); }
    res.locals.h = h;
    res.locals.icon = icon;
    res.locals.path = req.path;
    res.locals.year = new Date().getFullYear();
    res.locals.baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    next();
  });

  // Admin gets sessions + CSRF; the public site stays cookie-free.
  app.use('/admin', await sessionMiddleware(), csrfUnlessMultipart, require('./routes/admin'));

  app.use('/', require('./routes/public'));

  app.use((req, res) => res.status(404).render('error', { title: 'Page not found', status: 404, message: 'We could not find that page. It may have been moved or removed.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.expose || status < 500 ? err.message : 'Something went wrong on our side. Please try again.';
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? `That file is too large. The limit is ${require('./media').MAX_VIDEO_MB} MB. For long videos, upload them to YouTube and add the link instead.` : `Upload problem: ${err.message}`;
    }
    if (status >= 500) console.error(new Date().toISOString(), req.method, req.originalUrl, err);
    if (err.code && /^(ECONNREFUSED|PROTOCOL_CONNECTION_LOST|ER_)/.test(err.code)) message = 'The website is having trouble reaching its database. Please try again in a minute.';
    if (req.path.startsWith('/admin') && req.session && req.session.userId) {
      return res.status(status).render('admin/error', { title: 'Problem', status, message, user: res.locals.user || { name: '' }, unread: res.locals.unread || 0, flash: null });
    }
    res.status(status).render('error', { title: status === 404 ? 'Page not found' : 'Something went wrong', status, message });
  });
  return app;
}

function csrfUnlessMultipart(req, res, next) {
  if ((req.get('content-type') || '').startsWith('multipart/form-data')) {
    // Token is checked after multer parses the body (see admin routes: checkCsrf).
    if (!req.session.csrf) req.session.csrf = h.token();
    res.locals.csrf = req.session.csrf;
    return next();
  }
  return csrf(req, res, next);
}

module.exports = { createApp };
