'use strict';
// Standalone: node tests/import.test.js
const assert = require('assert');
const opentype = require('../vendor/opentype.min.js');
const FontImport = require('../js/import.js');

let failed = 0;
function T(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ' :: ' + e.message); }
}

const TT = 2 / 3;

// ---- fromBinary: build a real font, round-trip it ----

function buildFont() {
  const notdef = new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() });
  const pA = new opentype.Path();
  pA.moveTo(0, 0); pA.lineTo(500, 0); pA.lineTo(500, 700); pA.lineTo(0, 700); pA.close();
  const gA = new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path: pA });
  const pB = new opentype.Path();
  pB.moveTo(0, 0); pB.lineTo(300, 0); pB.quadraticCurveTo(450, 250, 300, 500); pB.lineTo(0, 500); pB.close();
  const gB = new opentype.Glyph({ name: 'B', unicode: 66, advanceWidth: 640, path: pB });
  return new opentype.Font({
    familyName: 'TestFam', styleName: 'Regular', unitsPerEm: 1000,
    ascender: 800, descender: -200, glyphs: [notdef, gA, gB]
  });
}

const buf = buildFont().toArrayBuffer();
const bdoc = FontImport.fromBinary(buf);

T('fromBinary glyph count (notdef skipped)', () => {
  assert.deepStrictEqual(Object.keys(bdoc.glyphs).sort(), ['65', '66']);
});

T('fromBinary metrics + names', () => {
  assert.strictEqual(bdoc.meta.upm, 1000);
  assert.strictEqual(bdoc.meta.ascender, 800);
  assert.strictEqual(bdoc.meta.descender, -200);
  assert.strictEqual(bdoc.meta.family, 'TestFam');
  assert.strictEqual(bdoc.meta.style, 'Regular');
  // no license notice in the name table -> safest default, never OFL
  assert.strictEqual(bdoc.meta.license, 'ARR');
});

T('fromBinary advances', () => {
  assert.strictEqual(bdoc.glyphs['65'].adv, 600);
  assert.strictEqual(bdoc.glyphs['66'].adv, 640);
  assert.strictEqual(bdoc.glyphs['65'].mode, 'vector');
});

T('fromBinary square contour (A)', () => {
  const cs = bdoc.glyphs['65'].contours;
  assert.strictEqual(cs.length, 1);
  assert.deepStrictEqual(cs[0], [
    { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 700 }, { x: 0, y: 700 }
  ]);
});

T('fromBinary curve anchors exact vs binary (B)', () => {
  // opentype.js writes CFF (cubic) outlines, converting our quad with the
  // same 2/3 rule and rounding to int: q=(450,250) between (300,0),(300,500)
  // -> c1=(400,167), c2=(400,333). fromBinary must carry these C values
  // through exactly. (Exact float 2/3 quad->cubic is asserted below via
  // svgPathToContours, which shares the converter.)
  const cs = bdoc.glyphs['66'].contours;
  assert.strictEqual(cs.length, 1);
  const curve = cs[0].find(a => a.cx1 !== undefined);
  assert.ok(curve, 'has a cubic anchor');
  assert.deepStrictEqual(curve, { x: 300, y: 500, cx1: 400, cy1: 167, cx2: 400, cy2: 333 });
});

// ---- fromSFD ----

const SFD = [
  'SplineFontDB: 3.2',
  'FontName: TestFont',
  'FamilyName: Test Family',
  'Ascent: 800',
  'Descent: 200',
  'BeginChars: 65536 2',
  'StartChar: A',
  'Encoding: 65 65 0',
  'Width: 600',
  'Flags: W',
  'UnknownJunk: ignore me',
  'Fore',
  'SplineSet',
  '0 0 m 1',
  ' 500 0 l 1',
  ' 500 700 l 1',
  ' 0 700 l 1',
  ' 0 0 l 1',
  'EndSplineSet',
  'EndChar',
  'StartChar: B',
  'Encoding: 66 66 1',
  'Width: 640',
  'Fore',
  'SplineSet',
  '100 0 m 0',
  ' 100 300 400 300 400 0 c 0',
  'EndSplineSet',
  'EndChar',
  'EndChars',
  'EndSplineFontDB:'
].join('\n');

