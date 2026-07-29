(function () {
  'use strict';

  var MODULES = ['UIGlyphMap', 'UIPixel', 'UIVector', 'UISpacing', 'UIPreview', 'UIExport'];

  function initModules() {
    for (var i = 0; i < MODULES.length; i++) {
      var mod = window[MODULES[i]];
      if (!mod || typeof mod.init !== 'function') continue;
      // one broken/missing module must not kill boot
      try { mod.init(); } catch (e) { console.error(MODULES[i] + '.init failed', e); }
    }
  }

  // ── section popups ────────────────────────────────────────────
  // The editor and spacing UIs init once into their (hidden) sections; opening
  // them MOVES the live section into a modal and returns it on close, so
  // canvas state and listeners survive.

  function openSection(title, sectionId, onClose) {
    var section = document.getElementById(sectionId);
    var holder = document.getElementById('popup-holder');
    var m = UI.modal(title, function () {
      holder.appendChild(section);
      if (onClose) onClose();
    });
    m.body.parentElement.classList.add('wide');
    m.body.appendChild(section);
    // re-render after the section is visible (the vector editor fits its
    // viewport on the first render with a non-zero width)
    FontModel.emit();
    return m;
  }

  function openEditor() {
    openSection('Glyph editor', 'tab-editor', function () {
      UI.selGlyph = null;
      FontModel.emit();
    });
  }

  function openSpacing() {
    openSection('Spacing & kerning', 'tab-spacing');
  }

  // ── editor head (glyph label + pixel/vector mode toggle) ──────

  var modeBtn = null;
  var glyphLabel = null;

  function buildEditorHead() {
    var section = document.getElementById('tab-editor');
    var style = document.createElement('style');
    style.id = 'app-styles';
    style.textContent =
      '#app-editor-head{display:flex;align-items:center;gap:12px;flex-shrink:0;' +
      'background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);' +
      'padding:10px 14px;}' +
      '#app-glyph-label{font-family:"IBM Plex Mono",monospace;font-size:var(--fs-mono);' +
      'color:var(--accent);font-weight:700;}' +
      '#app-glyph-label.empty{color:var(--text-muted);font-weight:400;}' +
      '.modal-body > section{display:flex;flex-direction:column;gap:14px;}' +
      // the vector editor sizes itself from its container, which must have
      // real height inside a content-sized modal
      '.modal-body > #tab-editor{min-height:80vh;}';
    document.head.appendChild(style);

    glyphLabel = UI.el('span', { id: 'app-glyph-label', class: 'empty' }, 'No glyph selected');
    modeBtn = UI.el('button', { class: 'btn', onclick: toggleMode }, 'Mode');
    var head = UI.el('div', { id: 'app-editor-head' }, [glyphLabel, modeBtn]);
    section.insertBefore(head, section.firstChild);
  }

  function toggleMode() {
    if (UI.selGlyph == null) { UI.toast('Select a glyph first', false); return; }
    var g = FontModel.ensureGlyph(UI.selGlyph);
    g.mode = g.mode === 'pixel' ? 'vector' : 'pixel';
    FontModel.save();
  }

  function renderEditorHead() {
    var cp = UI.selGlyph;
    var g = cp != null ? FontModel.getGlyph(cp) : null;
    var mode = g && g.mode === 'vector' ? 'vector' : 'pixel';

    if (cp != null) {
      glyphLabel.textContent = UI.fmtCp(cp);
      glyphLabel.classList.remove('empty');
    } else {
      glyphLabel.textContent = 'No glyph selected';
      glyphLabel.classList.add('empty');
    }
    modeBtn.disabled = cp == null;
    modeBtn.textContent = mode === 'pixel' ? 'Switch to vector' : 'Switch to pixel';

    document.getElementById('editor-pixel').style.display = mode === 'pixel' ? '' : 'none';
    document.getElementById('editor-vector').style.display = mode === 'vector' ? '' : 'none';
  }

  // Legacy routing: UI.switchTab('editor'|'spacing') now opens the popups
  // (UI.selectGlyph still calls switchTab('editor')).
  function wirePopups() {
    window.addEventListener('carino-tab', function (e) {
      if (e.detail === 'editor') openEditor();
      else if (e.detail === 'spacing') openSpacing();
    });
  }

  function wireKeyboard() {
    window.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); FontModel.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); FontModel.redo(); }
    });
  }

  function bootDoc() {
    var local = FontModel.loadLocal();
    // default is a fresh new font; the autosave restores the last session
    FontModel.load(local || FontModel.newProject());
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildEditorHead();
    wirePopups();
    wireKeyboard();
    initModules();
    FontModel.onChange(renderEditorHead);
    bootDoc();
  });
})();
