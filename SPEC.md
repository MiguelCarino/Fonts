# Carino Fonts — build spec (contract for all modules)

Client-side font editor at fonts.carino.systems. Vanilla JS + CSS, no build step,
no CDN — everything vendored. Fleet conventions: gold `#eab308` on `#050505`,
shared `carino-navbar.js` (data-app="Fonts"), self-hosted fonts via
`fonts/carino-fonts.css`, type-scale tokens (see Styling). License: AGPL-3.0 for
the app; user-created fonts belong entirely to their creators.

## Product (three versions, all in this codebase)

- **v1**: pixel-mode glyph editing (cell grid per glyph), Glyphs home tab with
  Create/Load and a unicode-sets panel (enabled sets are visible, editable AND
  exported — toggling sets off subsets the export), live preview popup
  (FontFace), TTF/WOFF/.cfont export popup with license picker, localStorage
  autosave.
- **v2**: vector pen editor (cubic contours, point editing), components
  (glyph references), TTF/OTF import to edit existing fonts, FontForge .sfd
  import (subset), per-glyph SVG path paste, kerning/spacing popup.
- **v3**: onion-skin reference ghost, waterfall proof in preview, batch accent
  generation from components, auto-fit advance widths.

## Files & load order (index.html loads exactly this order)

```
vendor/opentype.min.js   UMD; exposes window.opentype  (DO NOT EDIT)
js/model.js              window.FontModel
js/fontbuild.js          window.FontBuild
js/import.js             window.FontImport
js/ui-shared.js          window.UI
js/ui-glyphmap.js        window.UIGlyphMap
js/ui-pixel.js           window.UIPixel
js/ui-vector.js          window.UIVector
js/ui-spacing.js         window.UISpacing
js/ui-preview.js         window.UIPreview
js/ui-export.js          window.UIExport
js/app.js                boot + section popups + keyboard
```

Each file is plain script (no modules/imports), strict-mode IIFE that assigns its
one global. A later file may use any earlier global at *call* time, and only
`opentype` at *load* time.

## Data model (the single source of truth; owned by FontModel.doc)

```js
doc = {
  v: 1,
  meta: {
    family: "My Font", style: "Regular", author: "", version: "1.000",
    license: "OFL",              // "OFL" | "CC0" | "ARR"
    upm: 1000, ascender: 800, descender: -200, xHeight: 500, capHeight: 700
  },
  sets: ["Basic Latin", ...],             // enabled unicode sets (FontModel.SETS
                                          // names + "Other"); glyphs in disabled
                                          // sets stay in the doc but are hidden
                                          // in the map and EXCLUDED from
                                          // TTF/WOFF export
  grid: { w: 16, h: 16, baseline: 12 },   // pixel grid; baseline = row index
                                          // (rows 0..baseline-1 above baseline)
  kerning: { "65,86": -80 },              // "leftCp,rightCp" -> units (int)
  glyphs: {
    "65": {                               // key = DECIMAL codepoint as string
      adv: 600,                           // advance width in units (int)
      mode: "pixel",                      // "pixel" | "vector"
      px: ["0000111100000000", ...],      // grid.h strings of grid.w chars 0/1,
                                          // row 0 = TOP row
      contours: [ [ {x,y}, {x,y,cx1,cy1,cx2,cy2}, ... ], ... ],
                                          // vector: each contour = array of
                                          // ON-CURVE anchors; optional cx1..cy2
                                          // = cubic control points of the
                                          // segment ARRIVING from the previous
                                          // anchor (wrap: first anchor's handles
                                          // describe the closing segment).
                                          // No handles => straight line.
      components: [ { ref: 101, dx: 0, dy: 0 } ]   // ref = decimal codepoint
    }
  }
}
```

Pixel→units mapping: `cell = meta.upm / grid.h` (float; round only at compile).
Cell (col,row) covers x ∈ [col*cell, (col+1)*cell], y ∈
[(grid.baseline-row-1)*cell, (grid.baseline-row)*cell] (so the row at index
baseline-1 sits on the baseline; rows ≥ baseline are descender).

## Module contracts

### FontModel (js/model.js)
- `FontModel.doc` — current project (never reassign silently; use load()).
- `newProject() -> doc` (seeds .notdef nothing special; empty glyphs map ok)
- `SETS` ([name, from, to] table), `DEFAULT_SETS`, `setOf(cp) -> name|'Other'` —
  the canonical unicode-set table shared by the map and the compiler.
- `normalize(raw) -> doc` — accept any parsed JSON, clamp/repair every field,
  drop malformed glyphs/contours; ALWAYS run on anything loaded.
- `serialize() -> string` (JSON of doc), `load(doc)` (normalize + emit).
- `getGlyph(cp) / ensureGlyph(cp)` (cp = number; ensure seeds
  `{adv: round(upm*0.5), mode:'pixel', px: blank grid}`).
- `save()` — records undo history AND mirrors to localStorage
  (`carino-fonts-doc`); then `emit()`.
