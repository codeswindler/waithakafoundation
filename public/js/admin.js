(function () {
  'use strict';
  var d = document;

  // Mobile sidebar
  var side = d.getElementById('side'), tog = d.querySelector('.side-toggle');
  if (side && tog) {
    tog.addEventListener('click', function (e) { e.stopPropagation(); side.classList.toggle('open'); });
    d.addEventListener('click', function (e) { if (side.classList.contains('open') && !side.contains(e.target)) side.classList.remove('open'); });
  }

  // Confirm destructive actions (forms or buttons with data-confirm)
  d.addEventListener('submit', function (e) {
    var f = e.target, sub = e.submitter;
    var msg = (sub && sub.getAttribute('data-confirm')) || f.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // Link each bare <label> to the field that follows it (accessibility + click-to-focus)
  var n = 0;
  d.querySelectorAll('label:not([for])').forEach(function (l) {
    if (l.querySelector('input,select,textarea')) return;
    var el = l.nextElementSibling;
    while (el && el.tagName === 'DIV' && el.classList.contains('current-img')) el = el.nextElementSibling;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'hidden') return;
    if (!el.id) el.id = 'fld-' + (++n);
    l.htmlFor = el.id;
  });

  // Auto-submitting selects
  d.querySelectorAll('[data-autosubmit]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
  d.querySelectorAll('[data-back]').forEach(function (a) { a.addEventListener('click', function (e) { if (history.length > 1) { e.preventDefault(); history.back(); } }); });

  // Settings: remember which section's Save was pressed
  d.querySelectorAll('[data-section]').forEach(function (b) {
    b.addEventListener('click', function () { var s = b.form.querySelector('[name=section]'); if (s) s.value = b.getAttribute('data-section'); });
  });

  // Drag & drop + previews
  d.querySelectorAll('.drop').forEach(function (drop) {
    var input = drop.querySelector('input[type=file]'), prev = drop.querySelector('.previews');
    function render() {
      prev.innerHTML = '';
      Array.prototype.forEach.call(input.files, function (f) {
        var fig = d.createElement('figure');
        if (f.type.indexOf('image/') === 0) { var img = d.createElement('img'); img.src = URL.createObjectURL(f); fig.appendChild(img); }
        else { var v = d.createElement('div'); v.className = 'vid'; v.textContent = '▶ video'; fig.appendChild(v); }
        var c = d.createElement('figcaption'); c.textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' MB'; fig.appendChild(c);
        prev.appendChild(fig);
      });
    }
    input.addEventListener('change', render);
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; render(); } });
  });

  // Upload with a progress bar (large videos can take a while on mobile data)
  d.querySelectorAll('form[data-upload]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented || !window.FormData || !window.XMLHttpRequest) return;
      var hasFile = Array.prototype.some.call(form.querySelectorAll('input[type=file]'), function (i) { return i.files && i.files.length; });
      if (!hasFile) return; // plain submit is fine
      e.preventDefault();
      var wrap = form.querySelector('.progress-wrap'), bar = wrap && wrap.querySelector('.bar span'), pct = wrap && wrap.querySelector('b');
      var btns = form.querySelectorAll('button[type=submit], button:not([type])');
      btns.forEach(function (b) { b.disabled = true; });
      if (wrap) wrap.hidden = false;
      var fd = new FormData(form);
      if (e.submitter && e.submitter.name) fd.append(e.submitter.name, e.submitter.value);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      xhr.setRequestHeader('X-Upload', '1');
      xhr.upload.onprogress = function (ev) {
        if (!ev.lengthComputable) return;
        var p = Math.round(ev.loaded / ev.total * 100);
        if (bar) bar.style.width = p + '%';
        if (pct) pct.textContent = p < 100 ? p + '%' : 'processing…';
      };
      xhr.onload = function () {
        var data = null; try { data = JSON.parse(xhr.responseText); } catch (err) { /* HTML error page */ }
        if (data && data.redirect) { var u = data.redirect; if (u.split('#')[0] === location.pathname + location.search) { location.href = u; location.reload(); } else location.href = u; return; }
        d.open(); d.write(xhr.responseText); d.close();
      };
      xhr.onerror = function () { btns.forEach(function (b) { b.disabled = false; }); if (wrap) wrap.hidden = true; alert('The upload failed. Check your internet connection and try again.'); };
      xhr.send(fd);
    });
  });
})();
