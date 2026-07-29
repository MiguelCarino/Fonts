(function () {
  'use strict';

  var PANGRAM = 'Sphinx of black quartz, judge my vow. 0123456789';
  var WATERFALL_SIZES = [8, 10, 12, 14, 18, 24, 36, 48, 72];
  var DEBOUNCE_MS = 300;
  var FALLBACK_STACK = 'system-ui, sans-serif';

  var built = false;
  var textarea = null;
  var slider = null;
  var sizeLabel = null;
  var statusLine = null;
  var renderDiv = null;
  var waterfallLines = [];
  var debounceTimer = null;
  var compileSeq = 0; // stale-promise guard

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function injectStyles() {
    if (document.getElementById('uipreview-style')) return;
    var s = document.createElement('style');
    s.id = 'uipreview-style';
    s.textContent =
      '.uipreview-modal .uipreview-controls{display:flex;flex-direction:column;gap:12px}' +
      '.uipreview-modal .uipreview-textarea{width:100%;min-height:70px}' +
      '.uipreview-modal .uipreview-toprow{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}' +
      '.uipreview-modal .uipreview-toprow .field{margin:0}' +
      '.uipreview-modal .uipreview-text-field{flex:1;min-width:280px}' +
      '.uipreview-modal .uipreview-size-field{width:280px;flex-shrink:0}' +
      '.uipreview-modal .uipreview-sizerow{display:flex;align-items:center;gap:12px;min-height:70px}' +
      '.uipreview-modal .uipreview-sizerow input[type=range]{flex:1}' +
      '.uipreview-modal .uipreview-sizeval{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-mono);color:var(--text-dim);min-width:52px}' +
      '.uipreview-modal .uipreview-status{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-sm);min-height:1.2em}' +
      '.uipreview-modal .uipreview-status.ok{color:var(--ok)}' +
      '.uipreview-modal .uipreview-status.warn{color:var(--accent)}' +
      '.uipreview-modal .uipreview-render{min-height:90px;line-height:1.35;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--text)}' +
      '.uipreview-modal .uipreview-note{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-sm);color:var(--accent)}' +
      '.uipreview-modal .uipreview-wf-row{display:flex;align-items:baseline;gap:14px;padding:6px 0;border-bottom:1px solid var(--border)}' +
      '.uipreview-modal .uipreview-wf-row:last-child{border-bottom:none}' +
      '.uipreview-modal .uipreview-wf-size{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-label);color:var(--text-muted);min-width:44px;flex-shrink:0;text-align:right}' +
      '.uipreview-modal .uipreview-wf-line{line-height:1.2;white-space:nowrap;overflow-x:auto;color:var(--text)}' +
      '.uipreview-modal .uipreview-wf-wrap{overflow-x:auto}';
    document.head.appendChild(s);
  }

  function setStatus(kind, msg) {
    if (!statusLine) return;
    statusLine.className = 'uipreview-status' + (kind ? ' ' + kind : '');
    statusLine.textContent = msg;
  }

  function applyFamily(fam) {
    var stack = fam ? '"' + fam + '", ' + FALLBACK_STACK : FALLBACK_STACK;
    renderDiv.style.fontFamily = stack;
    for (var i = 0; i < waterfallLines.length; i++) waterfallLines[i].style.fontFamily = stack;
  }

  function applyText() {
    var text = textarea.value || PANGRAM;
    renderDiv.textContent = text;
    for (var i = 0; i < waterfallLines.length; i++) waterfallLines[i].textContent = text;
  }

  function applySize() {
    var px = parseInt(slider.value, 10) || 48;
    renderDiv.style.fontSize = px + 'px';
    sizeLabel.textContent = px + 'px';
  }

  function glyphCount() {
    try { return Object.keys(window.FontModel.doc.glyphs).length; } catch (e) { return 0; }
  }

  function recompile() {
    if (!statusLine) return; // modal closed
    var seq = ++compileSeq;
    if (typeof FontFace === 'undefined') {
      setStatus('warn', 'FontFace API unavailable in this browser — live preview disabled');
      return;
    }
    setStatus('', 'compiling…');
    Promise.resolve().then(function () {
      return window.FontBuild.previewInstall(window.FontModel.doc);
    }).then(function (fam) {
      if (seq !== compileSeq) return;
      applyFamily(fam);
      setStatus('ok', 'compiled ' + glyphCount() + ' glyphs');
    }).catch(function (err) {
      if (seq !== compileSeq) return;
      setStatus('warn', 'compile failed: ' + (err && err.message ? err.message : String(err)));
    });
  }

  function scheduleRecompile() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      recompile();
    }, DEBOUNCE_MS);
  }

  function build(section) {
    injectStyles();

    var controls = el('div', 'panel uipreview-controls');

    var textField = el('div', 'field uipreview-text-field');
    var textLbl = el('label', null, 'Sample text');
    textarea = document.createElement('textarea');
    textarea.className = 'uipreview-textarea';
    textarea.value = PANGRAM;
    textarea.spellcheck = false;
    textField.appendChild(textLbl);
    textField.appendChild(textarea);

    var sizeField = el('div', 'field uipreview-size-field');
    var sizeLbl = el('label', null, 'Size');
    var sizeRow = el('div', 'uipreview-sizerow');
    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '8';
    slider.max = '120';
    slider.value = '48';
    sizeLabel = el('span', 'uipreview-sizeval');
    sizeRow.appendChild(slider);
    sizeRow.appendChild(sizeLabel);
    sizeField.appendChild(sizeLbl);
    sizeField.appendChild(sizeRow);

    statusLine = el('div', 'uipreview-status');

    var topRow = el('div', 'uipreview-toprow');
    topRow.appendChild(textField);
    topRow.appendChild(sizeField);
    controls.appendChild(topRow);
    controls.appendChild(statusLine);
    if (typeof FontFace === 'undefined') {
      controls.appendChild(el('div', 'uipreview-note',
        'This browser does not support the FontFace API — the preview below falls back to a system font.'));
    }
    section.appendChild(controls);

    var livePanel = el('div', 'panel');
    livePanel.appendChild(el('h3', null, 'Live preview'));
    renderDiv = el('div', 'uipreview-render');
    livePanel.appendChild(renderDiv);
    section.appendChild(livePanel);

    var wfPanel = el('div', 'panel');
    wfPanel.appendChild(el('h3', null, 'Waterfall'));
    var wfWrap = el('div', 'uipreview-wf-wrap');
    waterfallLines = [];
    for (var i = 0; i < WATERFALL_SIZES.length; i++) {
      var sz = WATERFALL_SIZES[i];
      var row = el('div', 'uipreview-wf-row');
      row.appendChild(el('span', 'uipreview-wf-size', sz + 'px'));
      var line = el('div', 'uipreview-wf-line');
      line.style.fontSize = sz + 'px';
      row.appendChild(line);
      wfWrap.appendChild(row);
      waterfallLines.push(line);
    }
    wfPanel.appendChild(wfWrap);
    section.appendChild(wfPanel);

    textarea.addEventListener('input', applyText);
    slider.addEventListener('input', applySize);

    applyFamily(null);
    applyText();
    applySize();
  }

  var UIPreview = {
    // Modal, not a tab: DOM lives only while the popup is open.
    open: function () {
      var m = window.UI.modal('Preview', function () {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        textarea = slider = sizeLabel = statusLine = renderDiv = null;
        waterfallLines = [];
      });
      m.body.classList.add('uipreview-modal');
      build(m.body);
      recompile();
    },

    init: function () {
      // live re-render while the popup is open; a no-op when closed
      window.FontModel.onChange(scheduleRecompile);
    }
  };

  window.UIPreview = UIPreview;
})();