- `undo() / redo()` (serialized-JSON history, cap 100, like Topo).
- `onChange(fn)` — subscribe; `emit()` calls all (UI modules re-render).
- `loadLocal() -> doc|null`.
- Node-safe: guard all `window`/`localStorage`/`CompressionStream` access so the
  file can be `require()`d in tests (export via `module.exports` when `module`
  exists — same pattern for fontbuild.js and import.js).

### FontBuild (js/fontbuild.js)
- `pixelToContours(glyph, doc) -> contours` — merged-rectangle outlines (greedy
  merge of adjacent filled cells into rects, one rectangular contour each is
  fine; correct non-zero winding: outer contours clockwise in font coords).
- `compile(doc) -> opentype.Font` — flattens components (recursively, cycle-safe),
  maps contours (cubic curveTo / lineTo, close), rounds coords to int, includes
  .notdef + space, sets kerning pairs via the opentype.js kerningPairs option or
  manual kern table; name table: family/style/author/version + license
  (OFL 1.1 / CC0 1.0 / All rights reserved: full notice in the license +
  licenseURL name entries).
- `toTTF(doc) -> ArrayBuffer`.
- `toWOFF(ttfBuf) -> Promise<ArrayBuffer>` — WOFF1 wrapper, per-table zlib via
  CompressionStream('deflate'); keep a table uncompressed when compression
  doesn't shrink it (spec requirement). Correct 4-byte padding + checksums per
  the WOFF1 spec.
- `previewInstall(doc) -> Promise<string>` — compiles, registers a FontFace
  under family `"CarinoFontsPreview"` (replacing the previous one), returns the
  family name. Debounce is the CALLER's job.
- `licenseNotice(id) -> {name, text, url}`.

### FontImport (js/import.js)
- `fromBinary(arrayBuffer) -> doc` — opentype.parse; every glyph becomes a
  vector glyph (convert quad curves to cubic exactly: c = q ± (q-p)/3);
  imports metrics, family/style, kerning pairs it can read (kern table via
  font.kerningPairs / getKerningValue over cmap'd pairs is acceptable).
- `fromSFD(text) -> doc` — FontForge .sfd subset: header metrics
  (Ascent/Descent/EM/FamilyName), per-char `StartChar..EndChar` blocks with
  `Width`, `SplineSet` (m/l/c operators, coordinates in font units).
- `svgPathToContours(d, scale=1, flipY=false) -> contours` — M/L/C/Q/Z/H/V
  absolute+relative.
- `fromCfont(jsonText) -> doc` (parse + FontModel.normalize).

### UI (js/ui-shared.js)
- `UI.el(tag, attrs, children)` DOM helper; `UI.toast(msg, ok=true)`.
- `UI.selGlyph` (number|null, currently edited codepoint);
  `UI.selectGlyph(cp)` sets it, switches to the editor tab, emits.
- `UI.switchTab(name)` (delegates to app.js's implementation via
  `window.dispatchEvent(new CustomEvent('carino-tab', {detail:name}))`).
- `UI.fmtCp(cp)` -> `"U+0041 A"`.

### Tab modules (ui-glyphmap/pixel/vector/spacing) and popups (preview/export)
UIPreview and UIExport are POPUPS, not tabs: each exposes `{ init(), open() }`
— init() only registers a FontModel.onChange listener (no-op while closed),
open() builds its DOM inside `UI.modal(title, onClose)` and cleans its refs on
close. They are opened from buttons in the Glyphs top bar.

### Tab modules
Each exposes `{ init() }`; `init()` builds ALL of its DOM inside its section
(below), subscribes to `FontModel.onChange`, and re-renders idempotently.
`app.js` calls every `init()` on DOMContentLoaded, then handles: tab bar
clicks + the 'carino-tab' event, Ctrl+Z/Y undo/redo, boot from localStorage
(else newProject), and pixel/vector editor swap inside the
Editor tab (show `#editor-pixel` when current glyph mode is pixel, else
`#editor-vector`, with a mode toggle button it owns).

## DOM contract (index.html provides exactly these; modules own their insides)

```
header.top-header            (shared navbar markup mounts here; see any fleet repo)
main
  section#tab-glyphs         (UIGlyphMap — the whole visible app)
div#popup-holder (hidden)
  section#tab-editor         (UIPixel/UIVector; moved into a modal on open)
    div#editor-pixel
    div#editor-vector
  section#tab-spacing        (UISpacing; moved into a modal on open)
```

There is no tab bar: Glyphs is the single page. app.js boots from localStorage (else a new font) and its `openSection()` MOVES
#tab-editor / #tab-spacing into a `UI.modal` body on open and back into
#popup-holder on close (listeners and canvas state survive the move).
Selecting a glyph (UI.selectGlyph → switchTab('editor') → carino-tab event)
opens the editor popup; closing it clears the selection. switchTab('spacing')
opens the spacing popup the same way.

## Styling (styles.css)

`:root` tokens: `--bg:#050505; --panel:#0b0b0b; --panel2:#0d0d0d;
--border:#262626; --text:#e5e5e5; --text-dim:#a3a3a3; --text-muted:#666;
--accent:#eab308; --ok:#22c55e; --err:#ef4444; --radius:10px;` plus the
Branding type scale: `--fs-micro:.6rem; --fs-label:.65rem; --fs-btn:.7rem;
--fs-sm:.8rem; --fs-mono:.85rem; --fs-sec:.9rem; --fs-body:1rem; --fs-lg:1.05rem;
--fs-h3:1.2rem; --fs-h2:1.5rem; --fs-h1:1.9rem;` — use tokens, never raw
font-sizes, floor 0.6rem. Headings Red Hat Display 900; body IBM Plex Sans;
mono IBM Plex Mono. Buttons: mono uppercase `--fs-btn`, letter-spacing .08em.

## Feature notes

- **Glyphs home** (the only page): the action buttons — New (quiet reset;
  default state IS a new font) · Load font… (.cfont/.json/.ttf/.otf/.woff/.sfd
  → editable project; imported fonts open with every covered set enabled;
  dropping a file anywhere on the page works too) · Spacing · Preview ·
  Export (primary), plus a Sets button — live IN the shared navbar: ui-glyphmap builds a
  [data-carino-actions] box and portals it into #carinoNav .cn-right (capped
  rAF retry; falls back to an inline row if the navbar never lands). The sets picker is a POPUP (Sets button) whose
  point is that EVERY set is on screen at once: compact status cells (gold
  dot = on; dot + mono label, hub-ping-grid style), live-synced while open. Enabled sets render as COLLAPSIBLE glyph-grid blocks
  (header click folds them; full range when span ≤ 640, else only present
  glyphs); per-cell: glyph
  rendered from its own outline data on a small canvas (or the char in a system
  font, dimmed, when empty); coverage counter per block; click → selectGlyph.