const sdoc = FontImport.fromSFD(SFD);

T('fromSFD header metrics', () => {
  assert.strictEqual(sdoc.meta.family, 'Test Family');
  assert.strictEqual(sdoc.meta.upm, 1000); // Ascent + Descent
  assert.strictEqual(sdoc.meta.ascender, 800);
  assert.strictEqual(sdoc.meta.descender, -200);
});

T('fromSFD glyphs + widths', () => {
  assert.deepStrictEqual(Object.keys(sdoc.glyphs).sort(), ['65', '66']);
  assert.strictEqual(sdoc.glyphs['65'].adv, 600);
  assert.strictEqual(sdoc.glyphs['66'].adv, 640);
});

T('fromSFD line contour, closing dup dropped', () => {
  assert.deepStrictEqual(sdoc.glyphs['65'].contours, [[
    { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 700 }, { x: 0, y: 700 }
  ]]);
});

T('fromSFD cubic contour', () => {
  assert.deepStrictEqual(sdoc.glyphs['66'].contours, [[
    { x: 100, y: 0 },
    { x: 400, y: 0, cx1: 100, cy1: 300, cx2: 400, cy2: 300 }
  ]]);
});

// ---- svgPathToContours ----

T('svg quad->cubic exact', () => {
  const cs = FontImport.svgPathToContours('M0 0 L10 0 Q15 5 10 10 Z');
  assert.strictEqual(cs.length, 1);
  assert.deepStrictEqual(cs[0], [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    {
      x: 10, y: 10,
      cx1: 10 + TT * (15 - 10), cy1: 0 + TT * (5 - 0),
      cx2: 10 + TT * (15 - 10), cy2: 10 + TT * (5 - 10)
    }
  ]);
});

T('svg relative commands equal absolute', () => {
  const abs = FontImport.svgPathToContours('M0 0 L10 0 Q15 5 10 10 Z');
  const rel = FontImport.svgPathToContours('m0 0 l10 0 q5 5 0 10 z');
  assert.deepStrictEqual(rel, abs);
});

T('svg H/V + cubic + implicit lineto after M', () => {
  const cs = FontImport.svgPathToContours('M0 0 5 0 H10 V10 C10 20 0 20 0 10 Z');
  assert.deepStrictEqual(cs, [[
    { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
    { x: 0, y: 10, cx1: 10, cy1: 20, cx2: 0, cy2: 20 }
  ]]);
});

T('svg scale + flipY', () => {
  const cs = FontImport.svgPathToContours('M0 0 L10 5', 2, true);
  assert.deepStrictEqual(cs, [[{ x: 0, y: 0 }, { x: 20, y: -10 }]]);
});

// ---- malformed inputs never throw; unreadable input returns null so
// ---- callers never clobber the current project with a blank doc ----

T('fromBinary garbage buffer -> null', () => {
  assert.strictEqual(FontImport.fromBinary(new ArrayBuffer(16)), null);
});

T('fromBinary null -> null', () => {
  assert.strictEqual(FontImport.fromBinary(null), null);
});

T('fromSFD garbage -> empty doc, non-string -> null', () => {
  assert.deepStrictEqual(FontImport.fromSFD('total garbage\nno structure').glyphs, {});
  assert.strictEqual(FontImport.fromSFD(12345), null);
});

T('svg garbage -> empty', () => {
  assert.deepStrictEqual(FontImport.svgPathToContours('abc 12 blah'), []);
  assert.deepStrictEqual(FontImport.svgPathToContours(null), []);
  assert.deepStrictEqual(FontImport.svgPathToContours(''), []);
});

T('fromCfont bad json -> null', () => {
  assert.strictEqual(FontImport.fromCfont('{{{not json'), null);
  assert.strictEqual(FontImport.fromCfont('[1,2,3]'), null);
});

T('fromCfont valid json parses', () => {
  const d = FontImport.fromCfont(JSON.stringify({ v: 1, meta: { family: 'X' }, glyphs: {} }));
  assert.strictEqual(d.meta.family, 'X');
});

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('ALL PASS import.test.js');
