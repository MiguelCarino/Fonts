(function () {
  'use strict';

  var MAX_CANVAS = 720;

  var root = null;
  var hintEl, editorWrap, titleEl, canvas, ctx;
  var advInput, wInput, hInput, bInput, eraseBtn;
  var cellPx = 24;
  var eraseMode = false;
  var drag = null; // {val:'0'|'1', last:{c,r}, dirty:bool} — save() fires once, on pointerup
  // reference background image (session-only, never part of the font)
  var bgImg = null;
  var bgUrl = null;
  var bgOpacity = 0.4;
  var bgScale = 1;        // relative to cover-fit
  var bgX = 0, bgY = 0;   // px offset from centered position
  var bgMove = false;     // drag-the-image mode
  var bgDrag = null;

  function clampInt(v, d, lo, hi) {
    v = Math.round(Number(v));
    if (!Number.isFinite(v)) v = d;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function selCp() {
    var u = window.UI;
    return (u && typeof u.selGlyph === 'number') ? u.selGlyph : null;
  }

  function fmtCp(cp) {
    var u = window.UI;
    if (u && u.fmtCp) return u.fmtCp(cp);
    return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') + ' ' + String.fromCodePoint(cp);
  }

  function toast(msg, ok) {
    var u = window.UI;
    if (u && u.toast) u.toast(msg, ok !== false);
  }

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function numField(labelText, id) {
    var f = mk('div', 'field');
    var lab = i18nTag(mk('label'), labelText);
    lab.htmlFor = id;
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.id = id;
    inp.className = 'uipixel-num';
    f.appendChild(lab);
    f.appendChild(inp);
    return { field: f, input: inp };
  }

  // ── glyph access ─────────────────────────────────────────────

  function viewGlyph(cp) {
    return FontModel.getGlyph(cp); // may be null: render blank, create only on first edit
  }

  function editGlyph(cp) {
    return FontModel.ensureGlyph(cp);
  }

  function setCell(g, c, r, val) {
    // bounds guard: drag state can outlive a grid resize (e.g. undo mid-stroke)
    if (r < 0 || r >= g.px.length) return false;
    var row = g.px[r];
    if (c < 0 || c >= row.length) return false;
    if (row.charAt(c) === val) return false;
    g.px[r] = row.slice(0, c) + val + row.slice(c + 1);
    return true;
  }

  // ── canvas ───────────────────────────────────────────────────

  function sizeCanvas() {
    var grid = FontModel.doc.grid;
    cellPx = clampInt(Math.floor(MAX_CANVAS / Math.max(grid.w, grid.h)), 24, 8, 44);
    var cssW = grid.w * cellPx, cssH = grid.h * cellPx;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintCanvas() {
    var doc = FontModel.doc;
    var grid = doc.grid;
    var cp = selCp();
    var g = cp == null ? null : viewGlyph(cp);
    var w = grid.w * cellPx, h = grid.h * cellPx;
    var cellUnit = doc.meta.upm / grid.h;
    var baseY = grid.baseline * cellPx;
    var c, r;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, w, h);
    // descender rows slightly lifted so the baseline split reads at a glance
    if (baseY < h) {
      ctx.fillStyle = 'rgba(255,255,255,.035)';
      ctx.fillRect(0, baseY, w, h - baseY);
    }

    // reference image: covers the whole canvas, draggable + scalable
    if (bgImg) {
      var bs = Math.max(w / bgImg.width, h / bgImg.height) * bgScale;
      var bw = bgImg.width * bs, bh = bgImg.height * bs;
      ctx.globalAlpha = bgOpacity;
      ctx.drawImage(bgImg, bgX + (w - bw) / 2, bgY + (h - bh) / 2, bw, bh);
      ctx.globalAlpha = 1;
    }

    if (g) {
      ctx.fillStyle = '#eab308';
      for (r = 0; r < grid.h; r++) {
        var row = g.px[r] || '';
        for (c = 0; c < grid.w; c++) {
          if (row.charAt(c) === '1') ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
        }
      }
    }

    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (c = 0; c <= grid.w; c++) { ctx.moveTo(c * cellPx + 0.5, 0); ctx.lineTo(c * cellPx + 0.5, h); }
    for (r = 0; r <= grid.h; r++) { ctx.moveTo(0, r * cellPx + 0.5); ctx.lineTo(w, r * cellPx + 0.5); }
    ctx.stroke();

    // faint x-height / cap guides (heights above baseline, may fall between rows)
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    var xhY = baseY - (doc.meta.xHeight / cellUnit) * cellPx;
    var capY = baseY - (doc.meta.capHeight / cellUnit) * cellPx;
    if (xhY > 0 && xhY < h) {
      ctx.strokeStyle = 'rgba(234,179,8,.25)';
      ctx.beginPath(); ctx.moveTo(0, xhY); ctx.lineTo(w, xhY); ctx.stroke();
    }
    if (capY > 0 && capY < h) {
      ctx.strokeStyle = 'rgba(234,179,8,.18)';
      ctx.beginPath(); ctx.moveTo(0, capY); ctx.lineTo(w, capY); ctx.stroke();
    }
    ctx.setLineDash([]);

    // baseline
    if (baseY >= 0 && baseY <= h) {
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();
    }

    // advance width marker
    if (g) {
      var advX = (g.adv / cellUnit) * cellPx;
      if (advX > 0 && advX <= w) {
        ctx.strokeStyle = 'rgba(34,197,94,.7)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(advX, 0); ctx.lineTo(advX, h); ctx.stroke();
      }
    }
  }

  // ── painting ─────────────────────────────────────────────────

  function cellAt(ev) {
    var rect = canvas.getBoundingClientRect();
    var grid = FontModel.doc.grid;
    var c = Math.floor((ev.clientX - rect.left) / cellPx);
    var r = Math.floor((ev.clientY - rect.top) / cellPx);
    if (c < 0 || r < 0 || c >= grid.w || r >= grid.h) return null;
    return { c: c, r: r };
  }

  function applyStroke(g, from, to, val) {
    // interpolate so fast drags leave no gaps
    var steps = Math.max(Math.abs(to.c - from.c), Math.abs(to.r - from.r), 1);
    var changed = false;
    for (var i = 1; i <= steps; i++) {
      var c = Math.round(from.c + (to.c - from.c) * i / steps);
      var r = Math.round(from.r + (to.r - from.r) * i / steps);
      if (setCell(g, c, r, val)) changed = true;
    }
    return changed;
  }

  function onPointerDown(ev) {
    if (bgMove && bgImg) {
      ev.preventDefault();
      bgDrag = { x: ev.clientX, y: ev.clientY, x0: bgX, y0: bgY };
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    var cp = selCp();
    if (cp == null) return;
    ev.preventDefault();
    var cell = cellAt(ev);
    if (!cell) return;
    var val = (ev.button === 2 || eraseMode) ? '0' : '1';
    var created = !viewGlyph(cp); // ensureGlyph materializing counts as a change
    var g = editGlyph(cp);
    drag = { val: val, last: cell, dirty: setCell(g, cell.c, cell.r, val) || created };
    canvas.setPointerCapture(ev.pointerId);
    paintCanvas();
  }

  function onPointerMove(ev) {
    if (bgDrag) {
      bgX = bgDrag.x0 + (ev.clientX - bgDrag.x);
      bgY = bgDrag.y0 + (ev.clientY - bgDrag.y);
      paintCanvas();
      return;
    }
    if (!drag) return;
    var cp = selCp();
    if (cp == null) return;
    var cell = cellAt(ev);
    if (!cell || (cell.c === drag.last.c && cell.r === drag.last.r)) return;
    var g = editGlyph(cp);
    if (applyStroke(g, drag.last, cell, drag.val)) drag.dirty = true;
    drag.last = cell;
    paintCanvas();
  }

  function onPointerUp() {
    if (bgDrag) { bgDrag = null; return; }
    if (!drag) return;
    var dirty = drag.dirty;
    drag = null;
    if (dirty) FontModel.save();
  }

  // ── ops ──────────────────────────────────────────────────────

  function withGlyph(fn) {
    var cp = selCp();
    if (cp == null) return;
    var g = editGlyph(cp);
    if (fn(g) !== false) FontModel.save();
  }

  function opClear(g) {
    var grid = FontModel.doc.grid;
    for (var r = 0; r < grid.h; r++) g.px[r] = new Array(grid.w + 1).join('0');
  }

  function opInvert(g) {
    var grid = FontModel.doc.grid;
    for (var r = 0; r < grid.h; r++) {
      var out = '';
      for (var c = 0; c < grid.w; c++) out += g.px[r].charAt(c) === '1' ? '0' : '1';
      g.px[r] = out;
    }
  }

  function opShift(g, dc, dr) {
    var grid = FontModel.doc.grid;
    var rows = [];
    for (var r = 0; r < grid.h; r++) {
      var out = '';
      for (var c = 0; c < grid.w; c++) {
        var sc = c - dc, sr = r - dr;
        var on = sr >= 0 && sr < grid.h && sc >= 0 && sc < grid.w && g.px[sr].charAt(sc) === '1';
        out += on ? '1' : '0';
      }
      rows.push(out);
    }
    g.px = rows;
  }

  function opAutoFit(g) {
    var doc = FontModel.doc;
    var grid = doc.grid;
    var rightmost = -1;
    for (var r = 0; r < grid.h; r++) {
      for (var c = grid.w - 1; c > rightmost; c--) {
        if (g.px[r].charAt(c) === '1') { rightmost = c; break; }
      }
    }
    if (rightmost < 0) { toast(t('Glyph is empty — advance unchanged'), false); return false; }
    var cellUnit = doc.meta.upm / grid.h;
    g.adv = clampInt(Math.round((rightmost + 1.5) * cellUnit), g.adv, 0, 32767);
    toast(t('Advance set to') + ' ' + g.adv);
  }

  function onAdvChange() {
    var cp = selCp();
    if (cp == null) return;
    var g = editGlyph(cp);
    var v = clampInt(advInput.value, g.adv, 0, 32767);
    advInput.value = v;
    if (v === g.adv) return;
    g.adv = v;
    FontModel.save();
  }

  // ── per-font grid settings ───────────────────────────────────

  function onGridChange() {
    var doc = FontModel.doc;
    var old = doc.grid;
    var w = clampInt(wInput.value, old.w, 2, 64);
    var h = clampInt(hInput.value, old.h, 2, 64);
    var b = clampInt(bInput.value, old.baseline, 0, h);
    if (w === old.w && h === old.h && b === old.baseline) { syncInputs(); return; }
    // re-anchor every glyph's art to the baseline; overflow clips
    for (var key in doc.glyphs) {
      var g = doc.glyphs[key];
      var rows = [];
      for (var r = 0; r < h; r++) {
        var sr = r - b + old.baseline;
        var out = '';
        for (var c = 0; c < w; c++) {
          var on = sr >= 0 && sr < old.h && c < old.w && g.px[sr] && g.px[sr].charAt(c) === '1';
          out += on ? '1' : '0';
        }
        rows.push(out);
      }
      g.px = rows;
    }
    doc.grid = { w: w, h: h, baseline: b };
    FontModel.save();
  }

  function syncInputs() {
    var doc = FontModel.doc;
    var cp = selCp();
    var g = cp == null ? null : viewGlyph(cp);
    var active = document.activeElement;
    if (active !== wInput) wInput.value = doc.grid.w;
    if (active !== hInput) hInput.value = doc.grid.h;
    if (active !== bInput) { bInput.max = doc.grid.h; bInput.value = doc.grid.baseline; }
    if (active !== advInput) advInput.value = g ? g.adv : Math.round(doc.meta.upm * 0.5);
  }

  // ── render ───────────────────────────────────────────────────

  function render() {
    if (!root) return;
    // a model emit during a stroke means the doc was replaced from outside
    // (undo/open/…): the drag's grid coords may be stale — drop it. Safe:
    // onPointerUp clears drag before calling save().
    drag = null;
    var cp = selCp();
    var g = cp == null ? null : viewGlyph(cp);
    if (cp == null) {
      hintEl.textContent = t('No glyph selected — pick one in the Glyphs tab.');
      hintEl.style.display = '';
      editorWrap.style.display = 'none';
      return;
    }
    if (g && g.mode === 'vector') {
      hintEl.textContent = fmtCp(cp) + ' ' + t('is a vector glyph — switch it to pixel mode or use the vector editor.');
      hintEl.style.display = '';
      editorWrap.style.display = 'none';
      return;
    }
    hintEl.style.display = 'none';
    editorWrap.style.display = '';
    titleEl.textContent = fmtCp(cp);
    syncInputs();
    sizeCanvas();
    paintCanvas();
  }

  // ── build ────────────────────────────────────────────────────

  function buildDom() {
    var style = document.createElement('style');
    style.id = 'uipixel-style';
    style.textContent = [
      '#editor-pixel .uipixel-hint { color: var(--text-dim); font-size: var(--fs-sec); }',
      '#editor-pixel .uipixel-num { width: 76px; }',
      '#editor-pixel .uipixel-title { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-lg); color: var(--accent); font-weight: 700; }',
      '#editor-pixel .uipixel-canvas { cursor: crosshair; touch-action: none; border: 1px solid var(--border); border-radius: 6px; align-self: flex-start; }',
      '#editor-pixel .uipixel-legend { display: flex; gap: 14px; font-family: "IBM Plex Mono", monospace; font-size: var(--fs-micro); text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }',
      '#editor-pixel .uipixel-legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }',
      '#editor-pixel .uipixel-body { display: flex; flex-direction: column; gap: 12px; }',
      '#editor-pixel .uipixel-note { color: var(--text-muted); font-size: var(--fs-sm); }',
      // canvas left, controls right — mirrors the vector editor layout
      '#editor-pixel .uipixel-main { display: flex; gap: 14px; align-items: flex-start; }',
      '#editor-pixel .uipixel-canvaspanel { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }',
      '#editor-pixel .uipixel-side { width: 272px; flex-shrink: 0; display: flex; flex-direction: column; gap: 14px; }',
      '#editor-pixel .uipixel-side .panel { padding: 12px 14px; }',
      '#editor-pixel .uipixel-ptitle { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-label); font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--text-dim); margin-bottom: 10px; }',
      '#editor-pixel .uipixel-side .row { row-gap: 8px; }'
    ].join('\n');
    root.appendChild(style);

    hintEl = mk('div', 'panel uipixel-hint');
    root.appendChild(hintEl);

    editorWrap = mk('div', 'uipixel-main');
    root.appendChild(editorWrap);

    // left: title + canvas + legend
    var panel = mk('div', 'panel uipixel-canvaspanel');
    editorWrap.appendChild(panel);

    titleEl = mk('span', 'uipixel-title');
    panel.appendChild(titleEl);

    canvas = document.createElement('canvas');
    canvas.className = 'uipixel-canvas';
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    panel.appendChild(canvas);

    var legend = mk('div', 'uipixel-legend');
    var items = [['#eab308', 'baseline'], ['rgba(234,179,8,.35)', 'x-height / cap'], ['rgba(34,197,94,.7)', 'advance']];
    for (var j = 0; j < items.length; j++) {
      var s = mk('span');
      var sw = mk('i');
      sw.style.background = items[j][0];
      s.appendChild(sw);
      s.appendChild(i18nTag(mk('span'), items[j][1]));
      legend.appendChild(s);
    }
    panel.appendChild(legend);

    // right: controls sidebar (mirrors the vector editor's .uiv-side)
    var side = mk('div', 'uipixel-side');
    editorWrap.appendChild(side);

    var toolsPanel = mk('div', 'panel');
    toolsPanel.appendChild(i18nTag(mk('div', 'uipixel-ptitle'), 'Tools'));
    var toolsRow = mk('div', 'row');
    eraseBtn = i18nTag(mk('button', 'btn'), 'Erase');
    i18nTitle(eraseBtn, 'Toggle erase mode (right-click always erases)');
    eraseBtn.addEventListener('click', function () {
      eraseMode = !eraseMode;
      eraseBtn.classList.toggle('active', eraseMode);
    });
    toolsRow.appendChild(eraseBtn);
    var ops = [
      ['Clear', function () { withGlyph(opClear); }],
      ['Invert', function () { withGlyph(opInvert); }],
      ['←', function () { withGlyph(function (g) { opShift(g, -1, 0); }); }],
      ['→', function () { withGlyph(function (g) { opShift(g, 1, 0); }); }],
      ['↑', function () { withGlyph(function (g) { opShift(g, 0, -1); }); }],
      ['↓', function () { withGlyph(function (g) { opShift(g, 0, 1); }); }]
    ];
    for (var i = 0; i < ops.length; i++) {
      var b = i18nTag(mk('button', 'btn'), ops[i][0]);
      b.addEventListener('click', ops[i][1]);
      toolsRow.appendChild(b);
    }
    toolsPanel.appendChild(toolsRow);
    side.appendChild(toolsPanel);

    // advance width
    var advPanel = mk('div', 'panel');
    advPanel.appendChild(i18nTag(mk('div', 'uipixel-ptitle'), 'Advance'));
    var advRow = mk('div', 'row');
    var advF = numField('Advance (units)', 'uipixel-adv');
    advInput = advF.input;
    advInput.min = 0;
    advInput.max = 32767;
    advInput.addEventListener('change', onAdvChange);
    advRow.appendChild(advF.field);
    var fit = i18nTag(mk('button', 'btn'), 'Auto-fit');
    i18nTitle(fit, 'Rightmost filled column + 1.5 cells');
    fit.style.alignSelf = 'flex-end';
    fit.addEventListener('click', function () { withGlyph(opAutoFit); });
    advRow.appendChild(fit);
    advPanel.appendChild(advRow);
    side.appendChild(advPanel);

    // per-font grid settings
    var settings = mk('div', 'panel');
    settings.appendChild(i18nTag(mk('div', 'uipixel-ptitle'), 'Grid (per font)'));
    var srow = mk('div', 'row');
    var wF = numField('Grid W', 'uipixel-gw');
    var hF = numField('Grid H', 'uipixel-gh');
    var bF = numField('Baseline row', 'uipixel-gb');
    wInput = wF.input; wInput.min = 2; wInput.max = 64;
    hInput = hF.input; hInput.min = 2; hInput.max = 64;
    bInput = bF.input; bInput.min = 0; bInput.max = 64;
    wInput.addEventListener('change', onGridChange);
    hInput.addEventListener('change', onGridChange);
    bInput.addEventListener('change', onGridChange);
    srow.appendChild(wF.field);
    srow.appendChild(hF.field);
    srow.appendChild(bF.field);
    settings.appendChild(srow);
    settings.appendChild(i18nTag(mk('div', 'uipixel-note'), 'Changing the grid re-anchors every glyph to the baseline; overflowing pixels are clipped.'));
    side.appendChild(settings);

    // reference background image
    var bgPanel = mk('div', 'panel');
    bgPanel.appendChild(i18nTag(mk('div', 'uipixel-ptitle'), 'Background image'));
    var bgInput = document.createElement('input');
    bgInput.type = 'file';
    bgInput.accept = 'image/*';
    bgInput.style.display = 'none';
    bgInput.addEventListener('change', function () {
      setBgFile(bgInput.files[0]);
      bgInput.value = '';
    });
    var bgRow = mk('div', 'row');
    var bgLoad = i18nTag(mk('button', 'btn'), 'Load image…');
    bgLoad.addEventListener('click', function () { bgInput.click(); });
    var bgRemove = i18nTag(mk('button', 'btn'), 'Remove');
    bgRemove.addEventListener('click', removeBg);
    bgRow.appendChild(bgLoad);
    bgRow.appendChild(bgRemove);
    bgRow.appendChild(bgInput);
    bgPanel.appendChild(bgRow);
    var moveBtn = i18nTag(mk('button', 'btn'), 'Move');
    i18nTitle(moveBtn, 'Drag the image instead of painting');
    moveBtn.addEventListener('click', function () {
      bgMove = !bgMove;
      moveBtn.classList.toggle('active', bgMove);
    });
    bgRow.appendChild(moveBtn);
    var opRow = mk('div', 'row');
    var opLbl = i18nTag(mk('label', 'lbl'), 'Opacity');
    var opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.min = '0';
    opSlider.max = '100';
    opSlider.value = String(Math.round(bgOpacity * 100));
    opSlider.style.flex = '1';
    opSlider.addEventListener('input', function () {
      bgOpacity = (parseInt(opSlider.value, 10) || 0) / 100;
      paintCanvas();
    });
    opRow.appendChild(opLbl);
    opRow.appendChild(opSlider);
    bgPanel.appendChild(opRow);
    var scRow = mk('div', 'row');
    var scLbl = i18nTag(mk('label', 'lbl'), 'Scale');
    var scSlider = document.createElement('input');
    scSlider.type = 'range';
    scSlider.min = '10';
    scSlider.max = '400';
    scSlider.value = '100';
    scSlider.style.flex = '1';
    scSlider.addEventListener('input', function () {
      bgScale = (parseInt(scSlider.value, 10) || 100) / 100;
      paintCanvas();
    });
    scRow.appendChild(scLbl);
    scRow.appendChild(scSlider);
    bgPanel.appendChild(scRow);
    bgPanel.appendChild(i18nTag(mk('div', 'uipixel-note'), 'Covers the canvas; toggle Move to drag it into place. Session-only tracing aid — never exported with the font.'));
    side.appendChild(bgPanel);
  }

  function setBgFile(file) {
    if (!file) return;
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { bgImg = img; bgX = 0; bgY = 0; paintCanvas(); };
    img.onerror = function () { toast(t('Could not load image'), false); };
    img.src = bgUrl;
  }

  function removeBg() {
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    bgImg = null;
    paintCanvas();
  }

  window.UIPixel = {
    init: function () {
      root = document.getElementById('editor-pixel');
      if (!root || root.childNodes.length) return;
      buildDom();
      FontModel.onChange(render);
      render();
    }
  };
})();
