(function () {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'string') node.style.cssText = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'value' || k === 'checked' || k === 'disabled') {
          node[k] = v;
        } else node.setAttribute(k, v);
      }
    }
    appendKids(node, children);
    return node;
  }

  function appendKids(node, kids) {
    if (kids == null) return;
    if (Array.isArray(kids)) {
      for (var i = 0; i < kids.length; i++) appendKids(node, kids[i]);
    } else if (typeof kids === 'string' || typeof kids === 'number') {
      node.appendChild(document.createTextNode(String(kids)));
    } else if (kids instanceof Node) {
      node.appendChild(kids);
    }
  }

  var toastNode = null;
  var toastTimer = null;

  function toast(msg, ok) {
    if (ok === undefined) ok = true;
    if (toastNode) { toastNode.remove(); toastNode = null; }
    if (toastTimer) clearTimeout(toastTimer);
    toastNode = el('div', { class: 'toast ' + (ok ? 'ok' : 'err') }, msg);
    document.body.appendChild(toastNode);
    toastTimer = setTimeout(function () {
      if (toastNode) { toastNode.remove(); toastNode = null; }
      toastTimer = null;
    }, 2800);
  }

  function fmtCp(cp) {
    var hex = cp.toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    var ch = '';
    if (cp === 32) ch = 'space';
    else if (cp > 32) { try { ch = String.fromCodePoint(cp); } catch (e) { ch = ''; } }
    return ('U+' + hex + ' ' + ch).trim();
  }

  // One modal at a time; returns { body, close }. Closes on ✕, backdrop
  // click or Escape; onClose (optional) runs exactly once however it closes.
  var openModal = null;

  function modal(title, onClose) {
    if (openModal) openModal.close();
    var closed = false;
    var body = el('div', { class: 'modal-body' });
    var closeBtn = el('button', { class: 'btn modal-close' }, '✕');
    var box = el('div', { class: 'modal-box' }, [
      el('div', { class: 'modal-head' }, [el('h3', {}, title), closeBtn]),
      body
    ]);
    var overlay = el('div', { class: 'modal-overlay' }, box);
    function close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      openModal = null;
      if (onClose) onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    openModal = { close: close };
    return { body: body, close: close };
  }

  var UI = {
    selGlyph: null,

    el: el,
    toast: toast,
    fmtCp: fmtCp,
    modal: modal,

    selectGlyph: function (cp) {
      UI.selGlyph = cp;
      UI.switchTab('editor');
      FontModel.emit();
    },

    switchTab: function (name) {
      window.dispatchEvent(new CustomEvent('carino-tab', { detail: name }));
    }
  };

  window.UI = UI;
})();
