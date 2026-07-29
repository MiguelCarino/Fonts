(function () {
  'use strict';

  var MAX_DEPTH = 8; // component recursion guard

  function getOpentype() {
    if (typeof window !== 'undefined' && window.opentype) return window.opentype;
    if (typeof opentype !== 'undefined') return opentype;
    if (typeof require === 'function') {
      try { return require('../vendor/opentype.min.js'); } catch (e) {}
    }
    return null;
  }

  // ── pixel → contours (greedy rectangle merge) ─────────────────

  function pixelToContours(glyph, doc) {
    var grid = doc.grid;
    var cell = doc.meta.upm / grid.h;
    var px = glyph.px || [];
    var used = [];
    var r, c;
    for (r = 0; r < grid.h; r++) used.push(new Array(grid.w));

    function filled(cc, rr) {
      return rr >= 0 && rr < grid.h && cc >= 0 && cc < grid.w &&
        px[rr] && px[rr].charAt(cc) === '1';
    }

    var out = [];
    for (r = 0; r < grid.h; r++) {
      for (c = 0; c < grid.w; c++) {
        if (!filled(c, r) || used[r][c]) continue;
        // extend right
        var c1 = c;
        while (c1 + 1 < grid.w && filled(c1 + 1, r) && !used[r][c1 + 1]) c1++;
        // extend the whole run down
        var r1 = r;
        var ok = true;
        while (ok && r1 + 1 < grid.h) {
          for (var cc = c; cc <= c1; cc++) {
            if (!filled(cc, r1 + 1) || used[r1 + 1][cc]) { ok = false; break; }
          }
          if (ok) r1++;
        }
        for (var mr = r; mr <= r1; mr++) {
          for (var mc = c; mc <= c1; mc++) used[mr][mc] = true;
        }
        var x0 = c * cell, x1 = (c1 + 1) * cell;
        var yT = (grid.baseline - r) * cell;
        var yB = (grid.baseline - r1 - 1) * cell;
        // clockwise in font coords (y up) = correct outer winding for non-zero fill
        out.push([
          { x: x0, y: yB }, { x: x0, y: yT }, { x: x1, y: yT }, { x: x1, y: yB }
        ]);
      }
    }
    return out;
  }

  // ── outline flattening (components resolved, cycle-safe) ──────

  function shiftPoint(p, dx, dy) {
    var q = { x: p.x + dx, y: p.y + dy };
    if (p.cx1 !== undefined) {
      q.cx1 = p.cx1 + dx; q.cy1 = p.cy1 + dy;
      q.cx2 = p.cx2 + dx; q.cy2 = p.cy2 + dy;
    }
    return q;
  }

  function flatten(cp, doc, dx, dy, depth, seen) {
    var out = [];
    if (depth > MAX_DEPTH || seen[cp]) return out;
    var g = doc.glyphs[String(cp)];
    if (!g) return out;
    seen[cp] = true;
    var base = g.mode === 'pixel' ? pixelToContours(g, doc) : (g.contours || []);
    for (var i = 0; i < base.length; i++) {
      if (base[i].length < 2) continue;
      var pts = [];
      for (var j = 0; j < base[i].length; j++) pts.push(shiftPoint(base[i][j], dx, dy));
      out.push(pts);
    }
    var comps = g.components || [];
    for (var k = 0; k < comps.length; k++) {
      var sub = flatten(comps[k].ref, doc, dx + comps[k].dx, dy + comps[k].dy, depth + 1, seen);
      for (var m = 0; m < sub.length; m++) out.push(sub[m]);
    }
    delete seen[cp]; // off the stack: siblings may reuse the same ref
    return out;
  }

  function contoursToPath(ot, contours) {
    var path = new ot.Path();
    var R = Math.round;
    for (var i = 0; i < contours.length; i++) {
      var pts = contours[i];
      if (pts.length < 2) continue;
      path.moveTo(R(pts[0].x), R(pts[0].y));
      for (var j = 1; j <= pts.length; j++) {
        // wrap: the closing segment is described by the first anchor's handles
        var p = pts[j % pts.length];
        if (p.cx1 !== undefined) {
          path.curveTo(R(p.cx1), R(p.cy1), R(p.cx2), R(p.cy2), R(p.x), R(p.y));
        } else {
          path.lineTo(R(p.x), R(p.y));
        }
      }
      path.close();
    }
    return path;
  }

  // ── licenses ──────────────────────────────────────────────────

  var LICENSES = {
    OFL: {
      name: 'SIL Open Font License 1.1',
      text: 'This Font Software is licensed under the SIL Open Font License, Version 1.1. ' +
        'This license is available with a FAQ at: https://openfontlicense.org. ' +
        'The Font Software may be used, studied, modified and redistributed freely, ' +
        'provided it is not sold by itself and derivative works are distributed under this same license.',
      url: 'https://openfontlicense.org'
    },
    CC0: {
      name: 'CC0 1.0 Universal (Public Domain Dedication)',
      text: 'To the extent possible under law, the author has waived all copyright and ' +
        'related or neighboring rights to this Font Software. It is dedicated to the public domain: ' +
        'you may copy, modify, distribute and use it, even commercially, without asking permission. ' +
        'See https://creativecommons.org/publicdomain/zero/1.0/',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/'
    },
    ARR: {
      name: 'All Rights Reserved',
      text: 'All rights reserved. This Font Software is proprietary; it may not be used, ' +
        'copied, modified or redistributed without the explicit permission of the copyright holder.',
      url: ''
    }
  };

  function licenseNotice(id) {
    return LICENSES[id] || LICENSES.OFL;
  }

  // ── compile doc → opentype.Font ───────────────────────────────

  function glyphName(cp) {
    var hex = cp.toString(16).toUpperCase();
    if (cp === 0x20) return 'space';
    if (hex.length <= 4) {
      while (hex.length < 4) hex = '0' + hex;
      return 'uni' + hex;
    }
    return 'u' + hex;
  }

  function compile(doc) {
    var ot = getOpentype();
    if (!ot) throw new Error('opentype.js not available');
    var m = doc.meta;
    var upm = m.upm > 0 ? m.upm : 1000;
    var asc = m.ascender > 0 ? m.ascender : Math.round(upm * 0.8);
    var desc = m.descender < 0 ? m.descender : -Math.round(upm * 0.2);

    var glyphs = [new ot.Glyph({
      name: '.notdef',
      advanceWidth: Math.round(upm * 0.5),
      path: new ot.Path()
    })];

    // doc.sets is the export filter: glyphs in disabled sets stay in the
    // project but are left out of the compiled font (the subsetting story).
    var FM = (typeof window !== 'undefined' && window.FontModel) ? window.FontModel : null;
    if (!FM && typeof module !== 'undefined') { try { FM = require('./model.js'); } catch (e) {} }
    var setEnabled = null;
    if (FM && FM.setOf && Array.isArray(doc.sets) && doc.sets.length) {
      setEnabled = {};
      for (var se = 0; se < doc.sets.length; se++) setEnabled[doc.sets[se]] = true;
    }

    var cps = Object.keys(doc.glyphs).map(Number).sort(function (a, b) { return a - b; });
    var hasSpace = false;
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (setEnabled && !setEnabled[FM.setOf(cp)]) continue;
      if (cp === 0x20) hasSpace = true;
      var g = doc.glyphs[String(cp)];
      glyphs.push(new ot.Glyph({
        name: glyphName(cp),
        unicode: cp,
        unicodes: [cp],
        advanceWidth: Math.round(g.adv),
        path: contoursToPath(ot, flatten(cp, doc, 0, 0, 0, {}))
      }));
    }
    if (!hasSpace) {
      glyphs.splice(1, 0, new ot.Glyph({
        name: 'space', unicode: 0x20, unicodes: [0x20],
        advanceWidth: Math.round(upm * 0.3), path: new ot.Path()
      }));
    }

    var font = new ot.Font({
      familyName: m.family || 'My Font',
      styleName: m.style || 'Regular',
      unitsPerEm: upm,
      ascender: asc,
      descender: desc,
      glyphs: glyphs
    });

    // carry doc metrics into OS/2 (merged over opentype.js's guessed values,
    // without clobbering constructor-set fields) so export→import is lossless
    Object.assign(font.tables.os2, { sxHeight: m.xHeight, sCapHeight: m.capHeight });

    var lic = licenseNotice(m.license);
    font.names.version = { en: 'Version ' + (m.version || '1.000') };
    font.names.license = { en: lic.text };
    if (lic.url) font.names.licenseURL = { en: lic.url };
    if (m.author) {
      font.names.designer = { en: m.author };
      font.names.manufacturer = { en: m.author };
    }
    return font;
  }

  // ── sfnt post-processing: manual kern table ───────────────────
  // opentype.js 1.3.4 parses kern tables but never writes one, so the
  // pair list is injected into the compiled binary by hand.

  function tableChecksum(bytes, off, len) {
    var sum = 0;
    var padded = (len + 3) & ~3;
    for (var i = 0; i < padded; i += 4) {
      var v = 0;
      for (var b = 0; b < 4; b++) {
        v = (v << 8) | (off + i + b < off + len ? bytes[off + i + b] : 0);
      }
      sum = (sum + v) >>> 0;
    }
    return sum;
  }

  function makeKernTable(pairs) {
    // format 0, single horizontal subtable
    pairs.sort(function (a, b) { return (a.l - b.l) || (a.r - b.r); });
    if (pairs.length > 10000) pairs = pairs.slice(0, 10000); // uint16 length cap
    var n = pairs.length;
    var len = 4 + 14 + n * 6;
    var buf = new Uint8Array((len + 3) & ~3);
    var dv = new DataView(buf.buffer);
    dv.setUint16(0, 0);        // version
    dv.setUint16(2, 1);        // nTables
    dv.setUint16(4, 0);        // subtable version
    dv.setUint16(6, 14 + n * 6); // subtable length
    dv.setUint16(8, 1);        // coverage: horizontal
    dv.setUint16(10, n);
    var pow = 1, sel = 0;
    while (pow * 2 <= n) { pow *= 2; sel++; }
    dv.setUint16(12, pow * 6);
    dv.setUint16(14, sel);
    dv.setUint16(16, n * 6 - pow * 6);
    for (var i = 0; i < n; i++) {
      var o = 18 + i * 6;
      dv.setUint16(o, pairs[i].l);
      dv.setUint16(o + 2, pairs[i].r);
      dv.setInt16(o + 4, Math.max(-32768, Math.min(32767, pairs[i].v)));
    }
    return { bytes: buf, length: len };
  }

  function insertKernTable(sfntBuf, pairs) {
    var kern = makeKernTable(pairs);
    var src = new Uint8Array(sfntBuf);
    var sdv = new DataView(sfntBuf);
    var numTables = sdv.getUint16(4);
    var tables = [];
    var i;
    for (i = 0; i < numTables; i++) {
      var o = 12 + i * 16;
      tables.push({
        tag: String.fromCharCode(src[o], src[o + 1], src[o + 2], src[o + 3]),
        checksum: sdv.getUint32(o + 4),
        offset: sdv.getUint32(o + 8),
        length: sdv.getUint32(o + 12)
      });
    }
    if (tables.some(function (t) { return t.tag === 'kern'; })) return sfntBuf;
    tables.push({ tag: 'kern', checksum: tableChecksum(kern.bytes, 0, kern.length), length: kern.length, kern: kern.bytes });
    tables.sort(function (a, b) { return a.tag < b.tag ? -1 : (a.tag > b.tag ? 1 : 0); });

    var n = tables.length;
    var pad = function (x) { return (x + 3) & ~3; };
    var total = 12 + n * 16;
    for (i = 0; i < n; i++) total += pad(tables[i].length);
    var out = new Uint8Array(total);
    var odv = new DataView(out.buffer);
    odv.setUint32(0, sdv.getUint32(0)); // sfnt version
    odv.setUint16(4, n);
    var pow = 1, sel = 0;
    while (pow * 2 <= n) { pow *= 2; sel++; }
    odv.setUint16(6, pow * 16);
    odv.setUint16(8, sel);
    odv.setUint16(10, n * 16 - pow * 16);

    var off = 12 + n * 16;
    var headOff = -1;
    for (i = 0; i < n; i++) {
      var t = tables[i];
      var d = 12 + i * 16;
      for (var c = 0; c < 4; c++) out[d + c] = t.tag.charCodeAt(c);
      odv.setUint32(d + 4, t.checksum);
      odv.setUint32(d + 8, off);
      odv.setUint32(d + 12, t.length);
      if (t.kern) out.set(t.kern, off);
      else out.set(src.subarray(t.offset, t.offset + t.length), off);
      if (t.tag === 'head') headOff = off;
      off += pad(t.length);
    }
    // recompute head.checkSumAdjustment over the whole font
    if (headOff >= 0) {
      odv.setUint32(headOff + 8, 0);
      var sum = tableChecksum(out, 0, total);
      odv.setUint32(headOff + 8, (0xB1B0AFBA - sum) >>> 0);
    }
    return out.buffer;
  }

  function kernPairsByIndex(doc, font) {
    var cpToIdx = {};
    for (var i = 0; i < font.glyphs.length; i++) {
      var g = font.glyphs.get(i);
      var cps = (g.unicodes && g.unicodes.length) ? g.unicodes :
        (typeof g.unicode === 'number' ? [g.unicode] : []);
      for (var u = 0; u < cps.length; u++) {
        if (cpToIdx[cps[u]] === undefined) cpToIdx[cps[u]] = i;
      }
    }
    var pairs = [];
    for (var key in doc.kerning) {
      var v = doc.kerning[key];
      if (!v) continue;
      var parts = key.split(',');
      var l = cpToIdx[parseInt(parts[0], 10)];
      var r = cpToIdx[parseInt(parts[1], 10)];
      if (l === undefined || r === undefined) continue;
      pairs.push({ l: l, r: r, v: Math.round(v) });
    }
    return pairs;
  }

  function toTTF(doc) {
    var font = compile(doc);
    var buf = font.toArrayBuffer();
    var pairs = kernPairsByIndex(doc, font);
    if (pairs.length) buf = insertKernTable(buf, pairs);
    return buf;
  }

  // ── WOFF1 wrapper ─────────────────────────────────────────────

  function deflateZlib(bytes) {
    return Promise.resolve().then(function () {
      if (typeof CompressionStream === 'undefined') throw new Error('no CompressionStream');
      var s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    });
  }

  function toWOFF(ttfBuf) {
    return Promise.resolve().then(function () {
      var src = new Uint8Array(ttfBuf);
      var sdv = new DataView(ttfBuf);
      var flavor = sdv.getUint32(0);
      var numTables = sdv.getUint16(4);
      var pad = function (x) { return (x + 3) & ~3; };
      var entries = [];
      for (var i = 0; i < numTables; i++) {
        var o = 12 + i * 16;
        entries.push({
          tag: sdv.getUint32(o),
          checksum: sdv.getUint32(o + 4),
          offset: sdv.getUint32(o + 8),
          length: sdv.getUint32(o + 12)
        });
      }
      return Promise.all(entries.map(function (e) {
        var raw = src.subarray(e.offset, e.offset + e.length);
        return deflateZlib(raw).then(function (comp) {
          // spec: keep the table uncompressed when compression doesn't shrink it
          return { entry: e, data: comp.length < e.length ? comp : raw };
        });
      })).then(function (packed) {
        var totalSfnt = 12 + numTables * 16;
        var totalWoff = 44 + numTables * 20;
        for (var i = 0; i < packed.length; i++) {
          totalSfnt += pad(packed[i].entry.length);
          totalWoff += pad(packed[i].data.length);
        }
        var out = new Uint8Array(totalWoff);
        var odv = new DataView(out.buffer);
        odv.setUint32(0, 0x774F4646); // 'wOFF'
        odv.setUint32(4, flavor);
        odv.setUint32(8, totalWoff);
        odv.setUint16(12, numTables);
        odv.setUint16(14, 0);          // reserved
        odv.setUint32(16, totalSfnt);
        odv.setUint16(20, 1);          // majorVersion
        odv.setUint16(22, 0);          // minorVersion
        // metaOffset/metaLength/metaOrigLength/privOffset/privLength stay 0
        var off = 44 + numTables * 20;
        for (var t = 0; t < packed.length; t++) {
          var d = 44 + t * 20;
          var e = packed[t].entry;
          odv.setUint32(d, e.tag);
          odv.setUint32(d + 4, off);
          odv.setUint32(d + 8, packed[t].data.length);
          odv.setUint32(d + 12, e.length);
          odv.setUint32(d + 16, e.checksum);
          out.set(packed[t].data, off);
          off += pad(packed[t].data.length); // zero-padded to 4 bytes
        }
        return out.buffer;
      });
    });
  }

  // ── live preview ──────────────────────────────────────────────

  var PREVIEW_FAMILY = 'CarinoFontsPreview';
  var previewFace = null;
  var installSeq = 0; // only the newest overlapping install may touch document.fonts

  function previewInstall(doc) {
    return Promise.resolve().then(function () {
      if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
        throw new Error('FontFace API unavailable');
      }
      var seq = ++installSeq;
      var buf = toTTF(doc);
      var face = new FontFace(PREVIEW_FAMILY, buf);
      return face.load().then(function () {
        if (seq !== installSeq) return PREVIEW_FAMILY; // a newer install won
        if (previewFace) { try { document.fonts.delete(previewFace); } catch (e) {} }
        document.fonts.add(face);
        previewFace = face;
        return PREVIEW_FAMILY;
      });
    });
  }

  var FontBuild = {
    pixelToContours: pixelToContours,
    compile: compile,
    toTTF: toTTF,
    toWOFF: toWOFF,
    previewInstall: previewInstall,
    licenseNotice: licenseNotice
  };

  if (typeof window !== 'undefined') window.FontBuild = FontBuild;
  if (typeof module !== 'undefined' && module.exports) module.exports = FontBuild;
})();
