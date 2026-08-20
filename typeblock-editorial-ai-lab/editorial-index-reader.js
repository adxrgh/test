(() => {
  'use strict';

  const I = window.TypeBlockEditorialIndex;
  if (!I) return;

  let shell = null;
  let panel = null;
  let closeButton = null;
  let kickerNode = null;
  let titleNode = null;
  let deckNode = null;
  let metaNode = null;
  let bodyNode = null;
  let activeCell = null;
  let closeTimer = null;

  function ensureReader() {
    if (shell?.isConnected) return shell;
    shell = document.createElement('div');
    shell.id = 'typeblockReader';
    shell.className = 'typeblock-reader-shell';
    shell.hidden = true;
    shell.setAttribute('aria-hidden', 'true');
    shell.innerHTML =
      '<div class="typeblock-reader-scrim" data-reader-close></div>' +
      '<article class="typeblock-reader-panel" role="dialog" aria-modal="true" aria-labelledby="typeblockReaderTitle">' +
      '  <header class="typeblock-reader-toolbar">' +
      '    <button type="button" class="typeblock-reader-close" data-reader-close>← Editorial index</button>' +
      '    <span class="typeblock-reader-toolbar-mark">TYPEBLOCK / SOURCE</span>' +
      '  </header>' +
      '  <div class="typeblock-reader-content">' +
      '    <div class="typeblock-reader-kicker"></div>' +
      '    <h1 class="typeblock-reader-title" id="typeblockReaderTitle"></h1>' +
      '    <p class="typeblock-reader-deck"></p>' +
      '    <div class="typeblock-reader-meta"></div>' +
      '    <div class="typeblock-reader-body"></div>' +
      '  </div>' +
      '</article>';
    document.body.appendChild(shell);
    panel = shell.querySelector('.typeblock-reader-panel');
    closeButton = shell.querySelector('.typeblock-reader-close');
    kickerNode = shell.querySelector('.typeblock-reader-kicker');
    titleNode = shell.querySelector('.typeblock-reader-title');
    deckNode = shell.querySelector('.typeblock-reader-deck');
    metaNode = shell.querySelector('.typeblock-reader-meta');
    bodyNode = shell.querySelector('.typeblock-reader-body');

    shell.querySelectorAll('[data-reader-close]').forEach(node => {
      node.addEventListener('click', event => {
        event.preventDefault();
        close();
      });
    });
    panel.addEventListener('click', event => event.stopPropagation());
    return shell;
  }

  function sourceBody(entry) {
    const raw = String(entry?.rawBody || entry?.body || '').replace(/\r\n?/g, '\n').trim();
    const projection = entry?.projection;
    if (projection?.titleSource !== 'extracted' || !raw.includes('\n')) return raw;
    const lines = raw.split('\n');
    const firstContent = lines.findIndex(line => line.trim());
    if (firstContent < 0) return raw;
    lines.splice(firstContent, 1);
    return lines.join('\n').trim();
  }

  function labelFor(entry) {
    const sequence = String(entry?.id || '').padStart(2, '0');
    const source = String(entry?.provenance || 'collected').toUpperCase();
    return `${sequence} / ${source}`;
  }

  function open(entry, sourceCell = null) {
    if (!entry) return;
    ensureReader();
    clearTimeout(closeTimer);
    activeCell = sourceCell || null;
    I.state.readerEntryID = entry.id;
    I.state.readerReturnScroll = window.scrollY;

    const projection = entry.projection || {};
    const title = String(projection.title || '').trim();
    const deck = String(projection.deck || '').trim();
    kickerNode.textContent = labelFor(entry);
    titleNode.textContent = title;
    titleNode.hidden = !title;
    deckNode.textContent = deck;
    deckNode.hidden = !deck;
    metaNode.textContent =
      `${Number(entry.chars || 0).toLocaleString()} characters · ` +
      `${String(entry.provenance || 'collected')} · ` +
      `${projection.titleSource && projection.titleSource !== 'none' ? `title ${projection.titleSource}` : 'untitled source'}`;
    bodyNode.textContent = sourceBody(entry);

    shell.hidden = false;
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('typeblock-reader-open');
    requestAnimationFrame(() => {
      shell.classList.add('is-open');
      panel.scrollTop = 0;
      closeButton.focus({ preventScroll: true });
    });
  }

  function close() {
    if (!shell || shell.hidden) return;
    shell.classList.remove('is-open');
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('typeblock-reader-open');
    I.state.readerEntryID = null;
    closeTimer = setTimeout(() => {
      shell.hidden = true;
      activeCell?.focus?.({ preventScroll: true });
      activeCell = null;
    }, 220);
  }

  addEventListener('keydown', event => {
    if (event.key === 'Escape' && shell && !shell.hidden) close();
  });

  window.TypeBlockReader = { open, close, sourceBody, isOpen: () => Boolean(shell && !shell.hidden) };
  I.openReader = open;
  I.closeReader = close;
})();