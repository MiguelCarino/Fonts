'use strict';
const assert = require('assert');
const path = require('path');
const FontModel = require(path.join(__dirname, '..', 'js', 'model.js'));

let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('PASS ' + name),
    (e) => { failed++; console.error('FAIL ' + name + ' — ' + (e && e.message)); }
  );
}

const run = async () => {

  await test('normalize(null/undefined/scalars) yields valid default doc', () => {
    for (const garbage of [null, undefined, 42, 'hello', true, [1, 2, 3]]) {
      const d = FontModel.normalize(garbage);
      assert.strictEqual(d.v, 1);
      assert.strictEqual(d.meta.family, 'My Font');
      assert.strictEqual(d.meta.license, 'OFL');
      assert.strictEqual(d.meta.upm, 1000);
      assert.deepStrictEqual(d.grid, { w: 16, h: 16, baseline: 12 });
      assert.deepStrictEqual(d.kerning, {});
      assert.deepStrictEqual(d.glyphs, {});
    }
  });

  await test('normalize clamps wrong-typed and out-of-range numerics', () => {
    const d = FontModel.normalize({
      meta: { upm: 'nope', ascender: Infinity, descender: 'x', license: 'GPL', family: 12345 },
      grid: { w: 9999, h: -3, baseline: 200 }
    });
    assert.strictEqual(d.meta.upm, 1000);
    assert.strictEqual(d.meta.ascender, 800);
    assert.strictEqual(d.meta.descender, -200);
    assert.strictEqual(d.meta.license, 'OFL');
    assert.strictEqual(d.meta.family, 'My Font');
    assert.strictEqual(d.grid.w, 64);
    assert.strictEqual(d.grid.h, 2);
    assert.strictEqual(d.grid.baseline, 2); // clamped to grid.h
  });

  await test('normalize repairs oversized/short/dirty px rows', () => {
    const d = FontModel.normalize({
      glyphs: { '65': { px: ['1'.repeat(40), '01x?1', 7, null] } }
    });
    const g = d.glyphs['65'];
    assert.strictEqual(g.px.length, 16);
    for (const row of g.px) assert.strictEqual(row.length, 16);
    assert.strictEqual(g.px[0], '1'.repeat(16));
    assert.strictEqual(g.px[1], '0100100000000000');
    assert.strictEqual(g.px[2], '0'.repeat(16));
  });

  await test('normalize drops bad codepoint keys, keeps valid ones', () => {
    const d = FontModel.normalize({
      glyphs: { abc: {}, '-5': {}, '1114112': {}, '65.5': {}, '65': { adv: 321 }, '66': 'junk' }
    });
    assert.deepStrictEqual(Object.keys(d.glyphs), ['65']);
    assert.strictEqual(d.glyphs['65'].adv, 321);
  });

  await test('normalize coerces kerning ints and drops bad pairs', () => {
    const d = FontModel.normalize({
      kerning: { '65,86': '-80.4', 'x,y': 5, '65': 3, '65,1114112': 1, '66,67': NaN, '70,71': 12.7 }
    });
    assert.deepStrictEqual(d.kerning, { '65,86': -80, '70,71': 13 });
  });

  await test('normalize drops malformed contours and components', () => {
    const d = FontModel.normalize({
      glyphs: {
        '65': {
          contours: [
            [{ x: 0, y: 0 }, { x: 10, y: 10, cx1: 1, cy1: 2, cx2: 3, cy2: 4 }],
            [{ x: 0, y: 0 }],                       // too short
            'nope',
            [{ x: 'a', y: 0 }, { x: NaN, y: 1 }]    // all points invalid
          ],
          components: [{ ref: 101, dx: 5, dy: -5 }, { ref: 'x' }, { ref: -1 }, null]
        }
      }
    });
    const g = d.glyphs['65'];
    assert.strictEqual(g.contours.length, 1);
    assert.deepStrictEqual(g.contours[0][1], { x: 10, y: 10, cx1: 1, cy1: 2, cx2: 3, cy2: 4 });
    assert.deepStrictEqual(g.components, [{ ref: 101, dx: 5, dy: -5 }]);
  });

  await test('normalize strips partial cubic handles to a line point', () => {
    const d = FontModel.normalize({
      glyphs: { '65': { contours: [[{ x: 0, y: 0, cx1: 1 }, { x: 5, y: 5 }]] } }
    });
    assert.deepStrictEqual(d.glyphs['65'].contours[0][0], { x: 0, y: 0 });
  });

  await test('ensureGlyph seeds adv/mode/px from grid + upm', () => {
    FontModel.load(FontModel.newProject());
    const g = FontModel.ensureGlyph(65);
    assert.strictEqual(g.adv, 500);
    assert.strictEqual(g.mode, 'pixel');
    assert.strictEqual(g.px.length, 16);
    for (const row of g.px) assert.strictEqual(row, '0'.repeat(16));
    assert.deepStrictEqual(g.contours, []);
    assert.deepStrictEqual(g.components, []);
    assert.strictEqual(FontModel.ensureGlyph(65), g); // idempotent
    assert.strictEqual(FontModel.getGlyph(65), g);
    assert.strictEqual(FontModel.getGlyph(66), null);
  });

  await test('serialize -> load round-trip is deep-equal', () => {
    FontModel.load(FontModel.newProject());
    FontModel.doc.meta.family = 'Round Trip';
    const g = FontModel.ensureGlyph(65);
    g.px[0] = '1010101010101010';
    g.mode = 'vector';
    g.contours.push([{ x: 0, y: 0 }, { x: 100, y: 200, cx1: 10, cy1: 20, cx2: 30, cy2: 40 }]);
    g.components.push({ ref: 101, dx: 3, dy: 4 });
    FontModel.doc.kerning['65,86'] = -80;
    const json = FontModel.serialize();
    const before = JSON.parse(json);
    FontModel.load(JSON.parse(json));
    assert.deepStrictEqual(FontModel.doc, before);
  });

  await test('undo/redo sequence', () => {
    FontModel.load(FontModel.newProject());
    FontModel.doc.meta.family = 'A'; FontModel.save();
    FontModel.doc.meta.family = 'B'; FontModel.save();
    assert.strictEqual(FontModel.doc.meta.family, 'B');
    FontModel.undo();
    assert.strictEqual(FontModel.doc.meta.family, 'A');
    FontModel.undo();
    assert.strictEqual(FontModel.doc.meta.family, 'My Font');
    FontModel.undo(); // past start = no-op
    assert.strictEqual(FontModel.doc.meta.family, 'My Font');
    FontModel.redo();
    assert.strictEqual(FontModel.doc.meta.family, 'A');
    FontModel.doc.meta.family = 'C'; FontModel.save(); // truncates redo tail
    FontModel.redo();
    assert.strictEqual(FontModel.doc.meta.family, 'C');
  });

  await test('save emits to onChange subscribers', () => {
    FontModel.load(FontModel.newProject());
    let calls = 0;
    FontModel.onChange(() => { calls++; });
    FontModel.save();
    assert.strictEqual(calls, 1);
  });

  await test('loadLocal returns null without localStorage', () => {
    assert.strictEqual(FontModel.loadLocal(), null);
  });

  await test('normalize seeds default sets and drops invalid entries', () => {
    const d = FontModel.normalize({});
    assert.deepStrictEqual(d.sets, ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A']);
    const d2 = FontModel.normalize({ sets: ['Cyrillic', 'Nope', 'Cyrillic', 42, 'Other'] });
    assert.deepStrictEqual(d2.sets, ['Cyrillic', 'Other']);
    const d3 = FontModel.normalize({ sets: ['Bogus'] });
    assert.deepStrictEqual(d3.sets, ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A']);
  });

  await test('setOf maps codepoints to sets', () => {
    assert.strictEqual(FontModel.setOf(0x41), 'Basic Latin');
    assert.strictEqual(FontModel.setOf(0x0416), 'Cyrillic');
    assert.strictEqual(FontModel.setOf(0x1F600), 'Other');
  });

  if (failed) { console.error(failed + ' test(s) failed'); process.exit(1); }
  console.log('ALL PASS');
};

run();
