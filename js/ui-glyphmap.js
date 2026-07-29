(function () {
  'use strict';

  var CANVAS_CSS = 28;
  var SCALE = 2;                 // fixed backing-store scale for crisp minis
  var MAX_DEPTH = 6;             // component recursion guard (cycles included)
  var FULL_RANGE_MAX = 640;      // render every cp of a set up to this span;
                                 // beyond it only glyphs present in the font

  var root = null;
  var setsGrid = null;           // the on/off chips panel
  var blocksHost = null;         // container for the per-set glyph grids
  var grids = {};                // set name -> { cells, counter, grid, extras, panel }
  var buildSig = '';             // sets+glyph-keys signature of current DOM
  var collapsed = {};            // set name -> block collapsed (UI-only state)

  var CSS =
    // inline fallback look for the actions row; once the navbar adopts it the
    // .cn-actions class + navbar CSS take over
    '.uigm-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }' +
    '#tab-glyphs > .uigm-actions { margin-bottom: 14px; }' +
    '#tab-glyphs.over { outline: 2px dashed var(--accent); outline-offset: -4px; }' +
    // sets as compact status cells — same shape as the hub navbar's
    // reachability ping grid (dot + mono label in a small bordered cell)
    '.uigm-sets-modal .uigm-sets { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 4px; }' +
    '.uigm-sets-modal .uigm-setcell { display: flex; align-items: center; gap: 6px; min-width: 0;' +
    ' border: 1px solid var(--border); border-radius: 3px; padding: 4px 7px;' +
    ' background: var(--panel2); cursor: pointer; user-select: none; transition: border-color .15s; }' +
    '.uigm-sets-modal .uigm-setcell:hover { border-color: var(--accent); }' +
    '.uigm-sets-modal .uigm-setcell .dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; background: #666; }' +
    '.uigm-sets-modal .uigm-setcell.on .dot { background: var(--accent); box-shadow: 0 0 4px var(--accent); }' +
    '.uigm-sets-modal .uigm-setcell .lbl { flex: 1 1 auto; min-width: 0; font-family: "IBM Plex Mono", monospace;' +
    ' font-size: var(--fs-micro); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '.uigm-sets-modal .uigm-setcell.on .lbl { color: var(--text); }' +
    '.uigm-sets-modal .uigm-setcell .cnt { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-micro); color: var(--text-muted); flex-shrink: 0; }' +
    '#tab-glyphs .uigm-block { margin-bottom: 14px; }' +
    '#tab-glyphs .uigm-head { display: flex; align-items: baseline; gap: 10px; cursor: pointer; user-select: none; }' +
    '#tab-glyphs .uigm-head h3 { font-family: "Red Hat Display", sans-serif; font-weight: 900; font-size: var(--fs-h3); margin: 0; }' +
    '#tab-glyphs .uigm-head .arrow { color: var(--text-muted); font-size: var(--fs-sm); }' +
    '#tab-glyphs .uigm-head .uigm-count { margin-left: auto; }' +
    '#tab-glyphs .uigm-block.open .uigm-head { margin-bottom: 10px; }' +
    '#tab-glyphs .uigm-count { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-label); color: var(--text-dim); }' +
    '#tab-glyphs .uigm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 3px; }' +
    '#tab-glyphs .uigm-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 2px 3px;' +
    ' background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; user-select: none; }' +
    '#tab-glyphs .uigm-cell:hover { border-color: var(--accent); }' +
    '#tab-glyphs .uigm-cell.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }' +
    '#tab-glyphs .uigm-cell canvas { width: ' + CANVAS_CSS + 'px; height: ' + CANVAS_CSS + 'px; display: block; }' +
    '#tab-glyphs .uigm-char { width: ' + CANVAS_CSS + 'px; height: ' + CANVAS_CSS + 'px; display: flex; align-items: center; justify-content: center;' +
    ' font-size: 20px; line-height: 1; color: var(--text-muted); }' +
    '#tab-glyphs .uigm-cp { font-family: "IBM Plex Mono", monospace; font-size: var(--fs-micro); color: var(--text-muted); }' +
    '#tab-glyphs .uigm-note { font-size: var(--fs-sm); color: var(--text-muted); margin-bottom: 8px; }' +
    '#tab-glyphs .uigm-hint { font-size: var(--fs-sm); color: var(--text-muted); }';

  function fmtCp(cp) {
    if (window.UI && UI.fmtCp) return UI.fmtCp(cp);
    return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  }
  function el(tag, attrs, children) { return window.UI.el(tag, attrs, children); }
  function toast(msg, ok) { window.UI.toast(msg, ok); }

  // ── glyph mini-rendering ──────────────────────────────────────

  function hasInk(g, doc, depth) {
    if (!g || depth > MAX_DEPTH) return false;
    if (g.mode === 'vector') {
      if (g.contours.length) return true;
    } else {
      for (var r = 0; r < g.px.length; r++) if (g.px[r].indexOf('1') !== -1) return true;
    }
    for (var i = 0; i < g.components.length; i++) {
      if (hasInk(doc.glyphs[String(g.components[i].ref)], doc, depth + 1)) return true;
    }
    return false;
  }

  // Traces glyph outline (own px/contours + flattened components) into ctx.
  // (dx,dy) in font units; X/Y map font units to canvas px.
  function trace(ctx, g, doc, dx, dy, X, Y, depth) {
    if (!g || depth > MAX_DEPTH) return;
    var i, j;
    if (g.mode === 'pixel') {
      var cell = doc.meta.upm / doc.grid.h;
      for (var row = 0; row < g.px.length; row++) {
        for (var col = 0; col < doc.grid.w; col++) {
          if (g.px[row].charAt(col) !== '1') continue;
          var ux = col * cell + dx;
          var uy = (doc.grid.baseline - row - 1) * cell + dy;
          ctx.rect(X(ux), Y(uy + cell), X(ux + cell) - X(ux), Y(uy) - Y(uy + cell));
        }
      }
    } else {
      for (i = 0; i < g.contours.length; i++) {
        var c = g.contours[i];
        if (c.length < 2) continue;
        ctx.moveTo(X(c[0].x + dx), Y(c[0].y + dy));
        for (j = 1; j <= c.length; j++) {
          var p = c[j % c.length];
          if (p.cx1 !== undefined) {
            ctx.bezierCurveTo(X(p.cx1 + dx), Y(p.cy1 + dy), X(p.cx2 + dx), Y(p.cy2 + dy), X(p.x + dx), Y(p.y + dy));
          } else {
            ctx.lineTo(X(p.x + dx), Y(p.y + dy));
          }
        }
        ctx.closePath();
      }
    }
    for (i = 0; i < g.components.length; i++) {
      var comp = g.components[i];
      trace(ctx, doc.glyphs[String(comp.ref)], doc, dx + comp.dx, dy + comp.dy, X, Y, depth + 1);
    }
  }

  function drawGlyph(canvas, g, doc) {
    var size = CANVAS_CSS * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    var asc = doc.meta.ascender, desc = doc.meta.descender;
    var span = asc - desc;
    if (span <= 0) { asc = doc.meta.upm; span = doc.meta.upm; }
    var s = size / span;
    var tx = (size - g.adv * s) / 2;
    var X = function (x) { return tx + x * s; };
    var Y = function (y) { return (asc - y) * s; };
    ctx.beginPath();
    trace(ctx, g, doc, 0, 0, X, Y, 0);
    ctx.fillStyle = '#eab308';
    ctx.fill('nonzero');
  }

  function makeCell(cp) {
    var canvas = document.createElement('canvas');
    canvas.width = CANVAS_CSS * SCALE;
    canvas.height = CANVAS_CSS * SCALE;
    var charEl = document.createElement('div');
    charEl.className = 'uigm-char';
    charEl.textContent = String.fromCodePoint(cp);
    var cpEl = document.createElement('div');
    cpEl.className = 'uigm-cp';
    cpEl.textContent = cp.toString(16).toUpperCase().padStart(4, '0');
    var cell = document.createElement('div');
    cell.className = 'uigm-cell';
    cell.title = fmtCp(cp);
    cell.appendChild(canvas);
    cell.appendChild(charEl);
    cell.appendChild(cpEl);
    cell.addEventListener('click', function () {
      if (window.UI && UI.selectGlyph) UI.selectGlyph(cp);
    });
    return { cp: cp, el: cell, canvas: canvas, charEl: charEl };
  }

  function updateCell(cell, doc) {
    var g = doc.glyphs[String(cell.cp)] || null;
    var ink = g && hasInk(g, doc, 0);
    if (ink) {
      cell.canvas.style.display = 'block';
      cell.charEl.style.display = 'none';
      drawGlyph(cell.canvas, g, doc);
    } else {
      cell.canvas.style.display = 'none';
      cell.charEl.style.display = 'flex';
    }
    var sel = window.UI && UI.selGlyph === cell.cp;
    cell.el.classList.toggle('sel', !!sel);
    return !!ink;
  }

  // ── sets bookkeeping ──────────────────────────────────────────

  function setRange(name) {
    var S = FontModel.SETS;
    for (var i = 0; i < S.length; i++) if (S[i][0] === name) return S[i];
    return null;
  }

  function glyphsBySet(doc) {
    var by = {};
    for (var k in doc.glyphs) {
      var name = FontModel.setOf(Number(k));
      (by[name] || (by[name] = [])).push(Number(k));
    }
    for (var n in by) by[n].sort(function (a, b) { return a - b; });
    return by;
  }

  function isEnabled(doc, name) {
    return doc.sets.indexOf(name) !== -1;
  }

  function toggleSet(name) {
    var doc = FontModel.doc;
    var i = doc.sets.indexOf(name);
    if (i === -1) doc.sets.push(name);
    else doc.sets.splice(i, 1);
    FontModel.save();
  }

  // ── load / create ─────────────────────────────────────────────

  function inflateZlib(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('no DecompressionStream'));
    }
    var s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function woffToSfnt(buf) {
    return Promise.resolve().then(function () {
      var dv = new DataView(buf);
      if (dv.getUint32(0) !== 0x774F4646) throw new Error('not a WOFF file');
      var flavor = dv.getUint32(4);
      var numTables = dv.getUint16(12);
      var entries = [];
      for (var i = 0; i < numTables; i++) {
        var o = 44 + i * 20;
        entries.push({
          tag: dv.getUint32(o),
          offset: dv.getUint32(o + 4),
          compLen: dv.getUint32(o + 8),
          origLen: dv.getUint32(o + 12),
          checksum: dv.getUint32(o + 16)
        });
      }
      return Promise.all(entries.map(function (e) {
        var raw = new Uint8Array(buf, e.offset, e.compLen);
        if (e.compLen >= e.origLen) return Promise.resolve(raw);
        return inflateZlib(raw);
      })).then(function (datas) {
        var pad = function (n) { return (n + 3) & ~3; };
        var total = 12 + numTables * 16;
        for (var i = 0; i < datas.length; i++) total += pad(entries[i].origLen);
        var out = new Uint8Array(total);
        var odv = new DataView(out.buffer);
        odv.setUint32(0, flavor);
        odv.setUint16(4, numTables);
        var pow = 1, sel = 0;
        while (pow * 2 <= numTables) { pow *= 2; sel++; }
        odv.setUint16(6, pow * 16);
        odv.setUint16(8, sel);
        odv.setUint16(10, numTables * 16 - pow * 16);
        var off = 12 + numTables * 16;
        for (var t = 0; t < numTables; t++) {
          var d = 12 + t * 16;
          odv.setUint32(d, entries[t].tag);
          odv.setUint32(d + 4, entries[t].checksum);
          odv.setUint32(d + 8, off);
          odv.setUint32(d + 12, entries[t].origLen);
          out.set(datas[t], off);
          off += pad(entries[t].origLen);
        }
        return out.buffer;
      });
    });
  }

  // Imported fonts open with every set they cover enabled — "show all of
  // them, let you turn them off". A .cfont project keeps its own saved sets.
  function enableCoveredSets(doc) {
    var by = glyphsBySet(doc);
    var sets = [];
    var S = FontModel.SETS;
    for (var i = 0; i < S.length; i++) if (by[S[i][0]]) sets.push(S[i][0]);
    if (by.Other) sets.push('Other');
    if (sets.length) doc.sets = sets;
    return doc;
  }

  function loadFile(file) {
    if (!file) return;
    var name = (file.name || '').toLowerCase();
    // needGlyphs: a font/sfd import with zero glyphs means the parse found
    // nothing usable; a .cfont project may legitimately be empty.
    var done = function (doc, needGlyphs, cover) {
      if (!doc || (needGlyphs && !Object.keys(doc.glyphs || {}).length)) {
        toast('Could not read ' + file.name, false);
        return; // keep the current project (and its undo history) intact
      }
      if (cover) enableCoveredSets(doc);
      FontModel.load(doc);
      toast('Loaded ' + file.name, true);
    };
    var p;
    if (/\.(ttf|otf)$/.test(name)) {
      p = file.arrayBuffer().then(function (buf) {
        done(FontImport.fromBinary(buf), true, true);
      });
    } else if (/\.woff$/.test(name)) {
      p = file.arrayBuffer().then(woffToSfnt).then(function (sfnt) {
        done(FontImport.fromBinary(sfnt), true, true);
      });
    } else if (/\.sfd$/.test(name)) {
      p = file.text().then(function (txt) {
        done(FontImport.fromSFD(txt), true, true);
      });
    } else {
      p = file.text().then(function (txt) {
        done(FontImport.fromCfont(txt), false, false);
      });
    }
    p.catch(function () { toast('Could not read ' + file.name, false); });
  }

  function createNew() {
    var d = FontModel.doc;
    var dirty = Object.keys(d.glyphs).length > 0;
    if (dirty && !window.confirm('Start a new font? The current project is replaced (it stays in your undo history until then).')) return;
    if (window.UI) UI.selGlyph = null;
    FontModel.load(FontModel.newProject());
    toast('New font started — default sets enabled', true);
  }

  // ── rendering ─────────────────────────────────────────────────

  function renderSets(doc, by) {
    setsGrid.textContent = '';
    // the popup's whole point: EVERY set is on screen at once
    var addCell = function (name, count) {
      var on = isEnabled(doc, name);
      var cell = el('span', { class: 'uigm-setcell' + (on ? ' on' : ''), title: name + (on ? ' — on: visible, editable, exported' : ' — off: hidden and excluded from export') }, [
        el('span', { class: 'dot' }),
        el('span', { class: 'lbl' }, name),
        count ? el('span', { class: 'cnt' }, String(count)) : null
      ]);
      cell.addEventListener('click', function () { toggleSet(name); });
      setsGrid.appendChild(cell);
    };
    var names = FontModel.SETS.map(function (s) { return s[0]; }).concat(['Other']);
    for (var i = 0; i < names.length; i++) {
      addCell(names[i], by[names[i]] ? by[names[i]].length : 0);
    }
  }

  function applyCollapse(name) {
    var g = grids[name];
    if (!g) return;
    var off = !!collapsed[name];
    g.panel.classList.toggle('open', !off);
    g.grid.style.display = off ? 'none' : '';
    for (var i = 0; i < g.extras.length; i++) g.extras[i].style.display = off ? 'none' : '';
    g.arrow.textContent = off ? '▸' : '▾';
  }

  function renderBlocks(doc, by) {
    blocksHost.textContent = '';
    grids = {};
    for (var s = 0; s < doc.sets.length; s++) {
      var name = doc.sets[s];
      var range = setRange(name);
      var cps = [];
      var partial = false;
      if (name === 'Other') {
        cps = by.Other || [];
      } else if (range) {
        var span = range[2] - range[1] + 1;
        if (span <= FULL_RANGE_MAX) {
          for (var cp = range[1]; cp <= range[2]; cp++) cps.push(cp);
        } else {
          cps = by[name] || [];
          partial = true;
        }
      }
      var arrow = el('span', { class: 'arrow' }, '▾');
      var counter = el('span', { class: 'uigm-count' });
      var head = el('div', { class: 'uigm-head' }, [arrow, el('h3', {}, name), counter]);
      var grid = el('div', { class: 'uigm-grid' });
      var panel = el('div', { class: 'panel uigm-block open' }, [head]);
      var extras = [];
      if (partial) {
        var note = el('div', { class: 'uigm-note' },
          'Large set — showing only the glyphs present in the font.');
        extras.push(note);
        panel.appendChild(note);
      }
      if (!cps.length) {
        var hint = el('div', { class: 'uigm-hint' },
          name === 'Other' ? 'No glyphs outside the named sets.' : 'Empty set.');
        extras.push(hint);
        panel.appendChild(hint);
      }
      var cells = [];
      for (var i = 0; i < cps.length; i++) {
        var cell = makeCell(cps[i]);
        cells.push(cell);
        grid.appendChild(cell.el);
      }
      panel.appendChild(grid);
      blocksHost.appendChild(panel);
      grids[name] = { cells: cells, counter: counter, total: cps.length, grid: grid, extras: extras, panel: panel, arrow: arrow };
      (function (n) {
        head.addEventListener('click', function () {
          collapsed[n] = !collapsed[n];
          applyCollapse(n);
        });
      })(name);
      applyCollapse(name);
    }
    if (!doc.sets.length) {
      blocksHost.appendChild(el('div', { class: 'panel uigm-hint' },
        'No sets enabled — open Sets in the top bar and turn one on to see and edit its glyphs.'));
    }
  }

  // Sets live in a popup; setsGrid is non-null only while it's open.
  function openSetsModal() {
    var m = UI.modal('Sets', function () { setsGrid = null; });
    m.body.classList.add('uigm-sets-modal');
    m.body.appendChild(el('div', { class: 'uigm-hint' },
      'On = visible, editable and exported. Off = kept in the project but hidden and left out of the font file.'));
    setsGrid = el('div', { class: 'uigm-sets' });
    m.body.appendChild(setsGrid);
    renderSets(FontModel.doc, glyphsBySet(FontModel.doc));
  }

  function render() {
    if (!root) return;
    var doc = FontModel.doc;
    var by = glyphsBySet(doc);
    if (setsGrid) renderSets(doc, by);
    var sig = doc.sets.join('|') + '#' + Object.keys(doc.glyphs).sort().join(',');
    if (sig !== buildSig) {
      buildSig = sig;
      renderBlocks(doc, by);
    }
    for (var name in grids) {
      var g = grids[name];
      var made = 0;
      for (var i = 0; i < g.cells.length; i++) {
        if (updateCell(g.cells[i], doc)) made++;
      }
      g.counter.textContent = made + ' / ' + g.total;
    }
  }

  // ── boot ──────────────────────────────────────────────────────

  var UIGlyphMap = {
    init: function () {
      root = document.getElementById('tab-glyphs');
      if (!root) return;
      var style = document.createElement('style');
      style.id = 'uigm-style';
      style.textContent = CSS;
      document.head.appendChild(style);
      root.textContent = '';

      var input = el('input', { type: 'file', accept: '.cfont,.json,.ttf,.otf,.woff,.sfd', style: 'display:none' });
      input.addEventListener('change', function () {
        loadFile(input.files[0]);
        input.value = '';
      });
      // Default is a new font — no Create call-to-action needed; New is the
      // quiet reset, and Load sits with the other actions.
      var newBtn = el('button', { class: 'btn' }, 'New');
      newBtn.title = 'Start over with a fresh font (default sets)';
      newBtn.addEventListener('click', createNew);
      var loadBtn = el('button', { class: 'btn' }, 'Load font…');
      loadBtn.title = 'Open a .cfont project, or import a TTF/OTF/WOFF/FontForge .sfd as editable glyphs (or drop a file on the page)';
      loadBtn.addEventListener('click', function () { input.click(); });
      var setsBtn = el('button', { class: 'btn' }, 'Sets');
      setsBtn.title = 'Toggle unicode sets on/off — on = visible, editable and exported';
      setsBtn.addEventListener('click', openSetsModal);
      var spacingBtn = el('button', { class: 'btn' }, 'Spacing');
      spacingBtn.title = 'Kerning pairs and the live sample line';
      spacingBtn.addEventListener('click', function () { UI.switchTab('spacing'); });
      var previewBtn = el('button', { class: 'btn' }, 'Preview');
      previewBtn.addEventListener('click', function () { window.UIPreview.open(); });
      var exportBtn = el('button', { class: 'btn primary' }, 'Export');
      exportBtn.addEventListener('click', function () { window.UIExport.open(); });

      // The app's actions live in the shared navbar (single top bar): the
      // navbar adopts [data-carino-actions] when it injects; since this box is
      // built after that, portal it in ourselves — the real nodes move, so
      // handlers survive. Falls back to an inline row if the navbar never lands.
      var actionsBox = el('div', { class: 'uigm-actions', 'data-carino-actions': '' }, [
        newBtn, loadBtn, setsBtn, spacingBtn, previewBtn, exportBtn, input
      ]);
      root.appendChild(actionsBox);
      (function portal(tries) {
        if (actionsBox.closest('#carinoNav')) return;   // already adopted
        var right = document.querySelector('#carinoNav .cn-right');
        if (right) {
          actionsBox.classList.add('cn-actions');
          right.insertBefore(actionsBox, right.querySelector('.social-row'));
          return;
        }
        if (tries > 0) requestAnimationFrame(function () { portal(tries - 1); });
      })(60);

      // whole-page drop target for font files
      root.addEventListener('dragover', function (e) { e.preventDefault(); root.classList.add('over'); });
      root.addEventListener('dragleave', function (e) { if (e.target === root) root.classList.remove('over'); });
      root.addEventListener('drop', function (e) {
        e.preventDefault();
        root.classList.remove('over');
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
      });

      blocksHost = el('div', {});
      root.appendChild(blocksHost);

      FontModel.onChange(render);
      render();
    },
    render: render
  };

  window.UIGlyphMap = UIGlyphMap;
})();
