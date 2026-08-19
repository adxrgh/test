(() => {
  'use strict';

  const projectionSystem = window.EditorialProjection;
  if (!projectionSystem) return;

  function activeProjection(entry) {
    const value = entry?.projection;
    if (!value || value.status === 'notNeeded') return null;
    return value.title || value.deck ? value : null;
  }

  function projectionLabel(entry) {
    const value = entry?.projection;
    if (!value) return 'projection missing';
    if (value.status === 'notNeeded') return 'projection off';
    if (value.status === 'stale') return 'projection stale';
    if (value.status === 'missing') {
      if (value.titleSource === 'extracted') return 'title extracted · deck missing';
      return 'projection missing';
    }
    const parts = [];
    if (value.titleSource === 'extracted') parts.push('title extracted');
    if (value.titleSource === 'generated') parts.push('title generated');
    if (value.deckSource === 'generated') parts.push('deck generated');
    return parts.join(' · ') || 'projection ready';
  }

  if (typeof activeDatasetSignature === 'function') {
    const baseDatasetSignature = activeDatasetSignature;
    activeDatasetSignature = () => {
      const projectionState = entries.map(entry => {
        const value = entry.projection;
        return `${value?.status || 'none'}:${value?.title || ''}:${value?.deck || ''}`;
      }).join('|');
      return `projection-v1|${projectionState}|${baseDatasetSignature()}`;
    };
  }

  if (typeof renderLayout === 'function') {
    const baseRenderLayout = renderLayout;
    renderLayout = function projectionRenderLayout() {
      baseRenderLayout();
      const candidate = candidates[selected];
      if (!candidate) return;
      const metrics = window.TypeBlockTextMetrics;

      document.querySelectorAll('#layout .block').forEach((block, index) => {
        const entry = entries[index];
        const placement = candidate.ps[index];
        const body = block.querySelector('.body');
        if (!entry || !placement || !body) return;

        const value = activeProjection(entry);
        body.textContent = projectionSystem.displayBody(entry);
        body.classList.add('article-body');
        block.dataset.projection = entry.projection?.status || 'none';

        if (value) {
          block.classList.add('has-editorial-projection');
          if (value.title) {
            block.classList.add('has-title');
            const title = document.createElement('h3');
            title.className = 'article-title';
            title.textContent = value.title;
            title.dataset.source = value.titleSource || 'unknown';
            body.before(title);
          }
          if (value.deck) {
            const deck = document.createElement('p');
            deck.className = 'article-deck';
            deck.textContent = value.deck;
            deck.dataset.source = value.deckSource || 'unknown';
            body.before(deck);
          }
        }

        if (metrics) {
          const lineCount = metrics.visibleLines(entry, placement.span, placement.rows);
          body.style.webkitLineClamp = String(lineCount);
          body.style.lineClamp = String(lineCount);
          const header = metrics.headerMetrics?.(entry, placement.span);
          if (header) block.dataset.projectionHeader = `${header.titleLines}:${header.deckLines}:${header.extraRows}`;
        }
      });

      const projected = entries.filter(entry => activeProjection(entry)).length;
      const stageMeta = document.getElementById('stageMeta');
      if (stageMeta && !stageMeta.textContent.includes('PROJECTION V1')) {
        stageMeta.textContent += ` · ${projected} projected · PROJECTION V1`;
      }
      const stats = document.getElementById('stats');
      if (stats && !stats.textContent.includes('projection:')) {
        const titles = entries.filter(entry => entry.projection?.title).length;
        const decks = entries.filter(entry => entry.projection?.deck).length;
        stats.textContent = `projection: v1 · ${titles} titles · ${decks} decks\n${stats.textContent}`;
      }
    };
  }

  if (typeof renderLadder === 'function') {
    const baseRenderLadder = renderLadder;
    renderLadder = function projectionRenderLadder() {
      baseRenderLadder();
      document.querySelectorAll('#ladder > div').forEach((node, index) => {
        const entry = entries[index];
        if (!entry) return;
        const label = document.createElement('span');
        label.className = `projection-ladder projection-${entry.projection?.status || 'missing'}`;
        label.textContent = projectionLabel(entry);
        node.appendChild(label);
      });
    };
  }

  if (typeof renderCost === 'function') {
    const baseRenderCost = renderCost;
    renderCost = function projectionAwareRenderCost() {
      baseRenderCost();
      document.querySelectorAll('#costLedger span').forEach(label => {
        if (label.textContent === '100-entry projection') label.textContent = '100-entry estimate';
      });
    };
  }

  if (typeof renderEditorial === 'function') {
    const baseRenderEditorial = renderEditorial;
    renderEditorial = function projectionRenderEditorial() {
      baseRenderEditorial();
      const entry = entries.find(item => item.id === focus);
      const grid = document.querySelector('#editorialInspector .editorial-grid');
      if (!entry || !grid) return;
      const value = entry.projection;
      const usage = entry.projectionUsage;
      const cost = Number(usage?.actualUSD || 0);
      grid.insertAdjacentHTML(
        'beforeend',
        `<span>Projection</span><b>${uiEscape(value?.status || 'missing')}</b>` +
        `<span>Projection plan</span><b>${uiEscape(value?.plan || '—')}</b>` +
        `<span>Title</span><b>${uiEscape(value?.title || '—')}</b>` +
        `<span>Title source</span><b>${uiEscape(value?.titleSource || 'none')}</b>` +
        `<span>Deck</span><b>${uiEscape(value?.deck || '—')}</b>` +
        `<span>Deck source</span><b>${uiEscape(value?.deckSource || 'none')}</b>` +
        `<span>Projection confidence</span><b>${Number.isFinite(value?.confidence) ? value.confidence.toFixed(2) : '—'}</b>` +
        `<span>Projection model</span><b>${uiEscape(value?.model || '—')}</b>` +
        `<span>Projection tokens</span><b>${usage ? `${Number(usage.inputTokens || 0).toLocaleString()} / ${Number(usage.outputTokens || 0).toLocaleString()}` : '—'}</b>` +
        `<span>Projection cost</span><b>${usage ? '$' + cost.toFixed(6) : '—'}</b>`
      );
    };
  }
})();
