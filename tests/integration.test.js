'use strict';
// Standalone: node tests/integration.test.js
// End-to-end: model + fontbuild + import together — build a doc with a pixel
// glyph, a vector glyph, a component glyph and kerning; compile; parse back.
const assert = require('assert');
const zlib = require('zlib');
const opentype = require('../vendor/opentype.min.js');
const FontModel = require('../js/model.js');
const FontBuild = require('../js/fontbuild.js');
const FontImport = require('../js/import.js');

let failed = 0;
function T(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('PASS ' + name),
    (e) => { failed++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); }
  );
}

// y-up shoelace: negative signed area = clockwise = correct outer winding
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function buildDoc() {
  FontModel.load(FontModel.newProject());
  const doc = FontModel.doc;
  doc.meta.family = 'IntegTest';
  doc.meta.style = 'Regular';
  doc.meta.author = 'Tester';
  doc.meta.license = 'OFL';

  // pixel glyph H (U+0048): two 2x6 stems + crossbar (merge-friendly shapes)
  const H = FontModel.ensureGlyph(72);
  for (let r = 6; r < 12; r++) {
    H.px[r] = '1100000110000000'.slice(0, 16);
  }
  H.px[9] = '1111111110000000';
  H.adv = 620;

  // vector glyph A (U+0041): square + one cubic segment contour
  const A = FontModel.ensureGlyph(65);
  A.mode = 'vector';
  A.contours = [
    [{ x: 0, y: 0 }, { x: 0, y: 700 }, { x: 500, y: 700 }, { x: 500, y: 0 }],
    [{ x: 600, y: 0 },
     { x: 900, y: 0, cx1: 700, cy1: 300, cx2: 800, cy2: 300 }]
  ];
  A.adv = 950;

  // component glyph Á (U+00C1): references A shifted up-right
  const AA = FontModel.ensureGlyph(193);
  AA.mode = 'vector';
  AA.contours = [];
  AA.components = [{ ref: 65, dx: 25, dy: 50 }];
  AA.adv = 950;

  doc.kerning['65,72'] = -50;
  return doc;
}

