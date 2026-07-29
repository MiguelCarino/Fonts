(function () {
  'use strict';

  var SNAP = 10;
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ── state ──────────────────────────────────────────────────────
  var root = null, wrap = null, svg = null, statusEl = null, emptyEl = null;
  var sceneG = null; // camera-transformed group
  var L = {};        // layers: grid guides onion comp shape draw markers handles screen
  var sideEls = {};  // sidebar element refs
  var toolbarEls = {};
  var pathEls = { fill: null, strokes: [], strokeCis: [] };
  var markerRefs = []; // markerRefs[ci][pi] -> element

  var cam = { tx: 60, ty: 420, z: 0.45 };
  var needFit = true;
  var tool = 'pen';
  var snapOn = false;
  var sel = null;      // {ci, pi}
  var pen = null;      // {cp, ci, pendingOut, firstIn}
  var gesture = null;
  var spaceDown = false;
  var onionCp = null;
  var lastCp = null;
  var raf = 0;

  // ── small helpers ──────────────────────────────────────────────
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function sv(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmt(n) { return Math.round(n * 100) / 100; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function hasH(p) { return p.cx1 !== undefined; }
  function setH(p, x1, y1, x2, y2) { p.cx1 = x1; p.cy1 = y1; p.cx2 = x2; p.cy2 = y2; }
  function clearH(p) { delete p.cx1; delete p.cy1; delete p.cx2; delete p.cy2; }
  function snapv(v) { return snapOn ? Math.round(v / SNAP) * SNAP : v; }
  function near(ax, ay, bx, by) { return Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01; }

  function curGlyph() {
    var cp = window.UI ? UI.selGlyph : null;
    if (cp === null || cp === undefined) return null;
    return FontModel.getGlyph(cp);
  }
  function isVisible() { return !!root && root.offsetParent !== null; }
  function typing() {
    var a = document.activeElement;
    return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }

  // ── camera ─────────────────────────────────────────────────────
  function toFont(e) {
    var r = svg.getBoundingClientRect();
    var sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - cam.tx) / cam.z, y: (cam.ty - sy) / cam.z, sx: sx, sy: sy };
  }
  function toScreen(fx, fy) {
    return { x: cam.tx + fx * cam.z, y: cam.ty - fy * cam.z };
  }
  function applyCam() {
    sceneG.setAttribute('transform',
      'translate(' + fmt(cam.tx) + ',' + fmt(cam.ty) + ') scale(' + cam.z + ',' + (-cam.z) + ')');
  }
  function fit() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    var m = FontModel.doc.meta;
    var g = curGlyph();
    var adv = g ? g.adv : m.upm * 0.5;
    var x0 = -80, x1 = Math.max(adv, m.upm * 0.4) + 80;
    var y0 = Math.min(m.descender, -50) - 80, y1 = Math.max(m.ascender, 100) + 80;
    var z = Math.min(w / (x1 - x0), h / (y1 - y0));
    cam.z = clamp(z, 0.02, 20);
    cam.tx = -x0 * cam.z + (w - (x1 - x0) * cam.z) / 2;
    cam.ty = y1 * cam.z + (h - (y1 - y0) * cam.z) / 2;
  }
  function scheduleScene() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; renderScene(); });
  }

  // ── geometry ───────────────────────────────────────────────────
  function cubicAt(p0, c1x, c1y, c2x, c2y, p3, t) {
    var u = 1 - t;
    var a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return {
      x: a * p0.x + b * c1x + c * c2x + d * p3.x,
      y: a * p0.y + b * c1y + c * c2y + d * p3.y
    };
  }
  function segPoint(pts, s, t) {
    var n = pts.length;
    var p0 = pts[s], p3 = pts[(s + 1) % n];
    if (hasH(p3)) return cubicAt(p0, p3.cx1, p3.cy1, p3.cx2, p3.cy2, p3, t);
    return { x: p0.x + (p3.x - p0.x) * t, y: p0.y + (p3.y - p0.y) * t };
  }

  // de Casteljau split of segment s at t; inserts the new anchor into pts
  function splitSegment(pts, s, t) {
    var n = pts.length;
    var j = (s + 1) % n;
    var p0 = pts[s], p3 = pts[j];
    var np;
    if (hasH(p3)) {
      var ax = p0.x + (p3.cx1 - p0.x) * t, ay = p0.y + (p3.cy1 - p0.y) * t;
      var bx = p3.cx1 + (p3.cx2 - p3.cx1) * t, by = p3.cy1 + (p3.cy2 - p3.cy1) * t;
      var cx = p3.cx2 + (p3.x - p3.cx2) * t, cy = p3.cy2 + (p3.y - p3.cy2) * t;
      var dx = ax + (bx - ax) * t, dy = ay + (by - ay) * t;
      var ex = bx + (cx - bx) * t, ey = by + (cy - by) * t;
      var fx = dx + (ex - dx) * t, fy = dy + (ey - dy) * t;
      np = { x: fx, y: fy, cx1: ax, cy1: ay, cx2: dx, cy2: dy };
      p3.cx1 = ex; p3.cy1 = ey; p3.cx2 = cx; p3.cy2 = cy;
    } else {
      np = { x: p0.x + (p3.x - p0.x) * t, y: p0.y + (p3.y - p0.y) * t };
    }
    var at = (s === n - 1) ? n : s + 1;
    pts.splice(at, 0, np);
    return at;
  }

  function nearestSegment(contours, p, maxFontDist) {
    var best = null;
    for (var ci = 0; ci < contours.length; ci++) {
      var pts = contours[ci];
      if (pts.length < 2) continue;
      for (var s = 0; s < pts.length; s++) {
        for (var k = 0; k <= 24; k++) {
          var t = k / 24;
          var q = segPoint(pts, s, t);
          var d = dist(q.x, q.y, p.x, p.y);
          if (!best || d < best.d) best = { ci: ci, s: s, t: t, d: d };
        }
      }
    }
    if (!best || best.d > maxFontDist) return null;
    // refine around the coarse hit
    var pts2 = contours[best.ci];
    var t0 = Math.max(0, best.t - 1 / 24), t1 = Math.min(1, best.t + 1 / 24);
    for (var k2 = 0; k2 <= 20; k2++) {
      var tt = t0 + (t1 - t0) * k2 / 20;
      var q2 = segPoint(pts2, best.s, tt);
      var d2 = dist(q2.x, q2.y, p.x, p.y);
      if (d2 < best.d) { best.d = d2; best.t = tt; }
    }
    best.t = clamp(best.t, 0.02, 0.98);
    return best;
  }

  // ── path building ──────────────────────────────────────────────
  function contourD(pts, close) {
    var d = 'M' + fmt(pts[0].x) + ' ' + fmt(pts[0].y);
    for (var j = 1; j < pts.length; j++) {
      var p = pts[j];
      d += hasH(p)
        ? 'C' + fmt(p.cx1) + ' ' + fmt(p.cy1) + ' ' + fmt(p.cx2) + ' ' + fmt(p.cy2) + ' ' + fmt(p.x) + ' ' + fmt(p.y)
        : 'L' + fmt(p.x) + ' ' + fmt(p.y);
    }
    if (close) {
      var f = pts[0];
      if (hasH(f)) d += 'C' + fmt(f.cx1) + ' ' + fmt(f.cy1) + ' ' + fmt(f.cx2) + ' ' + fmt(f.cy2) + ' ' + fmt(f.x) + ' ' + fmt(f.y);
      d += 'Z';
    }
    return d;
  }
  function allClosedD(contours, skipCi) {
    var d = '';
    for (var ci = 0; ci < contours.length; ci++) {
      if (ci === skipCi || contours[ci].length < 2) continue;
      d += contourD(contours[ci], true);
    }
    return d;
  }

  // resolved outline of a glyph incl. components, translated by (dx,dy)
  function resolvedContours(cp, dx, dy, depth, seen) {
    var out = [];
    if (depth > 6 || seen[cp]) return out;
    seen[cp] = true;
    var g = FontModel.getGlyph(cp);
    if (!g) { delete seen[cp]; return out; }
    var base = [];
    if (g.mode === 'vector') base = g.contours || [];
    else if (window.FontBuild && FontBuild.pixelToContours) {
      try { base = FontBuild.pixelToContours(g, FontModel.doc) || []; } catch (e) { base = []; }
    }
    for (var ci = 0; ci < base.length; ci++) {
      var pts = base[ci], np = [];
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j], q = { x: p.x + dx, y: p.y + dy };
        if (hasH(p)) setH(q, p.cx1 + dx, p.cy1 + dy, p.cx2 + dx, p.cy2 + dy);
        np.push(q);
      }
      if (np.length >= 2) out.push(np);
    }
    var comps = g.components || [];
    for (var k = 0; k < comps.length; k++) {
      var sub = resolvedContours(comps[k].ref, dx + comps[k].dx, dy + comps[k].dy, depth + 1, seen);
      for (var m = 0; m < sub.length; m++) out.push(sub[m]);
    }
    delete seen[cp];
    return out;
  }

  // ── DOM build ──────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('uivector-style')) return;
    var s = document.createElement('style');
    s.id = 'uivector-style';
    s.textContent =
      '.uiv-main{display:flex;gap:14px;flex:1;min-height:0}' +
      '.uiv-canvas-wrap{flex:1;position:relative;min-height:380px;background:#080808;' +
      'border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}' +
      '.uiv-canvas-wrap svg{display:block;width:100%;height:100%}' +
      '.uiv-svg.tool-pen{cursor:crosshair}.uiv-svg.tool-select{cursor:default}' +
      '.uiv-svg.panning{cursor:grabbing}.uiv-svg.pannable{cursor:grab}' +
      '.uiv-status{position:absolute;left:8px;bottom:6px;font-family:"IBM Plex Mono",monospace;' +
      'font-size:var(--fs-micro);color:var(--text-muted);pointer-events:none}' +
      '.uiv-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'color:var(--text-muted);font-size:var(--fs-sm);pointer-events:none}' +
      '.uiv-side{width:272px;flex-shrink:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px}' +
      '.uiv-side .panel{padding:12px 14px}' +
      '.uiv-ptitle{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-label);font-weight:700;' +
      'text-transform:uppercase;letter-spacing:.1em;color:var(--text-dim);margin-bottom:10px}' +
      '.uiv-comp-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}' +
      '.uiv-comp-row .mono{flex:1;font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.uiv-comp-row input[type=number]{width:58px;padding:4px 6px;font-size:var(--fs-sm)}' +
      '.uiv-x{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:var(--fs-sec);padding:0 4px}' +
      '.uiv-x:hover{color:var(--err)}' +
      '.uiv-addrow{display:flex;gap:6px;margin-top:8px}' +
      '.uiv-addrow input{flex:1;min-width:0;padding:6px 8px;font-size:var(--fs-sm)}' +
      '.uiv-addrow .btn{padding:6px 10px}' +
      '.uiv-hint{font-size:var(--fs-micro);color:var(--text-muted);font-family:"IBM Plex Mono",monospace;line-height:1.6}' +
      '.uiv-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}' +
      '.uiv-toolbar .uiv-glyphlbl{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-sm);color:var(--accent);margin-right:6px}' +
      '.uiv-side textarea{width:100%;min-height:64px;font-size:var(--fs-sm)}' +
      '.uiv-scalerow{display:flex;align-items:center;gap:6px;margin-top:8px}' +
      '.uiv-scalerow input{width:70px;padding:4px 6px;font-size:var(--fs-sm)}' +
      '.uiv-scalerow label{font-size:var(--fs-micro);color:var(--text-dim);font-family:"IBM Plex Mono",monospace}';
    document.head.appendChild(s);
  }

  function build() {
    root = document.getElementById('editor-vector');
    if (!root) return;
    clearNode(root);

    var bar = el('div', 'panel uiv-toolbar');
    toolbarEls.glyph = el('span', 'uiv-glyphlbl', '');
    toolbarEls.pen = el('button', 'btn', 'Pen');
    toolbarEls.select = el('button', 'btn', 'Select');
    toolbarEls.snap = el('button', 'btn', 'Snap ' + SNAP);
    toolbarEls.fitBtn = el('button', 'btn', 'Fit');
    toolbarEls.clearBtn = el('button', 'btn', 'Clear');
    toolbarEls.clearBtn.title = 'Delete every contour of this glyph (undoable; components stay)';
    toolbarEls.pen.addEventListener('click', function () { setTool('pen'); });
    toolbarEls.select.addEventListener('click', function () { setTool('select'); });
    toolbarEls.snap.addEventListener('click', function () { snapOn = !snapOn; renderScene(); updateToolbar(); });
    toolbarEls.fitBtn.addEventListener('click', function () { fit(); renderScene(); });
    toolbarEls.clearBtn.addEventListener('click', function () {
      var g = curGlyph();
      if (!g) { toast('Select a glyph first', false); return; }
      if (!g.contours.length) return;
      finalizePen(false);
      g.contours = [];
      FontModel.save();
    });
    var hint = el('span', 'uiv-hint',
      'pen: click=corner · drag=smooth · click 1st pt=close · esc=stop | select: dblclick seg=insert · dblclick pt=corner/smooth · del=remove | space/mid-drag=pan · wheel=zoom');
    bar.appendChild(toolbarEls.glyph);
    bar.appendChild(toolbarEls.pen);
    bar.appendChild(toolbarEls.select);
    bar.appendChild(toolbarEls.snap);
    bar.appendChild(toolbarEls.fitBtn);
    bar.appendChild(toolbarEls.clearBtn);
    bar.appendChild(hint);

    var main = el('div', 'uiv-main');
    wrap = el('div', 'uiv-canvas-wrap');
    svg = sv('svg', { 'class': 'uiv-svg tool-pen' });
    sceneG = sv('g', {});
    var order = ['bg', 'grid', 'guides', 'onion', 'comp', 'shape', 'draw', 'markers', 'handles'];
    for (var i = 0; i < order.length; i++) {
      L[order[i]] = sv('g', {});
      sceneG.appendChild(L[order[i]]);
    }
    L.screen = sv('g', {});
    svg.appendChild(sceneG);
    svg.appendChild(L.screen);
    statusEl = el('div', 'uiv-status', '');
    emptyEl = el('div', 'uiv-empty', 'No glyph selected — pick one in the Glyphs tab.');
    wrap.appendChild(svg);
    wrap.appendChild(statusEl);
    wrap.appendChild(emptyEl);

    var side = el('div', 'uiv-side');
    side.appendChild(buildComponentsPanel());
    side.appendChild(buildSvgPastePanel());
    side.appendChild(buildOnionPanel());
    side.appendChild(buildBgPanel());

    main.appendChild(wrap);
    main.appendChild(side);
    root.appendChild(bar);
    root.appendChild(main);

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('dblclick', onDbl);
    svg.addEventListener('wheel', onWheel, { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { scheduleScene(); }).observe(wrap);
    }
  }

  function buildComponentsPanel() {
    var p = el('div', 'panel');
    p.appendChild(el('div', 'uiv-ptitle', 'Components'));
    sideEls.compList = el('div');
    p.appendChild(sideEls.compList);
    var addRow = el('div', 'uiv-addrow');
    sideEls.compInput = el('input');
    sideEls.compInput.type = 'text';
    sideEls.compInput.placeholder = 'A / U+0041 / 65';
    var addBtn = el('button', 'btn', 'Add');
    addBtn.addEventListener('click', addComponent);
    sideEls.compInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') addComponent(); });
    addRow.appendChild(sideEls.compInput);
    addRow.appendChild(addBtn);
    p.appendChild(addRow);
    return p;
  }

  function buildSvgPastePanel() {
    var p = el('div', 'panel');
    p.appendChild(el('div', 'uiv-ptitle', 'Paste SVG path'));
    sideEls.svgD = el('textarea');
    sideEls.svgD.placeholder = 'M0 0 L500 0 ... Z';
    p.appendChild(sideEls.svgD);
    var row = el('div', 'uiv-scalerow');
    var lbl = el('label', null, 'scale');
    sideEls.svgScale = el('input');
    sideEls.svgScale.type = 'number';
    sideEls.svgScale.step = 'any';
    sideEls.svgScale.value = '1';
    var btn = el('button', 'btn', 'Add contours');
    btn.addEventListener('click', pasteSvgPath);
    row.appendChild(lbl);
    row.appendChild(sideEls.svgScale);
    row.appendChild(btn);
    p.appendChild(row);
    p.appendChild(el('div', 'uiv-hint', 'y is flipped to font coords (baseline up).'));
    return p;
  }

  // ── reference background image (session-only, never in the font) ──
  var bgUrl = null;
  var bgOpacity = 0.4;
  var bgImageEl = null;   // persistent <image> inside a scale(1,-1) group
  var bgMove = false;     // drag-the-image mode (suspends drawing tools)
  var bgScale = 1;        // relative to viewport-cover size
  var bgBaseW = 0, bgBaseH = 0;   // cover-fit size in font units at load time
  var bgX = 0, bgTop = 0;         // top-left corner in font units (y-up)
  var bgMoveBtn = null;

  // Size + position the image to cover everything currently on screen.
  function placeBgCover(natW, natH) {
    var w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
    var worldW = w / cam.z, worldH = h / cam.z;
    var left = -cam.tx / cam.z, top = cam.ty / cam.z;
    var s = Math.max(worldW / natW, worldH / natH);
    bgBaseW = natW * s;
    bgBaseH = natH * s;
    bgScale = 1;
    bgX = left + (worldW - bgBaseW) / 2;
    bgTop = top - (worldH - bgBaseH) / 2;
  }

  function applyBg() {
    if (!L.bg) return;
    if (!bgUrl) {
      clearNode(L.bg);
      bgImageEl = null;
      return;
    }
    if (!bgImageEl) {
      // the scene group is y-flipped (font coords); un-flip just the image
      var flip = sv('g', { transform: 'scale(1,-1)' });
      bgImageEl = sv('image', { preserveAspectRatio: 'xMinYMin meet' });
      flip.appendChild(bgImageEl);
      clearNode(L.bg);
      L.bg.appendChild(flip);
    }
    bgImageEl.setAttribute('href', bgUrl);
    bgImageEl.setAttribute('x', fmt(bgX));
    bgImageEl.setAttribute('y', fmt(-bgTop));
    bgImageEl.setAttribute('width', fmt(bgBaseW * bgScale));
    bgImageEl.setAttribute('height', fmt(bgBaseH * bgScale));
    bgImageEl.setAttribute('opacity', String(bgOpacity));
  }

  function buildBgPanel() {
    var p = el('div', 'panel');
    p.appendChild(el('div', 'uiv-ptitle', 'Background image'));
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      if (input.files[0]) {
        if (bgUrl) URL.revokeObjectURL(bgUrl);
        var url = URL.createObjectURL(input.files[0]);
        var probe = new Image();
        probe.onload = function () {
          bgUrl = url;
          placeBgCover(probe.naturalWidth || 1, probe.naturalHeight || 1);
          applyBg();
          renderScene();
        };
        probe.onerror = function () { toast('Could not load image', false); };
        probe.src = url;
      }
      input.value = '';
    });
    var row = el('div', 'uiv-addrow');
    var load = el('button', 'btn', 'Load…');
    load.addEventListener('click', function () { input.click(); });
    var remove = el('button', 'btn', 'Remove');
    remove.addEventListener('click', function () {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = null;
      bgMove = false;
      if (bgMoveBtn) bgMoveBtn.classList.remove('active');
      applyBg();
    });
    bgMoveBtn = el('button', 'btn', 'Move');
    bgMoveBtn.title = 'Drag the image instead of drawing';
    bgMoveBtn.addEventListener('click', function () {
      bgMove = !bgMove;
      bgMoveBtn.classList.toggle('active', bgMove);
    });
    row.appendChild(load);
    row.appendChild(remove);
    row.appendChild(bgMoveBtn);
    row.appendChild(input);
    p.appendChild(row);
    var srow = el('div', 'uiv-scalerow');
    var slbl = el('label', null, 'Opacity');
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(bgOpacity * 100));
    slider.style.flex = '1';
    slider.style.width = 'auto';
    slider.addEventListener('input', function () {
      bgOpacity = (parseInt(slider.value, 10) || 0) / 100;
      if (bgImageEl) bgImageEl.setAttribute('opacity', String(bgOpacity));
    });
    srow.appendChild(slbl);
    srow.appendChild(slider);
    p.appendChild(srow);
    var zrow = el('div', 'uiv-scalerow');
    var zlbl = el('label', null, 'Scale');
    var zslider = document.createElement('input');
    zslider.type = 'range';
    zslider.min = '10';
    zslider.max = '400';
    zslider.value = '100';
    zslider.style.flex = '1';
    zslider.style.width = 'auto';
    zslider.addEventListener('input', function () {
      // rescale around the image centre so it doesn't drift away
      var ns = (parseInt(zslider.value, 10) || 100) / 100;
      var cx = bgX + (bgBaseW * bgScale) / 2;
      var cy = bgTop - (bgBaseH * bgScale) / 2;
      bgScale = ns;
      bgX = cx - (bgBaseW * bgScale) / 2;
      bgTop = cy + (bgBaseH * bgScale) / 2;
      applyBg();
    });
    zrow.appendChild(zlbl);
    zrow.appendChild(zslider);
    p.appendChild(zrow);
    p.appendChild(el('div', 'uiv-hint', 'Loads covering the whole view; toggle Move and drag it into place. Session-only tracing aid — never exported.'));
    return p;
  }

  function buildOnionPanel() {
    var p = el('div', 'panel');
    p.appendChild(el('div', 'uiv-ptitle', 'Onion skin'));
    sideEls.onionSel = el('select');
    sideEls.onionSel.style.width = '100%';
    sideEls.onionSel.addEventListener('change', function () {
      var v = sideEls.onionSel.value;
      onionCp = v === '' ? null : parseInt(v, 10);
      renderScene();
    });
    p.appendChild(sideEls.onionSel);
    return p;
  }

  // ── sidebar render ─────────────────────────────────────────────
  function fmtCp(cp) {
    return window.UI && UI.fmtCp ? UI.fmtCp(cp)
      : 'U+' + cp.toString(16).toUpperCase();
  }
  function toast(msg, ok) {
    if (window.UI && UI.toast) UI.toast(msg, ok !== false);
  }

  function renderPanels() {
    var g = curGlyph();
    toolbarEls.glyph.textContent = (window.UI && UI.selGlyph !== null && UI.selGlyph !== undefined)
      ? fmtCp(UI.selGlyph) : '—';
    updateToolbar();

    clearNode(sideEls.compList);
    var comps = (g && g.components) || [];
    if (!comps.length) {
      sideEls.compList.appendChild(el('div', 'uiv-hint', 'No references.'));
    }
    comps.forEach(function (c, idx) {
      var row = el('div', 'uiv-comp-row');
      row.appendChild(el('span', 'mono', fmtCp(c.ref)));
      var dx = el('input'); dx.type = 'number'; dx.value = c.dx; dx.title = 'dx';
      var dy = el('input'); dy.type = 'number'; dy.value = c.dy; dy.title = 'dy';
      dx.addEventListener('change', function () {
        c.dx = Math.round(Number(dx.value) || 0); FontModel.save();
      });
      dy.addEventListener('change', function () {
        c.dy = Math.round(Number(dy.value) || 0); FontModel.save();
      });
      var x = el('button', 'uiv-x', '×');
      x.title = 'Remove reference';
      x.addEventListener('click', function () {
        g.components.splice(idx, 1); FontModel.save();
      });
      row.appendChild(dx);
      row.appendChild(dy);
      row.appendChild(x);
      sideEls.compList.appendChild(row);
    });

    // onion picker options
    var selVal = onionCp === null ? '' : String(onionCp);
    clearNode(sideEls.onionSel);
    var optNone = el('option', null, 'None');
    optNone.value = '';
    sideEls.onionSel.appendChild(optNone);
    var keys = Object.keys(FontModel.doc.glyphs).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) {
      if (window.UI && keys[i] === UI.selGlyph) continue;
      var o = el('option', null, fmtCp(keys[i]));
      o.value = String(keys[i]);
      sideEls.onionSel.appendChild(o);
    }
    sideEls.onionSel.value = selVal;
    if (sideEls.onionSel.value !== selVal) { onionCp = null; sideEls.onionSel.value = ''; }
  }

  function updateToolbar() {
    toolbarEls.pen.classList.toggle('active', tool === 'pen');
    toolbarEls.select.classList.toggle('active', tool === 'select');
    toolbarEls.snap.classList.toggle('active', snapOn);
    if (svg) {
      svg.setAttribute('class', 'uiv-svg tool-' + tool +
        (spaceDown && !gesture ? ' pannable' : '') +
        (gesture && gesture.kind === 'pan' ? ' panning' : ''));
    }
  }

  function setTool(t) {
    if (t === tool) return;
    finalizePen(true);
    tool = t;
    sel = null;
    renderScene();
    updateToolbar();
  }

  // ── scene render ───────────────────────────────────────────────
  function renderScene() {
    if (!svg) return;
    validateState();
    var g = curGlyph();
    emptyEl.style.display = g ? 'none' : 'flex';
    if (needFit && wrap.clientWidth > 0) { fit(); needFit = false; }
    applyCam();
    applyBg();   // keeps the reference image glued to the current em box
    drawGrid();
    drawGuides(g);
    drawOnion();
    drawComponents(g);
    buildShape(g);
    drawPenPreview(g);
    drawMarkers(g);
    drawHandles(g);
    updateToolbar();
  }

  function viewBounds() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    return {
      x0: -cam.tx / cam.z, x1: (w - cam.tx) / cam.z,
      y0: (cam.ty - h) / cam.z, y1: cam.ty / cam.z
    };
  }

  function drawGrid() {
    clearNode(L.grid);
    if (!snapOn) return;
    var v = viewBounds();
    var step = SNAP;
    while (step * cam.z < 7) step *= 10;
    var d = '';
    var count = 0;
    for (var x = Math.ceil(v.x0 / step) * step; x <= v.x1 && count < 400; x += step, count++)
      d += 'M' + fmt(x) + ' ' + fmt(v.y0) + 'L' + fmt(x) + ' ' + fmt(v.y1);
    for (var y = Math.ceil(v.y0 / step) * step; y <= v.y1 && count < 800; y += step, count++)
      d += 'M' + fmt(v.x0) + ' ' + fmt(y) + 'L' + fmt(v.x1) + ' ' + fmt(y);
    if (d) L.grid.appendChild(sv('path', {
      d: d, stroke: '#161616', 'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke', fill: 'none'
    }));
  }

  function drawGuides(g) {
    clearNode(L.guides);
    clearNode(L.screen);
    var m = FontModel.doc.meta;
    var v = viewBounds();
    var horiz = [
      { y: 0, label: 'baseline', c: '#525252' },
      { y: m.xHeight, label: 'x-height', c: '#3f3f46' },
      { y: m.capHeight, label: 'cap', c: '#3f3f46' },
      { y: m.ascender, label: 'asc', c: '#333' },
      { y: m.descender, label: 'desc', c: '#333' }
    ];
    for (var i = 0; i < horiz.length; i++) {
      L.guides.appendChild(sv('line', {
        x1: fmt(v.x0), y1: fmt(horiz[i].y), x2: fmt(v.x1), y2: fmt(horiz[i].y),
        stroke: horiz[i].c, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke'
      }));
      var s = toScreen(0, horiz[i].y);
      var t = sv('text', {
        x: 6, y: fmt(s.y - 4), fill: 'var(--text-muted)', 'font-size': 10,
        'font-family': 'IBM Plex Mono, monospace'
      });
      t.textContent = horiz[i].label;
      L.screen.appendChild(t);
    }
    L.guides.appendChild(sv('line', {
      x1: 0, y1: fmt(v.y0), x2: 0, y2: fmt(v.y1),
      stroke: '#525252', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke'
    }));
    if (g) {
      pathEls.advLine = sv('line', {
        x1: fmt(g.adv), y1: fmt(v.y0), x2: fmt(g.adv), y2: fmt(v.y1),
        stroke: '#8a6d0a', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke'
      });
      L.guides.appendChild(pathEls.advLine);
      var sa = toScreen(g.adv, 0);
      pathEls.advLabel = sv('text', {
        x: fmt(sa.x + 5), y: 14, fill: '#8a6d0a', 'font-size': 10,
        'font-family': 'IBM Plex Mono, monospace'
      });
      pathEls.advLabel.textContent = 'adv ' + g.adv;
      L.screen.appendChild(pathEls.advLabel);
    }
  }

  function drawOnion() {
    clearNode(L.onion);
    if (onionCp === null) return;
    var cs = resolvedContours(onionCp, 0, 0, 0, {});
    if (!cs.length) return;
    L.onion.appendChild(sv('path', {
      d: allClosedD(cs, -1), fill: 'rgba(148,163,184,.07)', 'fill-rule': 'nonzero',
      stroke: '#475569', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
      'stroke-dasharray': '4 3'
    }));
  }

  function drawComponents(g) {
    clearNode(L.comp);
    if (!g || !g.components || !g.components.length) return;
    var seen = {};
    if (window.UI && UI.selGlyph !== null) seen[UI.selGlyph] = true; // block self-cycles
    var all = [];
    for (var k = 0; k < g.components.length; k++) {
      var sub = resolvedContours(g.components[k].ref, g.components[k].dx, g.components[k].dy, 1, seen);
      for (var m = 0; m < sub.length; m++) all.push(sub[m]);
    }
    if (!all.length) return;
    L.comp.appendChild(sv('path', {
      d: allClosedD(all, -1), fill: 'rgba(234,179,8,.06)', 'fill-rule': 'nonzero',
      stroke: '#6b5d1a', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke'
    }));
  }

  function openCi() {
    return (pen && window.UI && pen.cp === UI.selGlyph) ? pen.ci : -1;
  }

  function buildShape(g) {
    clearNode(L.shape);
    pathEls.fill = null;
    pathEls.strokes = [];
    pathEls.strokeCis = [];
    if (!g || !g.contours) return;
    var skip = openCi();
    pathEls.fill = sv('path', {
      d: allClosedD(g.contours, skip) || 'M0 0', 'fill-rule': 'nonzero',
      fill: 'rgba(234,179,8,.14)', stroke: 'none'
    });
    L.shape.appendChild(pathEls.fill);
    for (var ci = 0; ci < g.contours.length; ci++) {
      if (ci === skip || g.contours[ci].length < 2) continue;
      var p = sv('path', {
        d: contourD(g.contours[ci], true), fill: 'none',
        stroke: '#eab308', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke'
      });
      pathEls.strokes.push(p);
      pathEls.strokeCis.push(ci);
      L.shape.appendChild(p);
    }
  }

  function updateShapeD(g) {
    if (!g || !pathEls.fill) return;
    pathEls.fill.setAttribute('d', allClosedD(g.contours, openCi()) || 'M0 0');
    for (var i = 0; i < pathEls.strokes.length; i++) {
      var ci = pathEls.strokeCis[i];
      if (ci < g.contours.length && g.contours[ci].length >= 2)
        pathEls.strokes[i].setAttribute('d', contourD(g.contours[ci], true));
    }
  }

  function drawPenPreview(g) {
    clearNode(L.draw);
    var ci = openCi();
    if (!g || ci < 0 || ci >= g.contours.length) return;
    var pts = g.contours[ci];
    if (!pts.length) return;
    if (pts.length > 1) {
      L.draw.appendChild(sv('path', {
        d: contourD(pts, false), fill: 'none', stroke: '#fde047',
        'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke'
      }));
    }
    var last = pts[pts.length - 1], first = pts[0];
    if (pts.length > 1) {
      L.draw.appendChild(sv('line', {
        x1: fmt(last.x), y1: fmt(last.y), x2: fmt(first.x), y2: fmt(first.y),
        stroke: '#71717a', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
        'stroke-dasharray': '3 3'
      }));
    }
    // live out-handle preview while drag-placing an anchor
    var out = null, at = null;
    if (gesture && gesture.kind === 'pen' && gesture.dragged && gesture.out) {
      out = gesture.out; at = gesture.base;
    } else if (pen && pen.pendingOut) {
      out = pen.pendingOut; at = { x: last.x, y: last.y };
    }
    if (out && at) {
      var r = 3 / cam.z;
      L.draw.appendChild(sv('line', {
        x1: fmt(at.x), y1: fmt(at.y), x2: fmt(out.x), y2: fmt(out.y),
        stroke: '#a1a1aa', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke'
      }));
      L.draw.appendChild(sv('circle', {
        cx: fmt(out.x), cy: fmt(out.y), r: r, fill: '#a1a1aa'
      }));
    }
  }

  function anchorSmooth(pts, pi) {
    var n = pts.length;
    var a = pts[pi], nx = pts[(pi + 1) % n];
    var inC = hasH(a) && !near(a.cx2, a.cy2, a.x, a.y);
    var outC = hasH(nx) && !near(nx.cx1, nx.cy1, a.x, a.y);
    return inC || outC;
  }

  function drawMarkers(g) {
    clearNode(L.markers);
    markerRefs = [];
    if (!g || !g.contours) return;
    var s = 3.2 / cam.z, ss = 4.4 / cam.z;
    for (var ci = 0; ci < g.contours.length; ci++) {
      var pts = g.contours[ci];
      markerRefs[ci] = [];
      for (var pi = 0; pi < pts.length; pi++) {
        var p = pts[pi];
        var isSel = sel && sel.ci === ci && sel.pi === pi;
        var r = isSel ? ss : s;
        var elMk;
        if (pts.length >= 2 && anchorSmooth(pts, pi)) {
          elMk = sv('circle', {
            cx: fmt(p.x), cy: fmt(p.y), r: r,
            fill: isSel ? '#eab308' : '#0b0b0b',
            stroke: isSel ? '#fde047' : '#a3a3a3',
            'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke'
          });
        } else {
          elMk = sv('rect', {
            x: fmt(p.x - r), y: fmt(p.y - r), width: fmt(r * 2), height: fmt(r * 2),
            fill: isSel ? '#eab308' : '#0b0b0b',
            stroke: isSel ? '#fde047' : '#a3a3a3',
            'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke'
          });
        }
        markerRefs[ci][pi] = elMk;
        L.markers.appendChild(elMk);
      }
    }
  }

  // handle points of the selected anchor: in = own cx2/cy2, out = next.cx1/cy1
  function selHandles(g) {
    if (!sel || !g) return null;
    var pts = g.contours[sel.ci];
    if (!pts || pts.length < 2) return null;
    var n = pts.length;
    var a = pts[sel.pi], nx = pts[(sel.pi + 1) % n];
    return {
      pts: pts, a: a, nx: nx,
      inH: hasH(a) ? { x: a.cx2, y: a.cy2 } : null,
      outH: hasH(nx) ? { x: nx.cx1, y: nx.cy1 } : null
    };
  }

  function drawHandles(g) {
    clearNode(L.handles);
    var h = selHandles(g);
    if (!h) return;
    var r = 2.8 / cam.z;
    function put(pt) {
      L.handles.appendChild(sv('line', {
        x1: fmt(h.a.x), y1: fmt(h.a.y), x2: fmt(pt.x), y2: fmt(pt.y),
        stroke: '#818cf8', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke'
      }));
      L.handles.appendChild(sv('circle', {
        cx: fmt(pt.x), cy: fmt(pt.y), r: r, fill: '#818cf8'
      }));
    }
    if (h.inH) put(h.inH);
    if (h.outH) put(h.outH);
  }

  function lightRedraw() {
    var g = curGlyph();
    updateShapeD(g);
    drawPenPreview(g);
    drawMarkers(g);
    drawHandles(g);
  }

  // ── hit testing ────────────────────────────────────────────────
  function hitAnchor(g, p, thPx) {
    if (!g || !g.contours) return null;
    var th = thPx / cam.z, best = null;
    for (var ci = 0; ci < g.contours.length; ci++) {
      var pts = g.contours[ci];
      for (var pi = 0; pi < pts.length; pi++) {
        var d = dist(pts[pi].x, pts[pi].y, p.x, p.y);
        if (d < th && (!best || d < best.d)) best = { ci: ci, pi: pi, d: d };
      }
    }
    return best;
  }

  function hitHandle(g, p, thPx) {
    var h = selHandles(g);
    if (!h) return null;
    var th = thPx / cam.z;
    if (h.inH && dist(h.inH.x, h.inH.y, p.x, p.y) < th) return 'in';
    if (h.outH && dist(h.outH.x, h.outH.y, p.x, p.y) < th) return 'out';
    return null;
  }

  // ── gestures ───────────────────────────────────────────────────
  function onDown(e) {
    if (!curGlyph() && tool !== 'select') { /* still allow pan */ }
    var isPan = e.button === 1 || (e.button === 0 && spaceDown);
    if (isPan) {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: cam.tx, ty0: cam.ty };
      updateToolbar();
      return;
    }
    if (e.button !== 0) return;
    if (bgMove && bgUrl) {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      var bp = toFont(e);
      gesture = { kind: 'bgmove', px: bp.x, py: bp.y, x0: bgX, top0: bgTop };
      return;
    }
    var g = curGlyph();
    if (!g) return;
    var p = toFont(e);
    svg.setPointerCapture(e.pointerId);

    if (tool === 'select') {
      var hh = hitHandle(g, p, 8);
      if (hh) {
        var h = selHandles(g);
        var mirror = false;
        if (h.inH && h.outH) {
          var v1x = h.inH.x - h.a.x, v1y = h.inH.y - h.a.y;
          var v2x = h.outH.x - h.a.x, v2y = h.outH.y - h.a.y;
          var l1 = Math.sqrt(v1x * v1x + v1y * v1y), l2 = Math.sqrt(v2x * v2x + v2y * v2y);
          if (l1 > 0.01 && l2 > 0.01) {
            mirror = (v1x * v2x + v1y * v2y) / (l1 * l2) < -0.985;
          }
        }
        gesture = { kind: 'handle', which: hh, mirror: mirror, moved: false };
        return;
      }
      var ha = hitAnchor(g, p, 8);
      if (ha) {
        sel = { ci: ha.ci, pi: ha.pi };
        gesture = {
          kind: 'anchor', ci: ha.ci, pi: ha.pi, moved: false,
          off: { x: g.contours[ha.ci][ha.pi].x - p.x, y: g.contours[ha.ci][ha.pi].y - p.y }
        };
        drawMarkers(g); drawHandles(g);
        return;
      }
      if (Math.abs(p.x - g.adv) * cam.z < 6) {
        gesture = { kind: 'adv', moved: false };
        return;
      }
      sel = null;
      drawMarkers(g); drawHandles(g);
      return;
    }

    if (tool === 'pen') {
      penDown(g, p, e);
    }
  }

  function penDown(g, p) {
    // close on first-anchor click
    var oc = openCi();
    if (oc >= 0 && g.contours[oc] && g.contours[oc].length >= 2) {
      var pts = g.contours[oc];
      var first = pts[0], last = pts[pts.length - 1];
      if (dist(first.x, first.y, p.x, p.y) * cam.z < 9) {
        var cx1 = pen.pendingOut ? pen.pendingOut.x : last.x;
        var cy1 = pen.pendingOut ? pen.pendingOut.y : last.y;
        var cx2 = pen.firstIn ? pen.firstIn.x : first.x;
        var cy2 = pen.firstIn ? pen.firstIn.y : first.y;
        if (pen.pendingOut || pen.firstIn) setH(first, cx1, cy1, cx2, cy2);
        else clearH(first);
        gesture = { kind: 'close', ci: oc, p0: { x: first.x, y: first.y }, cx1: cx1, cy1: cy1, dragged: false };
        pen = null;
        renderScene();
        return;
      }
    }
    // place anchor
    var sp = { x: snapv(p.x), y: snapv(p.y) };
    if (oc < 0) {
      g.contours.push([{ x: sp.x, y: sp.y }]);
      pen = { cp: UI.selGlyph, ci: g.contours.length - 1, pendingOut: null, firstIn: null };
      gesture = { kind: 'pen', ci: pen.ci, pi: 0, base: sp, first: true, dragged: false, out: null };
    } else {
      var arr = g.contours[oc];
      var np = { x: sp.x, y: sp.y };
      if (pen.pendingOut) {
        setH(np, pen.pendingOut.x, pen.pendingOut.y, sp.x, sp.y);
      }
      arr.push(np);
      gesture = { kind: 'pen', ci: oc, pi: arr.length - 1, base: sp, first: false, dragged: false, out: null };
    }
    renderScene();
  }

  function onMove(e) {
    if (!svg) return;
    var p = toFont(e);
    statusEl.textContent = Math.round(p.x) + ', ' + Math.round(p.y) + '  ×' + fmt(cam.z);
    if (!gesture) return;
    var g = curGlyph();

    if (gesture.kind === 'pan') {
      cam.tx = gesture.tx0 + (e.clientX - gesture.sx);
      cam.ty = gesture.ty0 + (e.clientY - gesture.sy);
      scheduleScene();
      return;
    }
    if (gesture.kind === 'bgmove') {
      bgX = gesture.x0 + (p.x - gesture.px);
      bgTop = gesture.top0 + (p.y - gesture.py);
      applyBg();
      return;
    }
    if (!g) return;

    if (gesture.kind === 'pen') {
      var pts = g.contours[gesture.ci];
      if (!pts || !pts[gesture.pi]) { gesture = null; return; } // doc replaced mid-gesture
      var vx = p.x - gesture.base.x, vy = p.y - gesture.base.y;
      if (!gesture.dragged && Math.sqrt(vx * vx + vy * vy) * cam.z > 3) gesture.dragged = true;
      if (!gesture.dragged) return;
      gesture.out = { x: gesture.base.x + vx, y: gesture.base.y + vy };
      var a = pts[gesture.pi];
      if (gesture.first) {
        // handles of the first anchor belong to the closing segment; stash mirror
        gesture.firstIn = { x: gesture.base.x - vx, y: gesture.base.y - vy };
      } else {
        var prev = pts[gesture.pi - 1];
        var po = pen && pen.pendingOut;
        setH(a, po ? po.x : prev.x, po ? po.y : prev.y,
          gesture.base.x - vx, gesture.base.y - vy);
      }
      lightRedraw();
      return;
    }

    if (gesture.kind === 'close') {
      var pts2 = g.contours[gesture.ci];
      if (!pts2) return;
      var f = pts2[0];
      var vx2 = p.x - gesture.p0.x, vy2 = p.y - gesture.p0.y;
      if (!gesture.dragged && Math.sqrt(vx2 * vx2 + vy2 * vy2) * cam.z > 3) gesture.dragged = true;
      if (!gesture.dragged) return;
      setH(f, gesture.cx1, gesture.cy1, gesture.p0.x - vx2, gesture.p0.y - vy2);
      lightRedraw();
      return;
    }

    if (gesture.kind === 'anchor') {
      var pts3 = g.contours[gesture.ci];
      if (!pts3 || gesture.pi >= pts3.length) return;
      var a3 = pts3[gesture.pi];
      var nxp = { x: snapv(p.x + gesture.off.x), y: snapv(p.y + gesture.off.y) };
      var dx = nxp.x - a3.x, dy = nxp.y - a3.y;
      if (!dx && !dy) return;
      gesture.moved = true;
      a3.x += dx; a3.y += dy;
      if (hasH(a3)) { a3.cx2 += dx; a3.cy2 += dy; }
      var nx3 = pts3[(gesture.pi + 1) % pts3.length];
      if (nx3 !== a3 && hasH(nx3)) { nx3.cx1 += dx; nx3.cy1 += dy; }
      lightRedraw();
      return;
    }

    if (gesture.kind === 'handle') {
      var h = selHandles(g);
      if (!h) return;
      gesture.moved = true;
      var hp = { x: snapv(p.x), y: snapv(p.y) };
      if (gesture.which === 'in') {
        h.a.cx2 = hp.x; h.a.cy2 = hp.y;
        if (gesture.mirror && hasH(h.nx)) {
          var dxi = hp.x - h.a.x, dyi = hp.y - h.a.y;
          var li = Math.sqrt(dxi * dxi + dyi * dyi);
          if (li > 0.01) {
            var lo = dist(h.nx.cx1, h.nx.cy1, h.a.x, h.a.y);
            h.nx.cx1 = h.a.x - dxi / li * lo;
            h.nx.cy1 = h.a.y - dyi / li * lo;
          }
        }
      } else {
        h.nx.cx1 = hp.x; h.nx.cy1 = hp.y;
        if (gesture.mirror && hasH(h.a)) {
          var dxo = hp.x - h.a.x, dyo = hp.y - h.a.y;
          var lo2 = Math.sqrt(dxo * dxo + dyo * dyo);
          if (lo2 > 0.01) {
            var li2 = dist(h.a.cx2, h.a.cy2, h.a.x, h.a.y);
            h.a.cx2 = h.a.x - dxo / lo2 * li2;
            h.a.cy2 = h.a.y - dyo / lo2 * li2;
          }
        }
      }
      lightRedraw();
      return;
    }

    if (gesture.kind === 'adv') {
      gesture.moved = true;
      var nv = Math.max(0, Math.round(snapv(p.x)));
      g.adv = nv;
      if (pathEls.advLine) {
        pathEls.advLine.setAttribute('x1', nv);
        pathEls.advLine.setAttribute('x2', nv);
      }
      if (pathEls.advLabel) {
        pathEls.advLabel.setAttribute('x', fmt(toScreen(nv, 0).x + 5));
        pathEls.advLabel.textContent = 'adv ' + nv;
      }
    }
  }

  function onUp(e) {
    if (!gesture) return;
    var g = curGlyph();
    var k = gesture.kind;
    if (k === 'bgmove') { gesture = null; return; }

    if (k === 'pen' && g) {
      var pts = g.contours[gesture.ci];
      if (pts && pts[gesture.pi]) {
        var a = pts[gesture.pi];
        if (gesture.first) {
          if (pen) {
            pen.firstIn = gesture.dragged ? gesture.firstIn : null;
            pen.pendingOut = gesture.dragged ? gesture.out : null;
          }
        } else {
          if (pen) pen.pendingOut = gesture.dragged ? gesture.out : null;
          if (hasH(a) && near(a.cx1, a.cy1, pts[gesture.pi - 1].x, pts[gesture.pi - 1].y)
            && near(a.cx2, a.cy2, a.x, a.y)) clearH(a);
        }
      }
      gesture = null;
      FontModel.save();
      return;
    }
    if (k === 'close' && g) {
      var pts2 = g.contours[gesture.ci];
      if (pts2 && pts2.length) {
        var f = pts2[0], last = pts2[pts2.length - 1];
        if (hasH(f) && near(f.cx1, f.cy1, last.x, last.y) && near(f.cx2, f.cy2, f.x, f.y)) clearH(f);
      }
      gesture = null;
      FontModel.save();
      return;
    }
    if (k === 'anchor' || k === 'handle' || k === 'adv') {
      var moved = gesture.moved;
      gesture = null;
      if (moved) FontModel.save();
      else renderScene();
      return;
    }
    gesture = null; // pan
    updateToolbar();
  }

  function onWheel(e) {
    e.preventDefault();
    var r = svg.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var fx = (mx - cam.tx) / cam.z, fy = (cam.ty - my) / cam.z;
    var f = Math.pow(1.0015, -e.deltaY);
    cam.z = clamp(cam.z * f, 0.02, 30);
    cam.tx = mx - fx * cam.z;
    cam.ty = my + fy * cam.z;
    scheduleScene();
  }

  function onDbl(e) {
    if (tool !== 'select') return;
    var g = curGlyph();
    if (!g) return;
    var p = toFont(e);
    var ha = hitAnchor(g, p, 8);
    if (ha) { toggleSmooth(g, ha.ci, ha.pi); return; }
    var seg = nearestSegment(g.contours, p, 10 / cam.z);
    if (seg) {
      var ni = splitSegment(g.contours[seg.ci], seg.s, seg.t);
      sel = { ci: seg.ci, pi: ni };
      FontModel.save();
    }
  }

  // ── point ops ──────────────────────────────────────────────────
  function toggleSmooth(g, ci, pi) {
    var pts = g.contours[ci];
    var n = pts.length;
    if (n < 2) return;
    var a = pts[pi], prev = pts[(pi - 1 + n) % n], nx = pts[(pi + 1) % n];
    var inC = hasH(a) && !near(a.cx2, a.cy2, a.x, a.y);
    var outC = hasH(nx) && !near(nx.cx1, nx.cy1, a.x, a.y);
    if (inC || outC) {
      // → corner: degenerate anchor-side controls, drop fully-degenerate handles
      if (hasH(a)) {
        a.cx2 = a.x; a.cy2 = a.y;
        if (near(a.cx1, a.cy1, prev.x, prev.y)) clearH(a);
      }
      if (hasH(nx)) {
        nx.cx1 = a.x; nx.cy1 = a.y;
        if (near(nx.cx2, nx.cy2, nx.x, nx.y)) clearH(nx);
      }
    } else {
      // → smooth: symmetric handles along the prev→next tangent
      var dx = nx.x - prev.x, dy = nx.y - prev.y;
      var l = Math.sqrt(dx * dx + dy * dy);
      if (l < 0.01) { dx = 1; dy = 0; l = 1; }
      dx /= l; dy /= l;
      var lin = Math.max(dist(a.x, a.y, prev.x, prev.y) / 3, 10);
      var lout = Math.max(dist(a.x, a.y, nx.x, nx.y) / 3, 10);
      if (!hasH(a)) setH(a, prev.x, prev.y, a.x, a.y);
      a.cx2 = a.x - dx * lin; a.cy2 = a.y - dy * lin;
      if (nx !== a) {
        if (!hasH(nx)) setH(nx, a.x, a.y, nx.x, nx.y);
        nx.cx1 = a.x + dx * lout; nx.cy1 = a.y + dy * lout;
      }
    }
    sel = { ci: ci, pi: pi };
    FontModel.save();
  }

  function deleteSelected() {
    var g = curGlyph();
    if (!g || !sel) return;
    var pts = g.contours[sel.ci];
    if (!pts || sel.pi >= pts.length) { sel = null; return; }
    pts.splice(sel.pi, 1);
    if (pts.length < 2) {
      g.contours.splice(sel.ci, 1);
      if (pen && pen.ci === sel.ci) pen = null;
      else if (pen && pen.ci > sel.ci) pen.ci--;
    }
    sel = null;
    FontModel.save();
  }

  function finalizePen(doSave) {
    if (!pen) return;
    var changed = false;
    var glyph = FontModel.getGlyph(pen.cp);
    if (glyph && pen.ci < glyph.contours.length && glyph.contours[pen.ci].length < 2) {
      glyph.contours.splice(pen.ci, 1);
      changed = true;
    }
    pen = null;
    if (changed && doSave) FontModel.save();
  }

  // ── sidebar actions ────────────────────────────────────────────
  function parseCp(s) {
    s = (s || '').trim();
    if (!s) return null;
    var m = /^[Uu]\+?([0-9a-fA-F]+)$/.exec(s);
    if (m) return parseInt(m[1], 16);
    if (/^\d+$/.test(s) && s.length > 1) return parseInt(s, 10);
    if (/^\d$/.test(s)) return s.codePointAt(0); // single digit char means the char
    return s.codePointAt(0);
  }

  function addComponent() {
    var g = curGlyph();
    if (!g) { toast('Select a glyph first', false); return; }
    var cp = parseCp(sideEls.compInput.value);
    if (cp === null || cp === undefined || !isFinite(cp)) {
      toast('Enter a character, U+hex or decimal codepoint', false);
      return;
    }
    if (window.UI && cp === UI.selGlyph) { toast('A glyph cannot reference itself', false); return; }
    g.components.push({ ref: cp, dx: 0, dy: 0 });
    sideEls.compInput.value = '';
    if (!FontModel.getGlyph(cp)) toast(fmtCp(cp) + ' is empty — draw it to see the reference', false);
    FontModel.save();
  }

  function pasteSvgPath() {
    var g = curGlyph();
    if (!g) { toast('Select a glyph first', false); return; }
    var d = sideEls.svgD.value;
    if (!d.trim()) { toast('Paste an SVG path "d" string first', false); return; }
    var scale = Number(sideEls.svgScale.value);
    if (!isFinite(scale) || scale === 0) scale = 1;
    var cs = FontImport.svgPathToContours(d, scale, true);
    if (!cs.length) { toast('No contours parsed from that path', false); return; }
    for (var i = 0; i < cs.length; i++) g.contours.push(cs[i]);
    sideEls.svgD.value = '';
    toast('Added ' + cs.length + ' contour' + (cs.length === 1 ? '' : 's'));
    FontModel.save();
  }

  // ── keyboard ───────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.code === 'Space' && isVisible() && !typing()) {
      spaceDown = true;
      e.preventDefault();
      updateToolbar();
      return;
    }
    if (!isVisible() || typing()) return;
    // don't hijack browser-chrome shortcuts (Ctrl+P, Ctrl+V, Cmd+G, …)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'Escape') {
      if (pen) { finalizePen(true); renderScene(); }
      else if (sel) { sel = null; renderScene(); }
    } else if (e.key === 'p' || e.key === 'P') {
      setTool('pen');
    } else if (e.key === 'v' || e.key === 'V') {
      setTool('select');
    } else if (e.key === 'g' || e.key === 'G') {
      snapOn = !snapOn;
      renderScene();
    }
  }
  function onKeyUp(e) {
    if (e.code === 'Space') { spaceDown = false; updateToolbar(); }
  }

  // ── state validation / change plumbing ─────────────────────────
  function validateState() {
    var g = curGlyph();
    if (pen && (!window.UI || pen.cp !== UI.selGlyph ||
      !g || pen.ci >= g.contours.length)) pen = null;
    if (sel && (!g || sel.ci >= g.contours.length ||
      sel.pi >= g.contours[sel.ci].length)) sel = null;
  }

  function onModelChange() {
    var cp = window.UI ? UI.selGlyph : null;
    if (cp !== lastCp) {
      lastCp = cp;
      sel = null;
      finalizePen(false);
      needFit = true;
    }
    // an emit during a live drawing gesture means the doc was replaced from
    // outside (undo/open/…): the gesture's indices are stale — drop it.
    // Safe: gestures set gesture=null before calling save() themselves.
    if (gesture && gesture.kind !== 'pan') gesture = null;
    validateState();
    renderPanels();
    renderScene();
  }

  var UIVector = {
    init: function () {
      injectStyle();
      build();
      FontModel.onChange(onModelChange);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', function () { spaceDown = false; });
      window.addEventListener('carino-tab', function () {
        finalizePen(true);
        renderPanels();
        scheduleScene();
      });
      lastCp = window.UI ? UI.selGlyph : null;
      renderPanels();
      renderScene();
    }
  };

  window.UIVector = UIVector;
})();
