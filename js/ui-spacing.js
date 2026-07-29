(function () {
  'use strict';

  var SIZE = 110;   // sample em size in px
  var PAD = 24;
  var STEP = 10;    // kerning step in font units
  var HIT = 26;     // px radius for picking a gap
  var KERN_LIM = 4000;

  // [target, base, mark] — Latin-1 precomposed combos buildable from
  // spacing marks: acute B4, grave 60, circumflex 5E, diaeresis A8,
  // tilde 7E, ring B0, cedilla B8.
  var ACCENTS = [
    [0xE1, 0x61, 0xB4], [0xE0, 0x61, 0x60], [0xE2, 0x61, 0x5E], [0xE4, 0x61, 0xA8],
    [0xE3, 0x61, 0x7E], [0xE5, 0x61, 0xB0],
    [0xE9, 0x65, 0xB4], [0xE8, 0x65, 0x60], [0xEA, 0x65, 0x5E], [0xEB, 0x65, 0xA8],
    [0xED, 0x69, 0xB4], [0xEC, 0x69, 0x60], [0xEE, 0x69, 0x5E], [0xEF, 0x69, 0xA8],
    [0xF1, 0x6E, 0x7E],
    [0xF3, 0x6F, 0xB4], [0xF2, 0x6F, 0x60], [0xF4, 0x6F, 0x5E], [0xF6, 0x6F, 0xA8],
    [0xF5, 0x6F, 0x7E],
    [0xFA, 0x75, 0xB4], [0xF9, 0x75, 0x60], [0xFB, 0x75, 0x5E], [0xFC, 0x75, 0xA8],
    [0xFD, 0x79, 0xB4], [0xFF, 0x79, 0xA8],
    [0xE7, 0x63, 0xB8],
    [0xC1, 0x41, 0xB4], [0xC9, 0x45, 0xB4], [0xCD, 0x49, 0xB4], [0xD3, 0x4F, 0xB4],
    [0xDA, 0x55, 0xB4], [0xD1, 0x4E, 0x7E], [0xC7, 0x43, 0xB8]
  ];

  var sampleText = 'AVATO Wave.';
  var sel = null;       // {l, r} codepoints of selected pair
  var bounds = [];      // [{x(px), l, r}] gap centers in canvas css px
  var drag = null;
  var els = {};

  function doc() { return window.FontModel.doc; }
  function chr(cp) { return String.fromCodePoint(cp); }
  function hex(cp) { return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'); }
  function kernKey(l, r) { return l + ',' + r; }
  function kernVal(l, r) {
    var v = doc().kerning[kernKey(l, r)];
    return typeof v === 'number' ? v : 0;
  }
  function toast(msg, ok) {
    if (window.UI && window.UI.toast) window.UI.toast(msg, ok !== false);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── outlines ────────────────────────────────────────────────────

  function pixelRects(g, d) {
    // fallback when FontBuild is unavailable: one rect contour per cell
    var cell = d.meta.upm / d.grid.h;
    var out = [];
    for (var r = 0; r < g.px.length; r++) {
      for (var c = 0; c < g.px[r].length; c++) {
        if (g.px[r].charAt(c) !== '1') continue;
        var x0 = c * cell, x1 = x0 + cell;
        var yT = (d.grid.baseline - r) * cell, yB = yT - cell;
        out.push([{ x: x0, y: yB }, { x: x0, y: yT }, { x: x1, y: yT }, { x: x1, y: yB }]);
      }
    }
    return out;
  }

  function shiftContour(c, dx, dy) {
    var out = [];
    for (var i = 0; i < c.length; i++) {
      var p = c[i];
      var q = { x: p.x + dx, y: p.y + dy };
      if (typeof p.cx1 === 'number') {
        q.cx1 = p.cx1 + dx; q.cy1 = p.cy1 + dy;
        q.cx2 = p.cx2 + dx; q.cy2 = p.cy2 + dy;
      }
      out.push(q);
    }
    return out;
  }

  function outlineOf(cp, d, seen) {
    var g = d.glyphs[String(cp)];
    if (!g) return [];
    seen = seen || {};
    if (seen[cp]) return [];
    seen[cp] = true;
    var out = [];
    var i;
    if (g.mode === 'pixel') {
      var px = null;
      if (window.FontBuild && window.FontBuild.pixelToContours) {
        try { px = window.FontBuild.pixelToContours(g, d); } catch (e) { px = null; }
      }
      if (!px) px = pixelRects(g, d);
      out = out.concat(px);
    } else {
      for (i = 0; i < g.contours.length; i++) out.push(g.contours[i]);
    }
    for (i = 0; i < g.components.length; i++) {
      var comp = g.components[i];
      var sub = outlineOf(comp.ref, d, seen);
      for (var j = 0; j < sub.length; j++) out.push(shiftContour(sub[j], comp.dx, comp.dy));
    }
    seen[cp] = false; // off the stack: same ref may recur in a sibling
    return out;
  }

  function traceGlyph(ctx, contours, ox, baseY, s) {
    ctx.beginPath();
    for (var i = 0; i < contours.length; i++) {
      var c = contours[i];
      if (c.length < 2) continue;
      ctx.moveTo(ox + c[0].x * s, baseY - c[0].y * s);
      for (var j = 1; j <= c.length; j++) {
        var p = c[j % c.length]; // wrap: closing segment uses first anchor's handles
        if (typeof p.cx1 === 'number') {
          ctx.bezierCurveTo(
            ox + p.cx1 * s, baseY - p.cy1 * s,
            ox + p.cx2 * s, baseY - p.cy2 * s,
            ox + p.x * s, baseY - p.y * s);
        } else {
          ctx.lineTo(ox + p.x * s, baseY - p.y * s);
        }
      }
      ctx.closePath();
    }
    ctx.fill();
  }

  // ── sample canvas ───────────────────────────────────────────────

  function drawSample() {
    var d = doc();
    var canvas = els.canvas;
    var s = SIZE / d.meta.upm;
    var cps = [];
    for (var it = 0; it < sampleText.length;) {
      var cp = sampleText.codePointAt(it);
      cps.push(cp);
      it += cp > 0xFFFF ? 2 : 1;
    }

    var items = [];
    bounds = [];
    var pen = 0, i;
    for (i = 0; i < cps.length; i++) {
      if (i > 0) {
        var k = kernVal(cps[i - 1], cps[i]);
        bounds.push({ ux: pen + k / 2, l: cps[i - 1], r: cps[i] });
        pen += k;
      }
      var g = d.glyphs[String(cps[i])] || null;
      var adv = g ? g.adv : Math.round(d.meta.upm * 0.5);
      items.push({ cp: cps[i], ux: pen, adv: adv, g: g });
      pen += adv;
    }

    var asc = Math.max(d.meta.ascender, 1);
    var desc = Math.min(d.meta.descender, 0);
    var cssW = Math.max(240, Math.ceil(PAD * 2 + pen * s));
    var cssH = Math.ceil(PAD * 2 + (asc - desc) * s);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var baseY = PAD + asc * s;
    for (i = 0; i < bounds.length; i++) bounds[i].x = PAD + bounds[i].ux * s;

    ctx.strokeStyle = '#262626';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseY + 0.5);
    ctx.lineTo(cssW, baseY + 0.5);
    ctx.stroke();

    for (i = 0; i < items.length; i++) {
      var m = items[i];
      var ox = PAD + m.ux * s;
      if (m.g) {
        var contours = outlineOf(m.cp, d, null);
        ctx.fillStyle = '#e5e5e5';
        traceGlyph(ctx, contours, ox, baseY, s);
      } else if (m.cp !== 0x20) {
        ctx.strokeStyle = '#444';
        ctx.setLineDash([3, 3]);
        var inset = m.adv * 0.1 * s;
        ctx.strokeRect(ox + inset, baseY - d.meta.xHeight * s, m.adv * s - inset * 2, d.meta.xHeight * s);
        ctx.setLineDash([]);
      }
    }

    if (sel) {
      ctx.strokeStyle = '#eab308';
      ctx.fillStyle = '#eab308';
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      for (i = 0; i < bounds.length; i++) {
        var b = bounds[i];
        if (b.l !== sel.l || b.r !== sel.r) continue;
        ctx.beginPath();
        ctx.moveTo(b.x + 0.5, PAD * 0.5);
        ctx.lineTo(b.x + 0.5, cssH - PAD * 0.5);
        ctx.stroke();
        ctx.fillText(String(kernVal(sel.l, sel.r)), b.x, PAD * 0.5 - 2 + 10);
      }
    }
  }

  function updateSelInfo() {
    var on = !!sel;
    els.minus.disabled = !on;
    els.plus.disabled = !on;
    els.selInfo.textContent = on
      ? chr(sel.l) + ' / ' + chr(sel.r) + ' : ' + kernVal(sel.l, sel.r)
      : 'no pair selected';
  }

  function selectPair(l, r) {
    sel = { l: l, r: r };
    drawSample();
    updateSelInfo();
    renderKernTable();
  }

  function nudge(dv) {
    if (!sel) return;
    var nk = Math.round((kernVal(sel.l, sel.r) + dv) / STEP) * STEP;
    nk = Math.max(-KERN_LIM, Math.min(KERN_LIM, nk));
    doc().kerning[kernKey(sel.l, sel.r)] = nk;
    window.FontModel.save();
  }

  function nearestBound(mx) {
    var best = null, bd = HIT;
    for (var i = 0; i < bounds.length; i++) {
      var dx = Math.abs(bounds[i].x - mx);
      if (dx < bd) { bd = dx; best = bounds[i]; }
    }
    return best;
  }

  function canvasX(ev) {
    return ev.clientX - els.canvas.getBoundingClientRect().left;
  }

  function onDown(ev) {
    var b = nearestBound(canvasX(ev));
    if (!b) return;
    ev.preventDefault();
    els.canvas.focus();
    sel = { l: b.l, r: b.r };
    drag = {
      startX: ev.clientX, startKern: kernVal(b.l, b.r), changed: false,
      existed: Object.prototype.hasOwnProperty.call(doc().kerning, kernKey(b.l, b.r))
    };
    drawSample();
    updateSelInfo();
    renderKernTable();
  }

  function onMove(ev) {
    if (!drag || !sel) return;
    var du = (ev.clientX - drag.startX) / (SIZE / doc().meta.upm);
    var nk = Math.round((drag.startKern + du) / STEP) * STEP;
    nk = Math.max(-KERN_LIM, Math.min(KERN_LIM, nk));
    if (nk !== kernVal(sel.l, sel.r)) {
      doc().kerning[kernKey(sel.l, sel.r)] = nk;
      drag.changed = nk !== drag.startKern;
      drawSample();
      updateSelInfo();
    }
  }

  function onUp() {
    if (!drag) return;
    var d = drag;
    drag = null;
    // drag ended back at its start value: reconcile the doc so a pair that
    // didn't exist before doesn't linger as an unsaved phantom "0" entry
    if (!d.changed && !d.existed && sel) delete doc().kerning[kernKey(sel.l, sel.r)];
    if (d.changed) window.FontModel.save();
  }

  function onKey(ev) {
    if (!sel) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-STEP); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(STEP); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      delete doc().kerning[kernKey(sel.l, sel.r)];
      window.FontModel.save();
    }
  }

  // ── kerning table ───────────────────────────────────────────────

  function renderKernTable() {
    var box = els.kernTable;
    box.textContent = '';
    var keys = Object.keys(doc().kerning).sort(function (a, b) {
      var pa = a.split(','), pb = b.split(',');
      return (+pa[0] - +pb[0]) || (+pa[1] - +pb[1]);
    });
    if (!keys.length) {
      box.appendChild(el('div', 'muted sp-empty', 'No kerning pairs yet. Click a gap in the sample above.'));
      return;
    }
    keys.forEach(function (key) {
      var parts = key.split(',');
      var l = +parts[0], r = +parts[1];
      var row = el('div', 'sp-row' + (sel && sel.l === l && sel.r === r ? ' sel' : ''));
      var pair = el('span', 'sp-pair', chr(l) + ' · ' + chr(r));
      pair.title = hex(l) + ' , ' + hex(r);
      pair.addEventListener('click', function () { selectPair(l, r); });
      var input = el('input');
      input.type = 'number';
      input.step = STEP;
      input.value = doc().kerning[key];
      input.addEventListener('change', function () {
        var v = Math.round(Number(input.value) || 0);
        doc().kerning[key] = Math.max(-KERN_LIM, Math.min(KERN_LIM, v));
        window.FontModel.save();
      });
      var del = el('button', 'btn sp-del', '×');
      del.title = 'Delete pair';
      del.addEventListener('click', function () {
        delete doc().kerning[key];
        if (sel && sel.l === l && sel.r === r) sel = null;
        window.FontModel.save();
      });
      row.appendChild(pair);
      row.appendChild(input);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  // ── advance widths ──────────────────────────────────────────────

  function renderAdvList() {
    var box = els.advList;
    box.textContent = '';
    var keys = Object.keys(doc().glyphs).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) {
      box.appendChild(el('div', 'muted sp-empty', 'No glyphs in font yet.'));
      return;
    }
    keys.forEach(function (cp) {
      var g = doc().glyphs[String(cp)];
      var row = el('div', 'sp-row');
      var lab = el('span', 'sp-pair', chr(cp));
      lab.title = hex(cp);
      var cpLab = el('span', 'muted sp-cp', hex(cp));
      var input = el('input');
      input.type = 'number';
      input.min = 0;
      input.step = STEP;
      input.value = g.adv;
      input.addEventListener('change', function () {
        var v = Math.round(Number(input.value) || 0);
        g.adv = Math.max(0, Math.min(32767, v));
        window.FontModel.save();
      });
      row.appendChild(lab);
      row.appendChild(cpLab);
      row.appendChild(input);
      box.appendChild(row);
    });
  }

  // ── batch accents ───────────────────────────────────────────────

  function accentStatus(combo) {
    var d = doc();
    if (d.glyphs[String(combo[0])]) return 'in font';
    if (d.glyphs[String(combo[1])] && d.glyphs[String(combo[2])]) return 'ready';
    return 'missing parts';
  }

  function renderAccents() {
    var box = els.accTable;
    box.textContent = '';
    var ready = 0;
    ACCENTS.forEach(function (combo) {
      var st = accentStatus(combo);
      if (st === 'ready') ready++;
      var row = el('div', 'sp-row sp-acc-row');
      row.appendChild(el('span', 'sp-acc-t', chr(combo[0])));
      row.appendChild(el('span', 'muted sp-acc-eq', '= ' + chr(combo[1]) + ' + ' + chr(combo[2])));
      row.appendChild(el('span', 'sp-acc-st ' + (st === 'ready' ? 'st-ready' : (st === 'in font' ? 'st-in' : 'st-no')), st));
      box.appendChild(row);
    });
    els.accBtn.disabled = ready === 0;
    els.accBtn.textContent = 'Generate missing (' + ready + ')';
  }

  function generateAccents() {
    var d = doc();
    var created = 0, skipped = 0;
    ACCENTS.forEach(function (combo) {
      var t = combo[0], b = combo[1], m = combo[2];
      if (d.glyphs[String(t)]) { skipped++; return; }
      var bg = d.glyphs[String(b)], mg = d.glyphs[String(m)];
      if (!bg || !mg) { skipped++; return; }
      var g = window.FontModel.ensureGlyph(t);
      g.mode = 'vector';
      g.contours = [];
      g.components = [
        { ref: b, dx: 0, dy: 0 },
        { ref: m, dx: Math.round((bg.adv - mg.adv) / 2), dy: 0 }
      ];
      g.adv = bg.adv;
      created++;
    });
    els.accReport.textContent = 'Created ' + created + ', skipped ' + skipped + '.';
    if (created) {
      window.FontModel.save();
      toast('Accents: created ' + created + ' glyph' + (created === 1 ? '' : 's'));
    } else {
      toast('No accents to create (skipped ' + skipped + ')', false);
    }
  }

  // ── build DOM ───────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('uispacing-style')) return;
    var st = document.createElement('style');
    st.id = 'uispacing-style';
    st.textContent = [
      '#tab-spacing .sp-canvas-wrap { overflow-x: auto; background: #080808; border: 1px solid var(--border); border-radius: 6px; margin-top: 10px; }',
      '#tab-spacing canvas { display: block; cursor: ew-resize; outline: none; }',
      '#tab-spacing .sp-hint { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-label); color: var(--text-muted); margin-top: 8px; }',
      '#tab-spacing .sp-selinfo { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-sm); color: var(--text-dim); min-width: 150px; }',
      '#tab-spacing .sp-cols { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }',
      '#tab-spacing .sp-cols > .panel { flex: 1 1 280px; min-width: 260px; }',
      '#tab-spacing .sp-list { display: flex; flex-direction: column; gap: 4px; max-height: 340px; overflow-y: auto; margin-top: 10px; }',
      '#tab-spacing .sp-row { display: flex; align-items: center; gap: 8px; font-family: "IBM Plex Mono", monospace; font-size: var(--fs-sm); padding: 2px 4px; border-radius: 4px; }',
      '#tab-spacing .sp-row.sel { background: rgba(234, 179, 8, .08); }',
      '#tab-spacing .sp-pair { flex: 1; cursor: pointer; }',
      '#tab-spacing .sp-cp { font-size: var(--fs-label); }',
      '#tab-spacing .sp-row input { width: 84px; padding: 4px 6px; }',
      '#tab-spacing .sp-del { padding: 3px 8px; }',
      '#tab-spacing .sp-empty { font-size: var(--fs-sm); padding: 4px; }',
      '#tab-spacing .sp-acc-row .sp-acc-t { width: 2em; }',
      '#tab-spacing .sp-acc-row .sp-acc-eq { flex: 1; }',
      '#tab-spacing .sp-acc-st { font-size: var(--fs-label); text-transform: uppercase; letter-spacing: .08em; }',
      '#tab-spacing .st-ready { color: var(--ok); }',
      '#tab-spacing .st-in { color: var(--text-muted); }',
      '#tab-spacing .st-no { color: var(--text-dim); }',
      '#tab-spacing .sp-acc-note { font-size: var(--fs-sm); color: var(--text-dim); margin: 8px 0 10px; }',
      '#tab-spacing .sp-acc-report { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-sm); color: var(--accent); margin-left: 10px; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function build(section) {
    var sample = el('div', 'panel');
    var row = el('div', 'row');

    var field = el('div', 'field');
    var lbl = el('label', null, 'Sample');
    var input = el('input');
    input.type = 'text';
    input.value = sampleText;
    input.size = 24;
    input.addEventListener('input', function () {
      sampleText = input.value;
      sel = null;
      drawSample();
      updateSelInfo();
      renderKernTable();
    });
    field.appendChild(lbl);
    field.appendChild(input);
    row.appendChild(field);

    els.selInfo = el('span', 'sp-selinfo', 'no pair selected');
    els.minus = el('button', 'btn', '− 10');
    els.plus = el('button', 'btn', '+ 10');
    els.minus.addEventListener('click', function () { nudge(-STEP); });
    els.plus.addEventListener('click', function () { nudge(STEP); });
    row.appendChild(els.selInfo);
    row.appendChild(els.minus);
    row.appendChild(els.plus);
    sample.appendChild(row);

    var wrap = el('div', 'sp-canvas-wrap');
    els.canvas = el('canvas');
    els.canvas.tabIndex = 0;
    els.canvas.addEventListener('mousedown', onDown);
    els.canvas.addEventListener('keydown', onKey);
    wrap.appendChild(els.canvas);
    sample.appendChild(wrap);
    sample.appendChild(el('div', 'sp-hint',
      'Click the gap between two glyphs, then drag horizontally or press ←/→ to kern in 10-unit steps. Delete removes the pair.'));
    section.appendChild(sample);

    var cols = el('div', 'sp-cols');

    var kernPanel = el('div', 'panel');
    kernPanel.appendChild(el('h3', null, 'Kerning pairs'));
    els.kernTable = el('div', 'sp-list');
    kernPanel.appendChild(els.kernTable);
    cols.appendChild(kernPanel);

    var advPanel = el('div', 'panel');
    advPanel.appendChild(el('h3', null, 'Advance widths'));
    els.advList = el('div', 'sp-list');
    advPanel.appendChild(els.advList);
    cols.appendChild(advPanel);

    var accPanel = el('div', 'panel');
    accPanel.appendChild(el('h3', null, 'Batch accents'));
    accPanel.appendChild(el('div', 'sp-acc-note',
      'Builds missing Latin-1 accented glyphs as components: base at 0,0 plus the mark centered over the base width. Needs both base letter and mark glyph in the font.'));
    var accRow = el('div', 'row');
    els.accBtn = el('button', 'btn primary', 'Generate missing');
    els.accBtn.addEventListener('click', generateAccents);
    els.accReport = el('span', 'sp-acc-report', '');
    accRow.appendChild(els.accBtn);
    accRow.appendChild(els.accReport);
    accPanel.appendChild(accRow);
    els.accTable = el('div', 'sp-list');
    accPanel.appendChild(els.accTable);
    cols.appendChild(accPanel);

    section.appendChild(cols);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function render() {
    drawSample();
    updateSelInfo();
    renderKernTable();
    renderAdvList();
    renderAccents();
  }

  window.UISpacing = {
    init: function () {
      var section = document.getElementById('tab-spacing');
      if (!section) return;
      injectStyles();
      build(section);
      window.FontModel.onChange(render);
      render();
    }
  };
})();
