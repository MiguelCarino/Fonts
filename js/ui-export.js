(function () {
  'use strict';

  var LICENSES = [
    { id: 'OFL', name: 'SIL Open Font License 1.1',
      blurb: 'Free for anyone to use, embed, bundle and modify — derivatives must stay under the same open license.' },
    { id: 'CC0', name: 'CC0 1.0 (Public Domain)',
      blurb: 'No rights reserved. Anyone may do anything with your font, no credit required.' },
    { id: 'ARR', name: 'All Rights Reserved',
      blurb: 'You keep every right. Others need your explicit permission to use, share or modify the font.' }
  ];

  var META_FIELDS = [
    ['family', 'Family name'],
    ['style', 'Style'],
    ['author', 'Author'],
    ['version', 'Version']
  ];

  var inputs = {};     // meta key -> input element (only while modal open)
  var cards = {};      // license id -> card element

  function el(tag, attrs, children) { return window.UI.el(tag, attrs, children); }
  function toast(msg, ok) { window.UI.toast(msg, ok); }
  function doc() { return window.FontModel.doc; }

  function injectStyle() {
    if (document.getElementById('ui-export-style')) return;
    var st = document.createElement('style');
    st.id = 'ui-export-style';
    st.textContent =
      '.uiexport-modal .export-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;}' +
      '.uiexport-modal .export-lic{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}' +
      '.uiexport-modal .lic-card{background:var(--panel2);border:1px solid var(--border);border-radius:6px;' +
      'padding:12px 14px;cursor:pointer;transition:border-color .15s,background .15s;}' +
      '.uiexport-modal .lic-card:hover{border-color:var(--accent);}' +
      '.uiexport-modal .lic-card.active{border-color:var(--accent);background:rgba(234,179,8,.08);}' +
      '.uiexport-modal .lic-card h4{font-size:var(--fs-sec);margin-bottom:4px;}' +
      '.uiexport-modal .lic-card.active h4{color:var(--accent);}' +
      '.uiexport-modal .lic-card p{font-size:var(--fs-sm);color:var(--text-dim);line-height:1.45;}' +
      '.uiexport-modal .lic-note{font-size:var(--fs-sm);color:var(--text-muted);margin-top:10px;}' +
      '.uiexport-modal .export-note{font-size:var(--fs-sm);color:var(--text-muted);}';
    document.head.appendChild(st);
  }

  // ── meta form ─────────────────────────────────────────────────

  function bindMeta(key, input) {
    input.addEventListener('change', function () {
      if (doc().meta[key] === input.value) return;
      doc().meta[key] = input.value;
      window.FontModel.save();
    });
  }

  function renderMeta() {
    for (var key in inputs) {
      // don't clobber the field the user is typing in
      if (document.activeElement !== inputs[key]) inputs[key].value = doc().meta[key];
    }
  }

  // ── license picker ────────────────────────────────────────────

  function renderLicense() {
    for (var id in cards) {
      cards[id].classList.toggle('active', doc().meta.license === id);
    }
  }

  function pickLicense(id) {
    if (doc().meta.license === id) return;
    doc().meta.license = id;
    window.FontModel.save();
  }

  // ── downloads ─────────────────────────────────────────────────

  function fileBase() {
    var m = doc().meta;
    var name = (m.family + '-' + m.style).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
    return name || 'font';
  }

  function download(data, filename, type) {
    var blob = new Blob([data], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function onTTF() {
    try {
      download(window.FontBuild.toTTF(doc()), fileBase() + '.ttf', 'font/ttf');
    } catch (e) {
      toast('TTF build failed: ' + e.message, false);
    }
  }

  function onWOFF() {
    var ttf;
    try {
      ttf = window.FontBuild.toTTF(doc());
    } catch (e) {
      toast('WOFF build failed: ' + e.message, false);
      return;
    }
    window.FontBuild.toWOFF(ttf).then(function (woff) {
      download(woff, fileBase() + '.woff', 'font/woff');
    }).catch(function (e) {
      toast('WOFF build failed: ' + e.message, false);
    });
  }

  function onCfont() {
    download(window.FontModel.serialize(), fileBase() + '.cfont', 'application/json');
  }

  function exportedCount() {
    var d = doc();
    var enabled = {};
    for (var i = 0; i < d.sets.length; i++) enabled[d.sets[i]] = true;
    var n = 0;
    for (var k in d.glyphs) {
      if (enabled[window.FontModel.setOf(Number(k))]) n++;
    }
    return n;
  }

  // ── modal ─────────────────────────────────────────────────────

  function build(sec) {
    // metadata
    var metaGrid = el('div', { class: 'export-meta' });
    META_FIELDS.forEach(function (f) {
      var input = el('input', { type: 'text' });
      input.value = doc().meta[f[0]];
      bindMeta(f[0], input);
      inputs[f[0]] = input;
      metaGrid.appendChild(el('div', { class: 'field' }, [
        el('label', {}, f[1]), input
      ]));
    });
    sec.appendChild(el('div', { class: 'panel' }, [
      el('h3', {}, 'Font metadata'), metaGrid
    ]));

    // license
    var licGrid = el('div', { class: 'export-lic' });
    LICENSES.forEach(function (lic) {
      var card = el('div', { class: 'lic-card' }, [
        el('h4', {}, lic.name),
        el('p', {}, lic.blurb)
      ]);
      card.addEventListener('click', function () { pickLicense(lic.id); });
      cards[lic.id] = card;
      licGrid.appendChild(card);
    });
    sec.appendChild(el('div', { class: 'panel' }, [
      el('h3', {}, 'License'),
      licGrid,
      el('div', { class: 'lic-note' },
        'Fonts you create here are 100% yours; this choice is embedded in the ' +
        'exported file’s metadata.')
    ]));

    // downloads — only glyphs in enabled sets are compiled in
    var ttfBtn = el('button', { class: 'btn primary' }, 'Download TTF');
    ttfBtn.addEventListener('click', onTTF);
    var woffBtn = el('button', { class: 'btn' }, 'Download WOFF');
    woffBtn.addEventListener('click', onWOFF);
    var cfontBtn = el('button', { class: 'btn' }, 'Download .cfont');
    cfontBtn.addEventListener('click', onCfont);

    sec.appendChild(el('div', { class: 'panel' }, [
      el('h3', {}, 'Download'),
      el('div', { class: 'row' }, [ttfBtn, woffBtn, cfontBtn]),
      el('div', { class: 'export-note' },
        'TTF/WOFF include the ' + exportedCount() + ' glyph(s) in the enabled sets; ' +
        'the .cfont project keeps everything.')
    ]));

    renderMeta();
    renderLicense();
  }

  var UIExport = {
    // Modal, not a tab: DOM lives only while the popup is open.
    open: function () {
      injectStyle();
      var m = window.UI.modal('Export', function () {
        inputs = {};
        cards = {};
      });
      m.body.classList.add('uiexport-modal');
      build(m.body);
    },

    init: function () {
      // keep the open modal live-synced; all handlers no-op when closed
      window.FontModel.onChange(function () {
        renderMeta();
        renderLicense();
      });
    }
  };

  window.UIExport = UIExport;
})();