- **Pixel editor**: big grid canvas, LMB paint / RMB or toggle erase, drag
  paints; guides: baseline row line + x-height/cap approximations; buttons:
  clear, invert, shift ←→↑↓, auto-fit advance; grid size + baseline editable in
  a per-font settings row (re-mapping keeps existing art anchored to baseline).
- **Vector editor**: SVG canvas like Topo (camera pan/zoom, GRID snap opt);
  pen tool (click = corner anchor, click-drag = smooth anchor with symmetric
  handles), select/move points, del point, insert point on segment,
  toggle corner/smooth, close contour; per-glyph metrics guides (baseline,
  x-height, cap, ascender, descender, 0 and adv verticals with draggable adv);
  components panel: add reference glyph by codepoint with dx/dy nudge;
  "Paste SVG path" input; onion-skin: pick a reference glyph rendered ghosted
  behind (v3).
- **Spacing**: live sample line rendered from compiled outlines; drag between
  two glyphs to kern that pair; table of kerning pairs with delete; per-glyph
  adv editing; batch accents (v3): for each precomposed target (é è ê ë á … a
  fixed table of ~30 Latin-1 combos), if base+mark exist, create component glyph.
- **Editor (popup)**: opens when a glyph is selected; hosts the pixel or
  vector editor per glyph.mode with the mode toggle; closing deselects.
- **Spacing (popup)**: the spacing/kerning UI in a modal (advance widths are
  also editable inside each glyph editor).
- **Preview (popup)**: textarea + size slider on one row, rendered via
  previewInstall (debounced 300ms); waterfall (8/10/12/14/18/24/36/48/72px);
  shows compile errors inline, never throws.
- **Subsetting**: emerges from Load + set toggles + Export — no separate tool.
  compile() skips glyphs whose set is disabled (.notdef/space always kept);
  WOFF intake inflates woff1 per table via DecompressionStream before
  opentype.parse. Dropping GSUB/GPOS layout on import is acceptable.
- **Export (popup)**: meta form (family/style/author/version), license picker with
  plain-language explanation of the three options + "your font is yours" note,
  Download TTF / WOFF / .cfont (with an enabled-sets glyph-count note; opening
  files lives in the navbar Load button). No sharing links — the font leaves
  the app only as a downloaded file.

## Tests (tests/*.test.js, plain node asserts, runner tests/run.sh)

Model: normalize garbage-in, serialize round-trip, undo/redo. Build: pixel→
contours (winding, merged rects), compile round-trip via opentype.parse
(cmap/advance/name/license correct), WOFF wrapper parses (check signature +
opentype.parse after manual inflate). Import: SFD sample fixture round-trip,
svg path parser, quad→cubic exactness. Every test file runs standalone:
`node tests/model.test.js` prints PASS lines and exits non-zero on failure.

## Conventions

- No frameworks, no modules, no build. `node --check` must pass on every file.
- Comments only for non-obvious constraints (fleet style).
- Never edit vendor/. Never add external network calls.
- README.md: what it is, the three version feature sets, format matrix,
  "fonts you make are yours" license section, vendor attribution (opentype.js
  MIT), local dev (`python3 -m http.server`).
