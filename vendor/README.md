# Vendored third-party code

These files are **not** part of this project and are **not** covered by its
AGPL-3.0 licence. Each keeps its own MIT licence, reproduced in full alongside
it, as MIT requires.

They are committed here rather than loaded from a CDN so this tool matches the
rest of the fleet: every Carino site works standalone and offline, with no
external runtime dependency and nothing that reports a visitor's presence to a
third party.

| File | Version | Upstream | Licence |
|---|---|---|---|
| `opentype.min.js` | 1.3.4 | [opentype.js](https://github.com/opentypejs/opentype.js) | MIT — [`LICENSE.opentype`](LICENSE.opentype), © 2020 Frederik De Bleser |

opentype.js does the heavy sfnt lifting: parsing TTF/OTF binaries for import
and subsetting, and serialising the compiled glyph outlines back to a TTF.
Everything around it (the doc model, pixel-to-contour conversion, the manual
`kern` table, the WOFF1 wrapper) is project code in `js/`.

MIT is permissive, so bundling it into an AGPL work is fine — the combined work
ships under AGPL while this file stays MIT. The obligation is only to keep the
copyright and permission notices, which is what this folder does.

## Updating

Re-download to the **same filename** (or add a version-pinned one and update
the `<script>` tag in `index.html`). Do not point it back at a CDN.
