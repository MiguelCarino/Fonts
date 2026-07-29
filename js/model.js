(function () {
  'use strict';

  var HIST_CAP = 100;
  var LS_KEY = 'carino-fonts-doc';
  var MAX_CP = 0x10FFFF;

  var hasWindow = typeof window !== 'undefined';
  var LS = null;
  try { LS = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { LS = null; }

  function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }
  function int(v, d) { return Math.round(num(v, d)); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function cint(v, d, lo, hi) { return clamp(int(v, d), lo, hi); }
  function str(v, d) { return typeof v === 'string' ? v.slice(0, 200) : d; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function blankPx(grid) {
    var rows = [];
    for (var i = 0; i < grid.h; i++) rows.push(new Array(grid.w + 1).join('0'));
    return rows;
  }

  function fixRow(row, w) {
    var s = typeof row === 'string' ? row : '';
    var out = '';
    for (var i = 0; i < w; i++) out += s.charAt(i) === '1' ? '1' : '0';
    return out;
  }

  function normPoint(p) {
    if (!isObj(p)) return null;
    var x = Number(p.x), y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    var out = { x: x, y: y };
    var cx1 = Number(p.cx1), cy1 = Number(p.cy1), cx2 = Number(p.cx2), cy2 = Number(p.cy2);
    // handles are all-or-nothing: partial handle data degrades to a line segment
    if (Number.isFinite(cx1) && Number.isFinite(cy1) && Number.isFinite(cx2) && Number.isFinite(cy2)) {
      out.cx1 = cx1; out.cy1 = cy1; out.cx2 = cx2; out.cy2 = cy2;
    }
    return out;
  }

  function normGlyph(raw, doc) {
    if (!isObj(raw)) return null;
    var g = {
      adv: cint(raw.adv, Math.round(doc.meta.upm * 0.5), 0, 32767),
      mode: raw.mode === 'vector' ? 'vector' : 'pixel',
      px: [],
      contours: [],
      components: []
    };
    var srcPx = Array.isArray(raw.px) ? raw.px : [];
    for (var r = 0; r < doc.grid.h; r++) g.px.push(fixRow(srcPx[r], doc.grid.w));
    if (Array.isArray(raw.contours)) {
      for (var i = 0; i < raw.contours.length; i++) {
        var c = raw.contours[i];
        if (!Array.isArray(c)) continue;
        var pts = [];
        for (var j = 0; j < c.length; j++) {
          var p = normPoint(c[j]);
          if (p) pts.push(p);
        }
        if (pts.length >= 2) g.contours.push(pts);
      }
    }
    if (Array.isArray(raw.components)) {
      for (var k = 0; k < raw.components.length; k++) {
        var comp = raw.components[k];
        if (!isObj(comp)) continue;
        var ref = int(comp.ref, NaN);
        if (!Number.isFinite(ref) || ref < 0 || ref > MAX_CP) continue;
        g.components.push({ ref: ref, dx: int(comp.dx, 0), dy: int(comp.dy, 0) });
      }
    }
    return g;
  }

  // Canonical unicode sets — shared by the glyph map (visibility), the
  // compiler (export filter) and normalize (doc.sets validation).
  var SETS = [
    ['Basic Latin', 0x0020, 0x007E],
    ['Latin-1 Supplement', 0x00A0, 0x00FF],
    ['Latin Extended-A', 0x0100, 0x017F],
    ['Latin Extended-B', 0x0180, 0x024F],
    ['IPA Extensions', 0x0250, 0x02AF],
    ['Spacing Modifier Letters', 0x02B0, 0x02FF],
    ['Combining Diacritical Marks', 0x0300, 0x036F],
    ['Greek and Coptic', 0x0370, 0x03FF],
    ['Cyrillic', 0x0400, 0x04FF],
    ['Cyrillic Supplement', 0x0500, 0x052F],
    ['Hebrew', 0x0590, 0x05FF],
    ['Arabic', 0x0600, 0x06FF],
    ['Devanagari', 0x0900, 0x097F],
    ['Thai', 0x0E00, 0x0E7F],
    ['Latin Extended Additional', 0x1E00, 0x1EFF],
    ['Greek Extended', 0x1F00, 0x1FFF],
    ['General Punctuation', 0x2000, 0x206F],
    ['Superscripts and Subscripts', 0x2070, 0x209F],
    ['Currency Symbols', 0x20A0, 0x20CF],
    ['Letterlike Symbols', 0x2100, 0x214F],
    ['Number Forms', 0x2150, 0x218F],
    ['Arrows', 0x2190, 0x21FF],
    ['Mathematical Operators', 0x2200, 0x22FF],
    ['Miscellaneous Technical', 0x2300, 0x23FF],
    ['Box Drawing', 0x2500, 0x257F],
    ['Block Elements', 0x2580, 0x259F],
    ['Geometric Shapes', 0x25A0, 0x25FF],
    ['Miscellaneous Symbols', 0x2600, 0x26FF],
    ['Dingbats', 0x2700, 0x27BF],
    ['CJK Symbols and Punctuation', 0x3000, 0x303F],
    ['Hiragana', 0x3040, 0x309F],
    ['Katakana', 0x30A0, 0x30FF],
    ['CJK Unified Ideographs', 0x4E00, 0x9FFF],
    ['Hangul Syllables', 0xAC00, 0xD7AF],
    ['Private Use Area', 0xE000, 0xF8FF],
    ['Alphabetic Presentation Forms', 0xFB00, 0xFB4F]
  ];
  var DEFAULT_SETS = ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A'];
  var SET_NAMES = {};
  for (var si = 0; si < SETS.length; si++) SET_NAMES[SETS[si][0]] = true;
  SET_NAMES.Other = true;

  function setOf(cp) {
    for (var b = 0; b < SETS.length; b++) {
      if (cp >= SETS[b][1] && cp <= SETS[b][2]) return SETS[b][0];
    }
    return 'Other';
  }

  function normalize(raw) {
    if (!isObj(raw)) raw = {};
    var m = isObj(raw.meta) ? raw.meta : {};
    var gr = isObj(raw.grid) ? raw.grid : {};
    var doc = {
      v: 1,
      meta: {
        family: str(m.family, 'My Font'),
        style: str(m.style, 'Regular'),
        author: str(m.author, ''),
        version: str(m.version, '1.000'),
        license: (m.license === 'OFL' || m.license === 'CC0' || m.license === 'ARR') ? m.license : 'OFL',
        upm: cint(m.upm, 1000, 16, 16384),
        ascender: cint(m.ascender, 800, -32768, 32767),
        descender: cint(m.descender, -200, -32768, 32767),
        xHeight: cint(m.xHeight, 500, -32768, 32767),
        capHeight: cint(m.capHeight, 700, -32768, 32767)
      },
      grid: { w: cint(gr.w, 16, 2, 64), h: cint(gr.h, 16, 2, 64), baseline: 12 },
      sets: [],
      kerning: {},
      glyphs: {}
    };
    doc.grid.baseline = cint(gr.baseline, 12, 0, doc.grid.h);
    if (Array.isArray(raw.sets)) {
      var seen = {};
      for (var sx = 0; sx < raw.sets.length; sx++) {
        var sn = raw.sets[sx];
        if (typeof sn === 'string' && SET_NAMES[sn] && !seen[sn]) {
          seen[sn] = true;
          doc.sets.push(sn);
        }
      }
    }
    if (!doc.sets.length) doc.sets = DEFAULT_SETS.slice();
    if (isObj(raw.kerning)) {
      for (var kk in raw.kerning) {
        if (!/^\d+,\d+$/.test(kk)) continue;
        var parts = kk.split(',');
        var l = parseInt(parts[0], 10), rr = parseInt(parts[1], 10);
        if (l > MAX_CP || rr > MAX_CP) continue;
        var kv = Number(raw.kerning[kk]);
        if (!Number.isFinite(kv)) continue;
        doc.kerning[l + ',' + rr] = clamp(Math.round(kv), -32768, 32767);
      }
    }
    if (isObj(raw.glyphs)) {
      for (var gk in raw.glyphs) {
        if (!/^\d+$/.test(gk)) continue;
        var cp = parseInt(gk, 10);
        if (cp > MAX_CP) continue;
        var g = normGlyph(raw.glyphs[gk], doc);
        if (g) doc.glyphs[String(cp)] = g;
      }
    }
    return doc;
  }

  function newProject() {
    return normalize({});
  }

  var listeners = [];
  var history = [];
  var hIndex = -1;

  var FontModel = {
    doc: null,

    newProject: newProject,
    normalize: normalize,
    SETS: SETS,
    DEFAULT_SETS: DEFAULT_SETS.slice(),
    setOf: setOf,

    serialize: function () { return JSON.stringify(FontModel.doc); },

    load: function (doc) {
      FontModel.doc = normalize(doc);
      history = [FontModel.serialize()];
      hIndex = 0;
      FontModel.emit();
    },

    getGlyph: function (cp) {
      return FontModel.doc.glyphs[String(cp)] || null;
    },

    ensureGlyph: function (cp) {
      var key = String(cp);
      var g = FontModel.doc.glyphs[key];
      if (!g) {
        g = {
          adv: Math.round(FontModel.doc.meta.upm * 0.5),
          mode: 'pixel',
          px: blankPx(FontModel.doc.grid),
          contours: [],
          components: []
        };
        FontModel.doc.glyphs[key] = g;
      }
      return g;
    },

    save: function () {
      var snap = FontModel.serialize();
      history = history.slice(0, hIndex + 1);
      history.push(snap);
      if (history.length > HIST_CAP) history = history.slice(history.length - HIST_CAP);
      hIndex = history.length - 1;
      mirror(snap);
      FontModel.emit();
    },

    undo: function () {
      if (hIndex <= 0) return;
      hIndex--;
      restore(history[hIndex]);
    },

    redo: function () {
      if (hIndex >= history.length - 1) return;
      hIndex++;
      restore(history[hIndex]);
    },

    onChange: function (fn) { listeners.push(fn); },

    emit: function () {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](FontModel.doc); } catch (e) { /* one bad listener must not stop the rest */ }
      }
    },

    loadLocal: function () {
      if (!LS) return null;
      try {
        var raw = LS.getItem(LS_KEY);
        if (!raw) return null;
        return normalize(JSON.parse(raw));
      } catch (e) { return null; }
    }
  };

  function restore(snap) {
    FontModel.doc = normalize(JSON.parse(snap));
    mirror(snap);
    FontModel.emit();
  }

  function mirror(snap) {
    if (!LS) return;
    try { LS.setItem(LS_KEY, snap); } catch (e) { /* quota — autosave is best-effort */ }
  }

  FontModel.doc = newProject();
  history = [FontModel.serialize()];
  hIndex = 0;

  if (hasWindow) window.FontModel = FontModel;
  if (typeof module !== 'undefined' && module.exports) module.exports = FontModel;
})();
