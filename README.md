# Carino Fonts

Browser font editor at [fonts.carino.systems](https://fonts.carino.systems).
Draw glyphs pixel-by-pixel or with a vector pen, kern them, preview live, and
export a working TTF/WOFF — entirely client-side. Nothing you draw ever leaves
your machine: no build step, no CDN, no network calls, everything vendored.

## Features by version

All three versions live in this one codebase.

**v1 — pixel fonts**
- Pixel-mode glyph editing on a per-font cell grid (paint/erase/drag, shift,
  invert, auto-fit advance, editable grid size + baseline)
- Glyphs home: Create a new font or Load one (.cfont, TTF, OTF, WOFF,
  FontForge .sfd) as an editable project
- Unicode sets panel: toggle any set on/off — enabled sets are visible,
  editable and included in exports; disabled sets stay in the project but
  are left out of the font file (built-in subsetting)
- Live preview via the FontFace API
- TTF / WOFF / `.cfont` (JSON project) export with a license picker
- localStorage autosave on every edit
- Single-page app: the Glyphs home is the whole UI — the glyph editor
  (opens on glyph click), Spacing, Preview and Export are all popups from
  buttons living in the shared navbar (live FontFace preview + waterfall; metadata, license picker,
  TTF/WOFF/.cfont downloads)
- Sets picker popup: compact status cells (gold dot = on); set blocks are collapsible

**v2 — vector fonts**
- Vector pen editor: cubic contours, corner/smooth anchors, point insert/
  delete, snap grid, pan/zoom camera, draggable advance guide
- Components (glyph references with dx/dy) rendered and flattened at compile
- TTF/OTF import to edit existing fonts; FontForge `.sfd` import (subset)
- Per-glyph SVG path paste
- Kerning/spacing tab: drag between glyphs to kern, pair table, per-glyph
  advance editing

**v3 — polish**
- Onion-skin reference ghost in the vector editor
- Waterfall proof (8–72 px) in the preview tab
- Batch accent generation from base + mark components (~30 Latin-1 combos)
- Auto-fit advance widths

## Format matrix

| Format | Open/import | Export | Notes |
|---|---|---|---|
| `.cfont` | yes | yes | native JSON project — lossless, re-editable |
| TTF | yes | yes | import converts outlines to editable vector glyphs |
| OTF | yes | no | CFF outlines are converted to cubic contours on import |
| WOFF (1) | yes (Load) | yes | zlib per table via CompressionStream |
| `.sfd` | yes (subset) | no | FontForge: header metrics + SplineSet m/l/c |
| SVG path | per glyph | no | paste a `d` string into the vector editor |

## Your fonts are yours

Fonts you make here belong entirely to you. The AGPL-3.0 license on this
repository covers the **app code only** — it puts no claim whatsoever on your
output. The export tab lets you embed your choice of license in the font's
name table:

- **SIL Open Font License 1.1** — free for anyone to use and modify;
  derivatives stay open
- **CC0 1.0** — public domain, no rights reserved
- **All Rights Reserved** — you keep every right

## Vendored code

`vendor/opentype.min.js` — [opentype.js](https://github.com/opentypejs/opentype.js)
1.3.4, MIT (see [`vendor/LICENSE.opentype`](vendor/LICENSE.opentype) and
[`vendor/README.md`](vendor/README.md)). Everything else is dependency-free
vanilla JS.

## Local dev

```sh
python3 -m http.server
# open http://localhost:8000
```

No build step. Tests are plain node scripts:

```sh
sh tests/run.sh        # or: node tests/model.test.js etc.
```
