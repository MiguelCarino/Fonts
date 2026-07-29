(function () {
  'use strict';

  var T = 2 / 3; // quad->cubic: c1 = p + 2/3(q-p), c2 = e + 2/3(q-e)

  function getOpentype() {
    if (typeof window !== 'undefined' && window.opentype) return window.opentype;
    if (typeof opentype !== 'undefined') return opentype;
    if (typeof require === 'function') {
      try { return require('../vendor/opentype.min.js'); } catch (e) {}
    }
    return null;
  }

  function getFontModel() {
    if (typeof window !== 'undefined' && window.FontModel) return window.FontModel;
    if (typeof FontModel !== 'undefined') return FontModel;
    if (typeof require === 'function') {
      try { return require('./model.js'); } catch (e) {}
    }
    return null;
  }

  function blankDoc() {
    return {
      v: 1,
      meta: {
        family: 'Untitled', style: 'Regular', author: '', version: '1.000',
        license: 'OFL', upm: 1000, ascender: 800, descender: -200,
        xHeight: 500, capHeight: 700
      },
      grid: { w: 16, h: 16, baseline: 12 },
      kerning: {},
      glyphs: {}
    };
  }

  // Drop a duplicated closing point, moving its arriving handles onto the
  // first anchor (which describes the closing segment in the doc model).
  function finishContour(pts) {
    if (pts.length > 1) {
      var f = pts[0], l = pts[pts.length - 1];
      if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
        if (l.cx1 !== undefined) {
          f.cx1 = l.cx1; f.cy1 = l.cy1; f.cx2 = l.cx2; f.cy2 = l.cy2;
        }
        pts.pop();
      }
    }
    return pts;
  }

  function quadAnchor(px, py, qx, qy, ex, ey) {
    return {
      x: ex, y: ey,
      cx1: px + T * (qx - px), cy1: py + T * (qy - py),
      cx2: ex + T * (qx - ex), cy2: ey + T * (qy - ey)
    };
  }

  function commandsToContours(cmds) {
    var contours = [], cur = null, px = 0, py = 0;
    for (var i = 0; i < cmds.length; i++) {
      var c = cmds[i];
      if (c.type === 'M') {
        if (cur && cur.length > 1) contours.push(finishContour(cur));
        cur = [{ x: c.x, y: c.y }];
        px = c.x; py = c.y;
      } else if (!cur) {
        continue;
      } else if (c.type === 'L') {
        cur.push({ x: c.x, y: c.y }); px = c.x; py = c.y;
      } else if (c.type === 'C') {
        cur.push({ x: c.x, y: c.y, cx1: c.x1, cy1: c.y1, cx2: c.x2, cy2: c.y2 });
        px = c.x; py = c.y;
      } else if (c.type === 'Q') {
        cur.push(quadAnchor(px, py, c.x1, c.y1, c.x, c.y));
        px = c.x; py = c.y;
      } else if (c.type === 'Z') {
        if (cur.length > 1) contours.push(finishContour(cur));
        cur = null;
      }
    }
    if (cur && cur.length > 1) contours.push(finishContour(cur));
    return contours;
  }

  function nameStr(names, key) {
    var n = names && (names[key] ||
      (names.windows && names.windows[key]) ||
      (names.macintosh && names.macintosh[key]) ||
      (names.unicode && names.unicode[key]));
    if (!n) return '';
    if (typeof n === 'string') return n;
    var ks = Object.keys(n);
    return n.en || (ks.length ? n[ks[0]] : '') || '';
  }

  // Map the app's own embedded license notices back to their ids; anything
  // absent/unrecognized defaults to ARR (the safe, most-restrictive choice)
  // so an unknown imported font is never presented as OFL.
  function licenseFromNames(names) {
    var t = nameStr(names, 'license');
    if (/SIL Open Font License/i.test(t)) return 'OFL';
    if (/public domain/i.test(t)) return 'CC0';
    return 'ARR';
  }

  // Import functions return null on unreadable input (never a blank doc) so
  // callers can refuse to clobber the current project.
  function fromBinary(arrayBuffer) {
    var doc = blankDoc();
    try {
      var ot = getOpentype();
      if (!ot || !arrayBuffer) return null;
      var font = ot.parse(arrayBuffer);

      if (font.unitsPerEm > 0) doc.meta.upm = font.unitsPerEm;
      if (typeof font.ascender === 'number' && font.ascender) doc.meta.ascender = font.ascender;
      if (typeof font.descender === 'number' && font.descender) doc.meta.descender = font.descender;
      var os2 = font.tables && font.tables.os2;
      doc.meta.xHeight = (os2 && os2.sxHeight > 0) ? os2.sxHeight : Math.round(doc.meta.upm * 0.5);
      doc.meta.capHeight = (os2 && os2.sCapHeight > 0) ? os2.sCapHeight : Math.round(doc.meta.upm * 0.7);
      doc.meta.family = nameStr(font.names, 'fontFamily') || doc.meta.family;
      doc.meta.style = nameStr(font.names, 'fontSubfamily') || doc.meta.style;
      doc.meta.version = nameStr(font.names, 'version') || doc.meta.version;
      doc.meta.license = licenseFromNames(font.names);

      var idxToCp = {}, glyphByCp = {};
      for (var i = 0; i < font.glyphs.length; i++) {
        var g = font.glyphs.get(i);
        var path = g.path; // getter triggers lazy glyf/CFF load
        var cps = (g.unicodes && g.unicodes.length) ? g.unicodes :
          (typeof g.unicode === 'number' ? [g.unicode] : []);
        var real = [];
        for (var u = 0; u < cps.length; u++) if (cps[u] > 0) real.push(cps[u]);
        if (!real.length) continue;
        var entry = {
          adv: (typeof g.advanceWidth === 'number') ? g.advanceWidth : Math.round(doc.meta.upm / 2),
          mode: 'vector',
          contours: commandsToContours((path && path.commands) || [])
        };
        idxToCp[(g.index !== undefined) ? g.index : i] = real[0];
        for (var r = 0; r < real.length; r++) {
          doc.glyphs[String(real[r])] = r === 0 ? entry : JSON.parse(JSON.stringify(entry));
          glyphByCp[real[r]] = g;
        }
      }

      var got = false;
      var kp = font.kerningPairs;
      if (kp) {
        for (var key in kp) {
          var ab = key.split(',');
          var l = idxToCp[ab[0]], rr = idxToCp[ab[1]];
          if (l && rr && kp[key]) { doc.kerning[l + ',' + rr] = Math.round(kp[key]); got = true; }
        }
      }
      if (!got) {
        // kern table empty (e.g. GPOS-only): sample getKerningValue over the
        // imported cmap. Cap the scan at the first 128 codepoints (16 384
        // lookups) so large fonts import in reasonable time.
        try {
          var all = Object.keys(glyphByCp).map(Number).sort(function (a, b) { return a - b; }).slice(0, 128);
          for (var a = 0; a < all.length; a++) {
            for (var b = 0; b < all.length; b++) {
              var v = font.getKerningValue(glyphByCp[all[a]], glyphByCp[all[b]]);
              if (v) doc.kerning[all[a] + ',' + all[b]] = Math.round(v);
            }
          }
        } catch (e) {}
      }
      return doc;
    } catch (e) {
      return null;
    }
  }

  function fromSFD(text) {
    var doc = blankDoc();
    try {
      if (typeof text !== 'string') return null;
      var lines = text.split(/\r?\n/);
      var ascent = null, descent = null, em = null;
      var ch = null, inSpline = false;

      function commitContour() {
        if (ch && ch.cur && ch.cur.length > 1) ch.contours.push(finishContour(ch.cur));
        if (ch) ch.cur = null;
      }

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        if (!ch) {
          if (line.indexOf('FamilyName:') === 0) doc.meta.family = line.slice(11).trim() || doc.meta.family;
          else if (line.indexOf('Ascent:') === 0) ascent = parseFloat(line.slice(7));
          else if (line.indexOf('Descent:') === 0) descent = parseFloat(line.slice(8));
          else if (line.indexOf('EM:') === 0) em = parseFloat(line.slice(3));
          else if (line.indexOf('StartChar:') === 0) {
            ch = { cp: -1, width: null, contours: [], cur: null };
            inSpline = false;
          }
          continue;
        }

        if (line.indexOf('StartChar:') === 0) { // unterminated previous block
          ch = { cp: -1, width: null, contours: [], cur: null };
          inSpline = false;
        } else if (line.indexOf('Encoding:') === 0) {
          var enc = line.slice(9).trim().split(/\s+/);
          var cp = parseInt(enc.length > 1 ? enc[1] : enc[0], 10);
          if (isFinite(cp)) ch.cp = cp;
        } else if (line.indexOf('Width:') === 0) {
          ch.width = parseFloat(line.slice(6));
        } else if (line === 'SplineSet') {
          inSpline = true;
        } else if (line === 'EndSplineSet') {
          commitContour();
          inSpline = false;
        } else if (line === 'EndChar') {
          commitContour();
          if (ch.cp > 0) {
            doc.glyphs[String(ch.cp)] = {
              adv: isFinite(ch.width) && ch.width !== null ? ch.width : Math.round(doc.meta.upm / 2),
              mode: 'vector',
              contours: ch.contours
            };
          }
          ch = null;
          inSpline = false;
        } else if (inSpline) {
          var tok = line.split(/\s+/);
          var op = -1, opc = '';
          for (var t = 0; t < tok.length; t++) {
            if (tok[t] === 'm' || tok[t] === 'l' || tok[t] === 'c') { op = t; opc = tok[t]; break; }
          }
          if (op < 0) continue;
          var n = [];
          for (var k = 0; k < op; k++) n.push(parseFloat(tok[k]));
          if (opc === 'm' && n.length >= 2) {
            commitContour();
            ch.cur = [{ x: n[0], y: n[1] }];
          } else if (opc === 'l' && n.length >= 2 && ch.cur) {
            ch.cur.push({ x: n[0], y: n[1] });
          } else if (opc === 'c' && n.length >= 6 && ch.cur) {
            ch.cur.push({ x: n[4], y: n[5], cx1: n[0], cy1: n[1], cx2: n[2], cy2: n[3] });
          }
        }
      }

      if (isFinite(em) && em > 0) doc.meta.upm = em;
      else if (isFinite(ascent) && isFinite(descent) && ascent + descent > 0) doc.meta.upm = ascent + descent;
      if (isFinite(ascent) && ascent) doc.meta.ascender = ascent;
      if (isFinite(descent) && descent) doc.meta.descender = -descent;
      doc.meta.xHeight = Math.round(doc.meta.upm * 0.5);
      doc.meta.capHeight = Math.round(doc.meta.upm * 0.7);
      return doc;
    } catch (e) {
      return null;
    }
  }

  function svgPathToContours(d, scale, flipY) {
    if (scale === undefined || scale === null) scale = 1;
    var contours = [];
    if (typeof d !== 'string') return contours;
    try {
      var toks = d.match(/[MmLlHhVvCcQqZz]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) || [];
      var i = 0, cmd = '', cur = null;
      var cx = 0, cy = 0, sx = 0, sy = 0;
      var bad = false;

      function num() {
        var v = parseFloat(toks[i++]);
        if (!isFinite(v)) bad = true;
        return v;
      }
      function push(pt) {
        if (!cur) cur = [{ x: cx, y: cy }]; // draw after Z restarts at subpath start
        cur.push(pt);
        cx = pt.x; cy = pt.y;
      }
      function closeCur() {
        if (cur && cur.length > 1) contours.push(finishContour(cur));
        cur = null;
        cx = sx; cy = sy;
      }

      while (i < toks.length && !bad) {
        var t = toks[i];
        if (/^[A-Za-z]$/.test(t)) {
          cmd = t; i++;
          if (cmd === 'Z' || cmd === 'z') { closeCur(); cmd = ''; }
          continue;
        }
        if (!cmd) break;
        var rel = cmd >= 'a';
        var x, y, x1, y1;
        switch (cmd.toUpperCase()) {
          case 'M':
            x = num(); y = num(); if (bad) break;
            if (rel) { x += cx; y += cy; }
            closeCur();
            cur = [{ x: x, y: y }];
            cx = sx = x; cy = sy = y;
            cmd = rel ? 'l' : 'L'; // implicit pairs are linetos
            break;
          case 'L':
            x = num(); y = num(); if (bad) break;
            if (rel) { x += cx; y += cy; }
            push({ x: x, y: y });
            break;
          case 'H':
            x = num(); if (bad) break;
            if (rel) x += cx;
            push({ x: x, y: cy });
            break;
          case 'V':
            y = num(); if (bad) break;
            if (rel) y += cy;
            push({ x: cx, y: y });
            break;
          case 'C':
            x1 = num(); y1 = num();
            var x2 = num(), y2 = num();
            x = num(); y = num(); if (bad) break;
            if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
            push({ x: x, y: y, cx1: x1, cy1: y1, cx2: x2, cy2: y2 });
            break;
          case 'Q':
            x1 = num(); y1 = num();
            x = num(); y = num(); if (bad) break;
            if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
            push(quadAnchor(cx, cy, x1, y1, x, y));
            break;
          default:
            bad = true;
        }
      }
      closeCur();

      var ym = flipY ? -1 : 1;
      function nz(v) { return v === 0 ? 0 : v; } // avoid -0 from flipY
      for (var c = 0; c < contours.length; c++) {
        for (var p = 0; p < contours[c].length; p++) {
          var a = contours[c][p];
          a.x = nz(a.x * scale); a.y = nz(a.y * scale * ym);
          if (a.cx1 !== undefined) {
            a.cx1 = nz(a.cx1 * scale); a.cy1 = nz(a.cy1 * scale * ym);
            a.cx2 = nz(a.cx2 * scale); a.cy2 = nz(a.cy2 * scale * ym);
          }
        }
      }
      return contours;
    } catch (e) {
      return [];
    }
  }

  function fromCfont(jsonText) {
    try {
      var raw = JSON.parse(jsonText);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      var FM = getFontModel();
      return (FM && FM.normalize) ? FM.normalize(raw) : raw;
    } catch (e) {
      return null;
    }
  }

  var FontImport = {
    fromBinary: fromBinary,
    fromSFD: fromSFD,
    svgPathToContours: svgPathToContours,
    fromCfont: fromCfont
  };

  if (typeof window !== 'undefined') window.FontImport = FontImport;
  if (typeof module !== 'undefined' && module.exports) module.exports = FontImport;
})();
