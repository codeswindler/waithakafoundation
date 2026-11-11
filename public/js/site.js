(function () {
  'use strict';
  var d = document, root = d.documentElement;
  root.classList.remove('no-js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- header & mobile menu ----
  var header = d.querySelector('.site-header');
  var mbar = d.querySelector('.mbar');
  var onScroll = function () {
    var y = window.scrollY;
    if (header) header.classList.toggle('scrolled', y > 30);
    if (mbar) mbar.classList.toggle('show', y > 260);
  };
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  var btn = d.querySelector('.menu-btn'), nav = d.getElementById('nav');
  if (btn && nav) {
    var setMenu = function (open) { nav.classList.toggle('open', open); d.body.classList.toggle('menu-open', open); btn.setAttribute('aria-expanded', open); btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
    btn.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  // ---- reveal on scroll, counters, progress bars ----
  function countUp(el) {
    var raw = el.getAttribute('data-count'), target = parseInt(raw, 10);
    if (!target || reduce || String(target) !== raw.trim()) return;
    var start = null, dur = 1400;
    function step(t) { if (!start) start = t; var p = Math.min(1, (t - start) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }
    el.textContent = '0'; requestAnimationFrame(step);
  }
  var targets = d.querySelectorAll('.reveal, [data-count], .progress .fill');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target; io.unobserve(el);
        if (el.classList.contains('reveal')) el.classList.add('in');
        if (el.hasAttribute('data-count')) countUp(el);
        if (el.classList.contains('fill')) el.style.width = el.getAttribute('data-pct') + '%';
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });
  } else {
    targets.forEach(function (el) { el.classList.add('in'); if (el.classList.contains('fill')) el.style.width = el.getAttribute('data-pct') + '%'; });
  }

  // ---- countdowns ----
  d.querySelectorAll('[data-countdown]').forEach(function (el) {
    var when = new Date(el.getAttribute('data-countdown')).getTime();
    if (isNaN(when)) { el.remove(); return; }
    var u = {}; el.querySelectorAll('[data-u]').forEach(function (b) { u[b.getAttribute('data-u')] = b; });
    function tick() {
      var s = Math.max(0, Math.floor((when - Date.now()) / 1000));
      if (s === 0) { el.outerHTML = '<p style="margin:14px 0;font-weight:600">Happening today. Join us!</p>'; return; }
      u.d.textContent = Math.floor(s / 86400); u.h.textContent = Math.floor(s % 86400 / 3600);
      u.m.textContent = Math.floor(s % 3600 / 60); u.s.textContent = s % 60;
      setTimeout(tick, 1000);
    }
    tick();
  });

  // ---- lightbox ----
  var lb = d.getElementById('lightbox');
  if (lb) {
    var stage = lb.querySelector('.lb-stage'), count = lb.querySelector('.lb-count'), items = [], idx = 0, lastFocus = null;
    function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function show(i) {
      idx = (i + items.length) % items.length;
      var it = items[idx], kind = it.getAttribute('data-lb'), src = it.getAttribute('data-src');
      var title = it.getAttribute('data-title'), cap = it.getAttribute('data-caption');
      var html;
      if (kind === 'image') html = '<img src="' + esc(src) + '" alt="' + esc(title || cap || 'Photo') + '">';
      else if (kind === 'video') html = '<video src="' + esc(src) + '" controls autoplay playsinline></video>';
      else html = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(src) + '?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="' + esc(title || 'Video') + '"></iframe>';
      if (title || cap) html += '<div class="lb-cap">' + (title ? '<b>' + esc(title) + '</b>' : '') + esc(cap) + '</div>';
      stage.innerHTML = html;
      count.textContent = items.length > 1 ? (idx + 1) + ' / ' + items.length : '';
      lb.querySelector('.lb-prev').style.display = lb.querySelector('.lb-next').style.display = items.length > 1 ? '' : 'none';
    }
    function open(tile) {
      var group = tile.closest('[data-lb-group]');
      items = Array.prototype.slice.call((group || d).querySelectorAll('[data-lb]'));
      lastFocus = tile; lb.hidden = false; lb.classList.add('open'); d.body.style.overflow = 'hidden'; d.body.classList.add('lb-open');
      show(items.indexOf(tile)); lb.querySelector('.lb-close').focus();
    }
    function close() { lb.classList.remove('open'); lb.hidden = true; stage.innerHTML = ''; d.body.style.overflow = ''; d.body.classList.remove('lb-open'); if (lastFocus) lastFocus.focus(); }
    d.addEventListener('click', function (e) { var t = e.target.closest('[data-lb]'); if (t) { e.preventDefault(); open(t); } });
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.querySelector('.lb-prev').addEventListener('click', function () { show(idx - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { show(idx + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    d.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') show(idx - 1); else if (e.key === 'ArrowRight') show(idx + 1);
    });
    var sx = null;
    lb.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1)); sx = null; });
  }

  // ---- hero slideshow: cross-fade, photos load just before they are shown ----
  var show = d.querySelector('.hero-media.slideshow');
  if (show) {
    var slides = [].slice.call(show.querySelectorAll('.slide')), dots = [].slice.call(d.querySelectorAll('.hero-dots button'));
    var cur = 0, timer = null, DELAY = 6500;
    var load = function (img) {
      return new Promise(function (res) {
        if (!img.dataset.src) return res();
        img.onload = img.onerror = function () { res(); };
        if (img.dataset.srcset) img.srcset = img.dataset.srcset;
        img.src = img.dataset.src; delete img.dataset.src; delete img.dataset.srcset;
      });
    };
    var cleanT = null;
    var go = function (n) {
      n = (n + slides.length) % slides.length;
      if (n === cur) return;
      load(slides[n]).then(function () {
        var prev = slides[cur], next = slides[n];
        // Freeze the outgoing photo exactly where its drift is, and keep it fully visible underneath.
        prev.style.transform = getComputedStyle(prev).transform;
        slides.forEach(function (sl) { if (sl !== prev && sl !== next) { sl.classList.remove('on', 'fading', 'under'); sl.style.transform = ''; } });
        prev.classList.remove('on', 'fading'); prev.classList.add('under');
        next.classList.remove('under'); next.style.transform = '';
        void next.offsetWidth; // restart its animations cleanly
        next.classList.add('on', 'fading');
        cur = n;
        dots.forEach(function (b, i) { if (i === n) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
        // Once the new photo fully covers the old one, quietly retire the old one.
        clearTimeout(cleanT);
        cleanT = setTimeout(function () { if (prev !== slides[cur]) { prev.classList.remove('under'); prev.style.transform = ''; } }, 2400);
        load(slides[(n + 1) % slides.length]); // warm up the next one
      });
    };
    var play = function () { clearInterval(timer); if (!reduce) timer = setInterval(function () { if (!d.hidden) go(cur + 1); }, DELAY); };
    dots.forEach(function (b, i) { b.addEventListener('click', function () { go(i); play(); }); });
    window.addEventListener('load', function () { setTimeout(function () { load(slides[1]); }, 1200); });
    play();
  }

  // ---- Moments showcase: each photo dissolves into the next (new one fades in on top of the old) ----
  d.querySelectorAll('[data-fader]').forEach(function (fd) {
    var slides = [].slice.call(fd.querySelectorAll('.fade-slide')), thumbs = [].slice.call(fd.querySelectorAll('.fader-thumbs button'));
    var count = fd.querySelector('.fader-count b'), cur = 0, busy = false, idle = true, visible = false, resumeT = null, cleanT = null;
    if (slides.length < 2) return;
    var img = function (i) { return slides[i].querySelector('img'); };
    var load = function (i) {
      var im = img(i);
      return new Promise(function (res) {
        if (!im.dataset.src) return im.complete ? res() : (im.onload = im.onerror = function () { res(); });
        im.onload = im.onerror = function () { res(); };
        if (im.dataset.srcset) im.srcset = im.dataset.srcset;
        im.src = im.dataset.src; delete im.dataset.src; delete im.dataset.srcset;
      });
    };
    var show = function (n) {
      n = (n + slides.length) % slides.length;
      if (n === cur || busy) return;
      busy = true;
      load(n).then(function () {
        var prev = slides[cur], next = slides[n];
        slides.forEach(function (sl) { if (sl !== prev && sl !== next) sl.classList.remove('on', 'fading', 'under'); });
        prev.classList.remove('on', 'fading'); prev.classList.add('under');
        next.classList.remove('under'); void next.offsetWidth; next.classList.add('on', 'fading');
        prev.setAttribute('aria-hidden', 'true'); prev.tabIndex = -1;
        next.removeAttribute('aria-hidden'); next.tabIndex = 0;
        thumbs.forEach(function (t, i) { t.classList.toggle('on', i === n); t.setAttribute('aria-selected', i === n); });
        if (thumbs[n]) thumbs[n].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        if (count) count.textContent = n + 1;
        cur = n;
        clearTimeout(cleanT);
        cleanT = setTimeout(function () { if (prev !== slides[cur]) prev.classList.remove('under'); }, 1700);
        setTimeout(function () { busy = false; }, 450);
        load((n + 1) % slides.length);
      });
    };
    function pause() { idle = false; clearTimeout(resumeT); resumeT = setTimeout(function () { idle = true; }, 8000); }
    fd.querySelectorAll('.fader-btn').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); pause(); show(cur + Number(b.dataset.dir)); }); });
    thumbs.forEach(function (t, i) { t.addEventListener('click', function () { pause(); show(i); }); });
    fd.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { pause(); show(cur + 1); } if (e.key === 'ArrowLeft') { pause(); show(cur - 1); } });
    ['pointerenter', 'focusin'].forEach(function (ev) { fd.addEventListener(ev, pause); });
    var sx = null, stage = fd.querySelector('.fader-stage');
    stage.addEventListener('touchstart', function (e) { pause(); sx = e.touches[0].clientX; }, { passive: true });
    var swiped = false;
    stage.addEventListener('touchend', function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) { swiped = true; show(cur + (dx < 0 ? 1 : -1)); setTimeout(function () { swiped = false; }, 400); } sx = null; });
    // A swipe should change the photo, not also open the full-size viewer
    stage.addEventListener('click', function (e) { if (swiped) { e.preventDefault(); e.stopPropagation(); } }, true);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) load((cur + 1) % slides.length); }, { threshold: 0.35 }).observe(fd);
    if (!reduce) setInterval(function () { if (idle && visible && !d.hidden && !d.querySelector('.lb.open')) show(cur + 1); }, 5500);
  });

  // ---- "swipe for more" hint on phone carousels that overflow ----
  function hints() {
    d.querySelectorAll('.swipe').forEach(function (row) {
      var prev = row.previousElementSibling, has = prev && prev.classList.contains('swipe-hint');
      var over = row.scrollWidth > row.clientWidth + 8 && window.innerWidth <= 760;
      if (over && !has) { var p = d.createElement('p'); p.className = 'swipe-hint'; p.setAttribute('aria-hidden', 'true'); p.textContent = 'Swipe for more'; row.parentNode.insertBefore(p, row); }
      else if (!over && has) prev.remove();
      if (over && !row.dataset.hintBound) {
        row.dataset.hintBound = '1';
        row.addEventListener('scroll', function () { var h = row.previousElementSibling; if (h && h.classList.contains('swipe-hint') && row.scrollLeft > 30) h.style.visibility = 'hidden'; }, { passive: true });
      }
    });
  }
  hints();
  window.addEventListener('resize', function () { clearTimeout(hints.t); hints.t = setTimeout(hints, 200); });

  // ---- year filter on past events ----
  d.querySelectorAll('[data-filter-group]').forEach(function (g) {
    var target = g.parentNode.querySelector('[data-filter-target]');
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]'); if (!b || !target) return;
      g.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      var f = b.getAttribute('data-filter');
      target.querySelectorAll('[data-year]').forEach(function (el) {
        var on = f === 'all' || el.getAttribute('data-year') === f;
        el.style.display = on ? 'contents' : 'none';
        var card = el.querySelector('.reveal'); if (card) card.classList.add('in');
      });
    });
  });

  // ---- copy buttons ----
  d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]'); if (!b) return;
    var v = b.getAttribute('data-copy');
    var done = function () { var o = b.textContent; b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = o; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, done); else done();
  });

  // ---- share ----
  d.addEventListener('click', function (e) {
    var a = e.target.closest('[data-share]'); if (!a) return;
    e.preventDefault();
    var url = a.getAttribute('data-share'), title = a.getAttribute('data-share-title');
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { a.textContent = 'Link copied ✓'; });
    else window.open('https://wa.me/?text=' + encodeURIComponent(title + ' ' + url), '_blank');
  });

  // ---- forms: timing field for spam check, preselect enquiry type ----
  var loaded = Date.now();
  d.querySelectorAll('form[data-timed]').forEach(function (f) { f.addEventListener('submit', function () { var t = f.querySelector('[name=t]'); if (t) t.value = loaded; }); });
  d.addEventListener('click', function (e) {
    var a = e.target.closest('[data-kind]'); if (!a) return;
    var r = d.querySelector('input[name=type][value="' + a.getAttribute('data-kind') + '"]'); if (r) r.checked = true;
  });
  var q = new URLSearchParams(location.search);
  if (q.get('event')) { var m = d.getElementById('message'); if (m && !m.value) m.value = 'I would like to support the event: ' + q.get('event').replace(/-/g, ' ') + '\n\n'; }
})();
