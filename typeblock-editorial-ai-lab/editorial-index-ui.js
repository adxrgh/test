(() => {
  'use strict';

  const I = window.TypeBlockEditorialIndex;
  if (!I) return;
  const K = I.constants;

  function clearIndexSurface(layout) {
    if (typeof clearLayoutSurface === 'function') clearLayoutSurface(layout);
    layout.querySelectorAll(
      '.editorial-index-masthead, .editorial-band, .index-viewport-guide, .editorial-index-empty'
    ).forEach(node => node.remove());
  }

  function candidateAtSelection() {
    return candidates[selected] || candidates[0] || null;
  }

  function entryForPlacement(placement) {
    return entries[placement.entryIndex] || entries.find(entry => entry.id === placement.id) || null;
  }

  function bandEntries(band) {
    return entries.slice(band.start, band.end);
  }

  function roleLabel(role) {
    return {
      feature: 'FEATURE',
      lead: 'LEAD',
      matrix: 'MATRIX',
      support: 'SUPPORT'
    }[role] || String(role || 'ENTRY').toUpperCase();
  }

  function indexSummary(candidate) {
    const counts = { lead: 0, matrix: 0, feature: 0 };
    candidate?.bands?.forEach(band => {
      if (counts[band.type] !== undefined) counts[band.type] += 1;
    });
    return counts;
  }

  function totalCharacters() {
    return entries.reduce((sum, entry) => sum + Number(entry.chars || 0), 0);
  }

  function updateStatus() {
    const node = document.getElementById('indexStatus');
    if (!node) return;
    const candidate = candidateAtSelection();
    if (!candidate) {
      node.innerHTML = '<strong>ROLLING EDITORIAL INDEX</strong> — waiting for an active dataset.';
      return;
    }
    const counts = indexSummary(candidate);
    node.innerHTML =
      `<strong>ROLLING EDITORIAL INDEX</strong> — ${candidate.bands.length} editorial bands: ` +
      `${counts.lead} lead, ${counts.matrix} matrix, ${counts.feature} feature. ` +
      'Reading order is fixed; title/deck headers use a separate budget from length-derived body territory.';
  }

  function createMasthead(candidate) {
    const masthead = document.createElement('header');
    masthead.className = 'editorial-index-masthead';
    const authored = entries.filter(entry => entry.provenance === 'authored').length;
    const collected = entries.length - authored;
    masthead.innerHTML =
      '<div class="editorial-index-kicker">TYPEBLOCK / EDITORIAL INDEX</div>' +
      `<div class="editorial-index-title">Latest ${entries.length}<br>entries</div>` +
      '<div class="editorial-index-folio">' +
      `<span>${totalCharacters().toLocaleString()} characters</span>` +
      `<span>${candidate.bands.length} editorial bands</span>` +
      `<span>${collected} collected / ${authored} authored</span>` +
      `<span>${I.escapeHTML(candidate.variantLabel || candidate.variant || 'Index')}</span>` +
      '</div>';
    return masthead;
  }

  function bandHead(band) {
    const head = document.createElement('header');
    head.className = 'editorial-band-head';
    const group = bandEntries(band);
    const chars = group.reduce((sum, entry) => sum + Number(entry.chars || 0), 0);
    head.innerHTML =
      `<span>${I.escapeHTML(band.label || `${String(band.id + 1).padStart(2, '0')} / ${band.type.toUpperCase()}`)}</span>` +
      `<span>${group.length} ${group.length === 1 ? 'ENTRY' : 'ENTRIES'} · ${chars.toLocaleString()} CHARS · ${I.escapeHTML(band.template || '')}</span>`;
    return head;
  }

  function entryMeta(entry, placement) {
    const sequence = String(entry.id).padStart(2, '0');
    const source = String(entry.provenance || 'collected').toUpperCase();
    return `${sequence} / ${source} / ${Number(entry.chars || 0).toLocaleString()} CHARS / ${roleLabel(placement.role)}`;
  }

  function openEntry(entry, cell) {
    focus = entry.id;
    if (typeof renderEditorial === 'function') renderEditorial();
    if (window.TypeBlockReader?.open) window.TypeBlockReader.open(entry, cell);
  }

  function createCell(entry, placement, band) {
    const cell = document.createElement('article');
    const focused = focus === entry.id ? ' focus' : '';
    cell.className =
      `block editorial-cell cell-${placement.role || 'matrix'} band-${band.type}${focused}`;
    cell.dataset.entryId = String(entry.externalId || entry.id);
    cell.dataset.entryIndex = String(placement.entryIndex);
    cell.dataset.band = String(band.id);
    cell.dataset.bandType = band.type;
    cell.dataset.role = placement.role || 'matrix';
    cell.dataset.template = band.template || '';
    cell.style.gridColumn = `${placement.x + 1} / span ${placement.span}`;
    cell.style.gridRow = `${placement.row - band.contentRow + 1} / span ${placement.rows}`;
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute(
      'aria-label',
      `${String(entry.id).padStart(2, '0')}, ${entry.projection?.title || `${entry.chars} character entry`}`
    );

    const previewLines = Math.max(1, Number(placement.shape?.previewLines || Math.floor(placement.bodyRows / K.bodyBaselineRows) || 1));
    const editorial = entry.editorial?.status === 'ready' ? entry.editorial : null;
    const phrase = `B${band.id + 1} · ${band.type}`;
    cell.innerHTML =
      `<div class="meta">${I.escapeHTML(entryMeta(entry, placement))}</div>` +
      `<div class="body" style="-webkit-line-clamp:${previewLines};line-clamp:${previewLines}">${I.escapeHTML(I.displayBody(entry))}</div>` +
      `${entry.cue ? `<div class="cue">${I.escapeHTML(entry.cue)}</div>` : ''}` +
      `<div class="seq">${String(entry.id).padStart(2, '0')}</div>` +
      `<div class="source-mark ${I.escapeHTML(entry.provenance)}">${I.escapeHTML(entry.provenance)}</div>`;
    cell.dataset.editorialFunction = editorial?.function || 'neutral';
    cell.dataset.phrase = phrase;
    cell.dataset.previewLines = String(previewLines);
    cell.dataset.previewCoverage = String(Number(placement.shape?.previewCoverage || 0));

    cell.addEventListener('click', () => openEntry(entry, cell));
    cell.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openEntry(entry, cell);
    });
    return cell;
  }

  function createBand(band) {
    const section = document.createElement('section');
    section.className = `editorial-band editorial-band-${band.type}`;
    section.dataset.band = String(band.id);
    section.dataset.template = band.template || '';
    section.appendChild(bandHead(band));

    const grid = document.createElement('div');
    grid.className = 'editorial-band-grid';
    grid.style.columnGap = `${I.gutter()}px`;
    const bottom = Math.max(
      band.contentRow + 1,
      ...band.placements.map(placement => placement.row + placement.rows)
    );
    const contentRows = Math.max(1, bottom - band.contentRow);
    grid.style.gridTemplateRows = `repeat(${contentRows}, ${K.unit}px)`;
    grid.dataset.rows = String(contentRows);

    [...band.placements]
      .sort((a, b) => a.entryIndex - b.entryIndex)
      .forEach(placement => {
        const entry = entryForPlacement(placement);
        if (entry) grid.appendChild(createCell(entry, placement, band));
      });
    section.appendChild(grid);
    return section;
  }

  function renderViewportGuides(layout) {
    layout.querySelectorAll('.index-viewport-guide').forEach(node => node.remove());
    const worst = document.getElementById('worst');
    if (!I.isMobile() || !worst?.checked) return;
    const viewport = typeof layoutViewportHeight === 'function' ? layoutViewportHeight() : 844;
    const total = layout.scrollHeight;
    let number = 2;
    for (let top = viewport; top < total; top += viewport) {
      const line = document.createElement('div');
      line.className = 'index-viewport-guide';
      line.style.top = `${top}px`;
      line.innerHTML = `<span>VIEWPORT ${number}</span>`;
      layout.appendChild(line);
      number += 1;
    }
  }

  function renderCandidates() {
    const host = document.getElementById('cands');
    if (!host) return;
    host.innerHTML = '';
    candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `cand${index === selected ? ' on' : ''}`;
      button.textContent = `#${index + 1} · ${candidate.variantLabel || candidate.variant || 'Index'} · ${candidate.bands.length}B`;
      button.onclick = () => {
        selected = index;
        if (typeof renderAll === 'function') renderAll();
      };
      host.appendChild(button);
    });
  }

  function renderStats(candidate) {
    const node = document.getElementById('stats');
    if (!node) return;
    const counts = indexSummary(candidate);
    const averageCoverage = candidate.ps.length
      ? candidate.ps.reduce((sum, placement) => sum + Number(placement.shape?.previewCoverage || 0), 0) / candidate.ps.length
      : 0;
    node.textContent =
      `format: ${I.version}\n` +
      `variant: ${candidate.variantLabel || candidate.variant}\n` +
      `bands: ${candidate.bands.length} · lead ${counts.lead} · matrix ${counts.matrix} · feature ${counts.feature}\n` +
      `reading order: source order preserved · no dense backfill\n` +
      `territory: body area uses the length-derived weight; title/deck rows are budgeted separately\n` +
      `mean visible source: ${Math.round(averageCoverage * 100)}%\n` +
      Object.entries(candidate.m || {}).map(([key, value]) => `${key}: ${Number(value || 0).toFixed(1)} × ${W[key] ?? 0}`).join('\n') +
      `\nscore: ${Number(candidate.s || 0).toFixed(2)}`;
  }

  function renderIndexLayout() {
    window.TypeBlockLayoutProfile?.applyDom?.();
    const layout = document.getElementById('layout');
    if (!layout) return;
    clearIndexSurface(layout);
    layout.classList.add('editorial-index-layout');
    layout.classList.toggle('showgrid', Boolean(document.getElementById('grid')?.checked));
    layout.classList.toggle('bounds', Boolean(document.getElementById('bounds')?.checked));
    document.getElementById('app')?.classList.toggle('clean', Boolean(document.getElementById('clean')?.checked));
    document.getElementById('app')?.classList.add('editorial-index-mode');
    const gridlines = document.getElementById('gridlines');
    if (gridlines) gridlines.style.gap = `${I.gutter()}px`;
    layout.style.removeProperty('height');
    layout.style.minHeight = `${I.isMobile() ? 844 : 820}px`;

    const candidate = candidateAtSelection();
    if (!candidate || candidate.ps.length !== entries.length) {
      const empty = document.createElement('div');
      empty.className = 'layout-message editorial-index-empty';
      empty.textContent = entries.length
        ? 'The Rolling Editorial Index could not form a legal band sequence.'
        : 'No active dataset.';
      layout.appendChild(empty);
      document.getElementById('stageMeta').textContent = `${entries.length} Entries · Editorial Index · no candidate`;
      document.getElementById('stats').textContent = `format: ${I.version}\nlayout: no candidate`;
      updateStatus();
      return;
    }

    layout.appendChild(createMasthead(candidate));
    candidate.bands.forEach(band => layout.appendChild(createBand(band)));
    renderCandidates();
    renderStats(candidate);
    updateStatus();

    const stageMeta = document.getElementById('stageMeta');
    if (stageMeta) {
      stageMeta.textContent =
        `${entries.length} Entries · ${candidate.bands.length} bands · ${I.activeProfileLabel()} · ` +
        `${mode.toUpperCase()} · ${candidate.variantLabel || candidate.variant} · EDITORIAL INDEX`;
    }
    requestAnimationFrame(() => renderViewportGuides(layout));
  }

  function renderIndexRolling() {
    const host = document.getElementById('rolling');
    if (!host) return;
    const candidate = candidateAtSelection();
    if (!candidate) {
      host.innerHTML = '<span>Format</span><b>Editorial Index</b><span>Status</span><b>No candidate</b>';
      return;
    }
    const counts = indexSummary(candidate);
    const meanCoverage = candidate.ps.length
      ? candidate.ps.reduce((sum, placement) => sum + Number(placement.shape?.previewCoverage || 0), 0) / candidate.ps.length
      : 0;
    const longest = entries.reduce((best, entry) => !best || entry.chars > best.chars ? entry : best, null);
    host.innerHTML =
      `<span>Format</span><b>Rolling Editorial Index</b>` +
      `<span>Profile</span><b>${I.escapeHTML(I.activeProfileLabel())}</b>` +
      `<span>Variant</span><b>${I.escapeHTML(candidate.variantLabel || candidate.variant)}</b>` +
      `<span>Bands</span><b>${candidate.bands.length}</b>` +
      `<span>Lead / Matrix / Feature</span><b>${counts.lead} / ${counts.matrix} / ${counts.feature}</b>` +
      `<span>Entries</span><b>${entries.length}</b>` +
      `<span>Total characters</span><b>${totalCharacters().toLocaleString()}</b>` +
      `<span>Mean source preview</span><b>${Math.round(meanCoverage * 100)}%</b>` +
      `<span>Longest Entry</span><b>${longest ? `${String(longest.id).padStart(2, '0')} · ${longest.chars.toLocaleString()}` : '—'}</b>` +
      `<span>Reading order</span><b>Preserved</b>`;
  }

  const baseRenderEditorial = typeof renderEditorial === 'function' ? renderEditorial : null;
  if (baseRenderEditorial) {
    renderEditorial = function editorialIndexInspector() {
      baseRenderEditorial();
      const entry = entries.find(item => item.id === focus);
      const grid = document.querySelector('#editorialInspector .editorial-grid');
      if (!entry || !grid) return;
      const index = entries.indexOf(entry);
      const placement = candidateAtSelection()?.ps?.[index];
      const band = placement ? candidateAtSelection()?.bands?.[placement.bandId] : null;
      grid.insertAdjacentHTML(
        'beforeend',
        `<span>Index format</span><b>${I.escapeHTML(I.version)}</b>` +
        `<span>Editorial band</span><b>${band ? `B${band.id + 1} · ${I.escapeHTML(band.type)}` : '—'}</b>` +
        `<span>Band template</span><b>${I.escapeHTML(band?.template || '—')}</b>` +
        `<span>Cell role</span><b>${I.escapeHTML(placement?.role || '—')}</b>` +
        `<span>Body territory</span><b>${placement ? `${placement.span} × ${placement.bodyRows}` : '—'}</b>` +
        `<span>Editorial header</span><b>${placement ? `${placement.headerRows} rows` : '—'}</b>` +
        `<span>Preview</span><b>${placement ? `${placement.shape.previewLines} lines · ${Math.round((placement.shape.previewCoverage || 0) * 100)}%` : '—'}</b>`
      );
    };
  }

  I.updateStatus = updateStatus;
  I.render = renderIndexLayout;
  renderLayout = renderIndexLayout;
  renderRolling = renderIndexRolling;
  updateStatus();
})();