const run = async () => {

  await T('pixelToContours: single cell -> one clockwise rect', () => {
    const doc = FontModel.normalize({});
    const g = { adv: 500, mode: 'pixel', px: [], contours: [], components: [] };
    for (let r = 0; r < 16; r++) g.px.push('0'.repeat(16));
    g.px[11] = '0100000000000000';
    const cs = FontBuild.pixelToContours(g, doc);
    assert.strictEqual(cs.length, 1);
    assert.strictEqual(cs[0].length, 4);
    assert.ok(signedArea(cs[0]) < 0, 'outer contour must be clockwise (y-up)');
    // baseline row 12 => row 11 sits on the baseline: y in [0, cell]
    const cell = 1000 / 16;
    const ys = cs[0].map(p => p.y).sort((a, b) => a - b);
    assert.strictEqual(ys[0], 0);
    assert.strictEqual(ys[3], cell);
  });

  await T('pixelToContours: adjacent cells merge into one rect', () => {
    const doc = FontModel.normalize({});
    const g = { adv: 500, mode: 'pixel', px: [], contours: [], components: [] };
    for (let r = 0; r < 16; r++) g.px.push('0'.repeat(16));
    g.px[10] = '0111000000000000';
    g.px[11] = '0111000000000000';
    const cs = FontBuild.pixelToContours(g, doc);
    assert.strictEqual(cs.length, 1, '3x2 block should be a single merged rect');
    const cell = 1000 / 16;
    const xs = cs[0].map(p => p.x);
    assert.strictEqual(Math.min(...xs), cell);
    assert.strictEqual(Math.max(...xs), 4 * cell);
  });

  const doc = buildDoc();
  let ttf, parsed;

  await T('compile + toTTF produces a parseable font', () => {
    ttf = FontBuild.toTTF(doc);
    assert.ok(ttf instanceof ArrayBuffer && ttf.byteLength > 0);
    parsed = opentype.parse(ttf);
    assert.ok(parsed.glyphs.length >= 5); // .notdef, space, A, H, Aacute
  });

  await T('parsed metrics, cmap and advances round-trip', () => {
    assert.strictEqual(parsed.unitsPerEm, 1000);
    // doc metrics must reach OS/2 (not opentype.js's glyph-bbox guesses)
    assert.strictEqual(parsed.tables.os2.sxHeight, doc.meta.xHeight);
    assert.strictEqual(parsed.tables.os2.sCapHeight, doc.meta.capHeight);
    const gA = parsed.charToGlyph('A');
    const gH = parsed.charToGlyph('H');
    assert.ok(gA && gA.name !== '.notdef', 'cmap maps A');
    assert.ok(gH && gH.name !== '.notdef', 'cmap maps H');
    assert.strictEqual(gA.advanceWidth, 950);
    assert.strictEqual(gH.advanceWidth, 620);
    assert.ok(gH.path.commands.length > 0, 'pixel glyph compiled to outline');
    assert.ok(gA.path.commands.some(c => c.type === 'C'), 'cubic survived');
  });

  await T('name table: family/style/license/licenseURL/designer', () => {
    assert.strictEqual(parsed.names.fontFamily.en, 'IntegTest');
    assert.strictEqual(parsed.names.fontSubfamily.en, 'Regular');
    assert.ok(/SIL Open Font License/.test(parsed.names.license.en));
    assert.ok(/openfontlicense/.test(parsed.names.licenseURL.en));
    assert.strictEqual(parsed.names.designer.en, 'Tester');
  });

  await T('component glyph flattened with dx/dy offset', () => {
    const gAA = parsed.charToGlyph('Á');
    assert.ok(gAA && gAA.path.commands.length > 0, 'Aacute has an outline');
    const gA = parsed.charToGlyph('A');
    const min = cmds => Math.min(...cmds.filter(c => c.x !== undefined).map(c => c.x));
    assert.strictEqual(min(gAA.path.commands), min(gA.path.commands) + 25);
  });

  await T('kerning pair survives via manual kern table', () => {
    const gA = parsed.charToGlyph('A');
    const gH = parsed.charToGlyph('H');
    assert.strictEqual(parsed.getKerningValue(gA, gH), -50);
  });

  await T('FontImport.fromBinary re-imports the compiled font', () => {
    const back = FontImport.fromBinary(ttf);
    assert.strictEqual(back.meta.family, 'IntegTest');
    assert.strictEqual(back.meta.license, 'OFL', 'license id round-trips');
    assert.strictEqual(back.meta.xHeight, doc.meta.xHeight);
    assert.strictEqual(back.meta.capHeight, doc.meta.capHeight);
    assert.ok(back.glyphs['65'] && back.glyphs['72'] && back.glyphs['193']);
    assert.strictEqual(back.glyphs['65'].adv, 950);
    assert.strictEqual(back.glyphs['65'].mode, 'vector');
    assert.ok(back.glyphs['65'].contours.length >= 2);
    assert.strictEqual(back.kerning['65,72'], -50);
    // and the re-imported doc normalizes + compiles again
    const doc2 = FontModel.normalize(back);
    const ttf2 = FontBuild.toTTF(doc2);
    assert.ok(opentype.parse(ttf2).charToGlyph('A').advanceWidth === 950);
  });

  await T('toWOFF: signature, header, parse after manual inflate', async () => {
    const woff = await FontBuild.toWOFF(ttf);
    const dv = new DataView(woff);
    assert.strictEqual(dv.getUint32(0), 0x774F4646, 'wOFF signature');
    assert.strictEqual(dv.getUint32(8), woff.byteLength, 'header length field');
    const numTables = dv.getUint16(12);
    // rebuild the sfnt by hand and parse it
    const pad = n => (n + 3) & ~3;
    const entries = [];
    for (let i = 0; i < numTables; i++) {
      const o = 44 + i * 20;
      entries.push({
        tag: dv.getUint32(o), offset: dv.getUint32(o + 4),
        compLen: dv.getUint32(o + 8), origLen: dv.getUint32(o + 12),
        checksum: dv.getUint32(o + 16)
      });
    }
    let total = 12 + numTables * 16;
    for (const e of entries) total += pad(e.origLen);
    assert.strictEqual(dv.getUint32(16), total, 'totalSfntSize');
    const out = new Uint8Array(total);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, dv.getUint32(4));
    odv.setUint16(4, numTables);
    let pow = 1, sel = 0;
    while (pow * 2 <= numTables) { pow *= 2; sel++; }
    odv.setUint16(6, pow * 16);
    odv.setUint16(8, sel);
    odv.setUint16(10, numTables * 16 - pow * 16);
    let off = 12 + numTables * 16;
    entries.forEach((e, t) => {
      const raw = new Uint8Array(woff, e.offset, e.compLen);
      const data = e.compLen < e.origLen ? new Uint8Array(zlib.inflateSync(raw)) : raw;
      assert.strictEqual(data.length, e.origLen, 'table inflates to origLen');
      const d = 12 + t * 16;
      odv.setUint32(d, e.tag);
      odv.setUint32(d + 4, e.checksum);
      odv.setUint32(d + 8, off);
      odv.setUint32(d + 12, e.origLen);
      out.set(data, off);
      off += pad(e.origLen);
    });
    const reparsed = opentype.parse(out.buffer);
    assert.strictEqual(reparsed.names.fontFamily.en, 'IntegTest');
    assert.strictEqual(reparsed.charToGlyph('A').advanceWidth, 950);
  });

  await T('licenseNotice covers all three ids + fallback', () => {
    for (const id of ['OFL', 'CC0', 'ARR']) {
      const n = FontBuild.licenseNotice(id);
      assert.ok(n.name && n.text && typeof n.url === 'string');
    }
    assert.strictEqual(FontBuild.licenseNotice('bogus').name, FontBuild.licenseNotice('OFL').name);
  });

  await T('doc.sets filters the compiled font (export subsetting)', () => {
    const px = [];
    for (let r = 0; r < 16; r++) px.push(r < 12 ? '1111111111111111' : '0000000000000000');
    const mk = () => ({ adv: 600, mode: 'pixel', px: px.slice(), contours: [], components: [] });
    const d = FontModel.normalize({
      meta: { family: 'SetFilter' },
      sets: ['Basic Latin'],
      glyphs: { 65: mk(), 1046: mk() }   // A + Ж (Cyrillic)
    });
    const only = opentype.parse(FontBuild.toTTF(d));
    assert.ok(only.charToGlyph('A').name !== '.notdef', 'enabled set exported');
    assert.strictEqual(only.charToGlyph('Ж').name, '.notdef', 'disabled set excluded');
    d.sets.push('Cyrillic');
    const both = opentype.parse(FontBuild.toTTF(d));
    assert.ok(both.charToGlyph('Ж').name !== '.notdef', 'enabling the set restores it');
  });

  if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
  console.log('ALL PASS integration.test.js');
};

run();
