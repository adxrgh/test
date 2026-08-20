(() => {
  'use strict';

  const I = window.TypeBlockEditorialIndex = window.TypeBlockEditorialIndex || {};
  const VERSION = 'rolling-editorial-index-v1';
  const COLUMNS = typeof C === 'number' ? C : 6;
  const UNIT = typeof U === 'number' ? U : 8;

  I.version = VERSION;
  I.constants = Object.freeze({
    columns: COLUMNS,
    unit: UNIT,
    bandHeaderRows: 3,
    bandGapRows: 5,
    innerGapRows: 3,
    cellChromeRows: 4,
    bodyBaselineRows: 3,
    maxCandidates: 4
  });
  I.state = I.state || {
    headerCache: new Map(),
    measureHost: null,
    readerEntryID: null,
    readerReturnScroll: 0
  };

  I.baseDatasetSignature = typeof activeDatasetSignature === 'function'
    ? activeDatasetSignature
    : () => entries.map((entry, index) => `${entry.externalId || entry.id || index}:${entry.digest || ''}`).join('|');

  I.variants = [
    { id: 'balanced', label: 'Balanced', featureChars: 4800, matrix4Ratio: 1.85, matrix3Ratio: 1.85, matrix2Ratio: 2.0, leadRatio: 1.35, preferLead: false, mirrorLead: false },
    { id: 'matrix', label: 'Matrix', featureChars: 6200, matrix4Ratio: 2.35, matrix3Ratio: 2.2, matrix2Ratio: 2.55, leadRatio: 1.6, preferLead: false, mirrorLead: false },
    { id: 'editorial', label: 'Editorial', featureChars: 4200, matrix4Ratio: 1.6, matrix3Ratio: 1.7, matrix2Ratio: 1.85, leadRatio: 1.2, preferLead: true, mirrorLead: false },
    { id: 'alternate', label: 'Alternate', featureChars: 4800, matrix4Ratio: 1.9, matrix3Ratio: 1.9, matrix2Ratio: 2.1, leadRatio: 1.28, preferLead: true, mirrorLead: true }
  ];

  function escapeHTML(value) {
    if (typeof uiEscape === 'function') return uiEscape(value);
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function quantizeRows(value, quantum = I.constants.bodyBaselineRows) {
    return Math.max(quantum, Math.ceil(Math.max(0, value) / quantum) * quantum);
  }

  function activeProfileLabel() {
    return window.TypeBlockLayoutProfile?.active?.().label || 'Desktop';
  }

  function profileKey() {
    return typeof layoutProfileKey === 'function' ? layoutProfileKey() : 'desktop';
  }

  function isMobile() {
    return typeof isMobileLayout === 'function' && isMobileLayout();
  }

  function gutter() {
    return typeof layoutGutter === 'function' ? layoutGutter() : 12;
  }

  function layoutWidth() {
    const node = document.getElementById('layout');
    const measured = number(node?.clientWidth);
    if (measured > 0) return measured;
    return isMobile() ? 358 : 720;
  }

  function columnWidth() {
    return Math.max(1, (layoutWidth() - gutter() * (COLUMNS - 1)) / COLUMNS);
  }

  function cellWidth(span) {
    return span * columnWidth() + Math.max(0, span - 1) * gutter();
  }

  function contentWidth(span) {
    return Math.max(36, cellWidth(span) - 16);
  }

  function projectionFor(entry) {
    const value = entry?.projection;
    if (!value || value.status === 'notNeeded') return null;
    return value;
  }

  function displayBody(entry) {
    if (window.EditorialProjection?.displayBody) return window.EditorialProjection.displayBody(entry);
    return String(entry?.projection?.bodyText || entry?.body || '');
  }

  function editorialFor(entry) {
    if (typeof editorialValue === 'function') return editorialValue(entry);
    return entry?.editorial?.status === 'ready' ? entry.editorial : null;
  }

  function sourceWeight(entry) {
    return Math.max(1, number(entry?.target, Math.sqrt(Math.max(1, number(entry?.chars, 1)))));
  }

  function layoutWeight(entry) {
    return Math.max(1, typeof layoutTargetFor === 'function' ? layoutTargetFor(entry) : sourceWeight(entry));
  }

  function entryKind(entry, variant) {
    const chars = number(entry?.chars);
    const fn = editorialFor(entry)?.function || 'neutral';
    if (chars >= variant.featureChars) return 'feature';
    if (entry?.provenance === 'authored' && chars <= 520) return 'note';
    if (['fragment', 'continuation', 'response'].includes(fn) && chars <= 900) return 'note';
    if (chars >= 900 || ['referenceMaterial', 'background'].includes(fn)) return 'article';
    return 'medium';
  }

  function isFeature(entry, variant) {
    return entryKind(entry, variant) === 'feature';
  }

  function sameMatrixFamily(group, variant) {
    const kinds = group.map(entry => entryKind(entry, variant));
    return kinds.every(kind => ['article', 'medium'].includes(kind)) || kinds.every(kind => kind === 'note');
  }

  function ratioFor(group) {
    const weights = group.map(sourceWeight);
    return Math.max(...weights) / Math.max(1, Math.min(...weights));
  }

  function boundaryList() {
    if (typeof boundarySignals === 'function') return boundarySignals();
    return entries.map((_, index) => ({
      breakStrength: index === 0 ? 1 : 0.5,
      hardBreak: false,
      hardJoin: false,
      continuity: 0.5,
      topicShift: 0.5
    }));
  }

  function canStayTogether(start, count, signals, threshold = 0.74) {
    if (start + count > entries.length) return false;
    for (let index = start + 1; index < start + count; index += 1) {
      const boundary = signals[index] || {};
      if (boundary.hardBreak || number(boundary.breakStrength, 0.5) > threshold) return false;
    }
    return true;
  }

  function supportsLead(main, supportA, supportB, variant) {
    if (!main || !supportA || !supportB) return false;
    if ([main, supportA, supportB].some(entry => isFeature(entry, variant))) return false;
    const mainWeight = sourceWeight(main);
    const supportMax = Math.max(sourceWeight(supportA), sourceWeight(supportB));
    const supportCombined = sourceWeight(supportA) + sourceWeight(supportB);
    const shortSupports = [supportA, supportB].every(entry => entryKind(entry, variant) === 'note' || number(entry?.chars) <= 720);
    const relatedNotes = [supportA, supportB].every(entry => {
      const fn = editorialFor(entry)?.function;
      return entry?.provenance === 'authored' || ['response', 'continuation', 'fragment'].includes(fn);
    });
    const proportionalLead = mainWeight >= supportMax * variant.leadRatio && supportCombined <= mainWeight * 1.35;
    return proportionalLead || (shortSupports && relatedNotes);
  }

  function matrixGroup(start, count, variant, signals, ratioLimit) {
    if (!canStayTogether(start, count, signals)) return false;
    const group = entries.slice(start, start + count);
    if (group.some(entry => isFeature(entry, variant))) return false;
    return sameMatrixFamily(group, variant) && ratioFor(group) <= ratioLimit;
  }

  function formBands(variant) {
    const signals = boundaryList();
    const bands = [];
    let index = 0;

    while (index < entries.length) {
      const remaining = entries.length - index;
      const current = entries[index];
      if (isFeature(current, variant)) {
        bands.push({ type: 'feature', start: index, end: index + 1, fitCost: 0 });
        index += 1;
        continue;
      }

      const canLead = remaining >= 3 &&
        canStayTogether(index, 3, signals, 0.7) &&
        supportsLead(entries[index], entries[index + 1], entries[index + 2], variant);

      if (variant.preferLead && canLead) {
        bands.push({ type: 'lead', start: index, end: index + 3, fitCost: 0 });
        index += 3;
        continue;
      }
      if (remaining >= 4 && matrixGroup(index, 4, variant, signals, variant.matrix4Ratio)) {
        const group = entries.slice(index, index + 4);
        bands.push({ type: 'matrix', start: index, end: index + 4, fitCost: Math.max(0, ratioFor(group) - 1.12) * 12 });
        index += 4;
        continue;
      }
      if (canLead) {
        bands.push({ type: 'lead', start: index, end: index + 3, fitCost: 1.5 });
        index += 3;
        continue;
      }
      if (remaining >= 3 && matrixGroup(index, 3, variant, signals, variant.matrix3Ratio)) {
        const group = entries.slice(index, index + 3);
        bands.push({ type: 'matrix', start: index, end: index + 3, fitCost: 2 + Math.max(0, ratioFor(group) - 1.12) * 12 });
        index += 3;
        continue;
      }
      if (remaining >= 2 && matrixGroup(index, 2, variant, signals, variant.matrix2Ratio)) {
        const group = entries.slice(index, index + 2);
        bands.push({ type: 'matrix', start: index, end: index + 2, fitCost: Math.max(0, ratioFor(group) - 1.12) * 10 });
        index += 2;
        continue;
      }
      bands.push({ type: 'feature', start: index, end: index + 1, fitCost: 7 });
      index += 1;
    }

    bands.forEach((band, bandIndex) => {
      band.id = bandIndex;
      band.label = `${String(bandIndex + 1).padStart(2, '0')} / ${band.type.toUpperCase()}`;
    });
    return { bands, signals };
  }

  function ensureMeasureHost() {
    if (I.state.measureHost?.isConnected) return I.state.measureHost;
    const host = document.createElement('div');
    host.id = 'typeblock-index-measure-host';
    Object.assign(host.style, {
      position: 'absolute', left: '-100000px', top: '0', width: '0', height: '0',
      visibility: 'hidden', pointerEvents: 'none'
    });
    document.body.appendChild(host);
    I.state.measureHost = host;
    return host;
  }

  function headerMetrics(entry, span, role) {
    const projection = projectionFor(entry);
    const title = String(projection?.title || '');
    const deck = String(projection?.deck || '');
    if (!title && !deck) return { rows: 0, height: 0, titleLines: 0, deckLines: 0 };

    const width = contentWidth(span);
    const key = [VERSION, profileKey(), entry?.digest || entry?.id, span, role, width.toFixed(2), title, deck].join('|');
    const cached = I.state.headerCache.get(key);
    if (cached) return cached;

    const probe = document.createElement('article');
    probe.className = `editorial-cell cell-${role}`;
    probe.style.width = `${width}px`;
    probe.style.padding = '0';
    ensureMeasureHost().appendChild(probe);

    function measure(node, fallbackLine, maxLines) {
      probe.appendChild(node);
      Object.assign(node.style, { position: 'static', display: 'block', overflow: 'visible' });
      const style = getComputedStyle(node);
      const line = number(style.lineHeight, fallbackLine);
      const lines = Math.min(maxLines, Math.max(1, Math.ceil(node.scrollHeight / Math.max(1, line))));
      const height = lines * line + number(style.marginBottom, 0);
      node.remove();
      return { lines, height };
    }

    let titleMetric = { lines: 0, height: 0 };
    let deckMetric = { lines: 0, height: 0 };
    if (title) {
      const node = document.createElement('h3');
      node.className = 'article-title';
      node.textContent = title;
      titleMetric = measure(node, role === 'feature' || role === 'lead' ? 32 : 24, role === 'support' ? 3 : 2);
    }
    if (deck) {
      const node = document.createElement('p');
      node.className = 'article-deck';
      node.textContent = deck;
      deckMetric = measure(node, role === 'support' ? 16 : 24, role === 'support' || role === 'matrix' ? 2 : 3);
    }
    probe.remove();

    const height = titleMetric.height + deckMetric.height;
    const result = {
      rows: height ? Math.ceil(height / UNIT) : 0,
      height,
      titleLines: titleMetric.lines,
      deckLines: deckMetric.lines
    };
    I.state.headerCache.set(key, result);
    return result;
  }

  function roleLineRange(role, entry) {
    const text = displayBody(entry);
    const cjk = ((text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length / Math.max(1, text.length)) > 0.25;
    if (role === 'support') return cjk ? [5, 11] : [14, 30];
    if (role === 'matrix') return cjk ? [8, 16] : [22, 42];
    return cjk ? (isMobile() ? [16, 27] : [22, 40]) : (isMobile() ? [36, 60] : [45, 70]);
  }

  function bodyRowsFor(entry, span, role) {
    const minimum = role === 'support' ? 6 : role === 'matrix' ? 9 : 12;
    return quantizeRows(Math.max(minimum, Math.ceil(layoutWeight(entry) / Math.max(1, span))));
  }

  function shapeFor(entry, span, rows, bodyRows, role) {
    const metric = window.TypeBlockTextMetrics?.shapeMetrics?.(entry, span, rows) || {};
    const cpl = number(metric.cpl, number(entry?.chars, 1) / Math.max(1, Math.floor(bodyRows / I.constants.bodyBaselineRows)));
    const range = roleLineRange(role, entry);
    const lineCost = cpl < range[0] ? (range[0] - cpl) * 1.9 : cpl > range[1] ? (cpl - range[1]) * 1.25 : 0;
    const previewLines = Math.max(1, Math.floor(bodyRows / I.constants.bodyBaselineRows));
    const sourceLines = Math.max(1, number(metric.fullLineCount, previewLines));
    return {
      intrinsic: Math.max(0, Math.min(100, lineCost + (projectionFor(entry)?.title ? 0 : role === 'support' ? 4 : 12))),
      editorial: 0,
      context: 0,
      stability: 0,
      fill: 1,
      cpl,
      aspect: cellWidth(span) / Math.max(UNIT, rows * UNIT),
      previewLines,
      previewCoverage: Math.min(1, previewLines / sourceLines),
      total: 0
    };
  }

  Object.assign(I, {
    escapeHTML, number, quantizeRows, activeProfileLabel, profileKey, isMobile, gutter,
    layoutWidth, columnWidth, cellWidth, contentWidth, projectionFor, displayBody,
    editorialFor, sourceWeight, layoutWeight, entryKind, ratioFor, formBands,
    headerMetrics, bodyRowsFor, shapeFor,
    datasetSignature: () => `${VERSION}|${I.baseDatasetSignature()}`,
    isActive: () => true
  });

  if (typeof layoutMinSpan === 'function') {
    const baseMinimumSpan = layoutMinSpan;
    layoutMinSpan = entry => {
      if (!isMobile()) return baseMinimumSpan(entry);
      if (entry?.provenance === 'authored' && number(entry?.chars) <= 360) return 2;
      return 3;
    };
  }

  function clearHeaderCache(reason) {
    I.state.headerCache.clear();
    const status = document.getElementById('indexStatus');
    if (status) status.dataset.reason = reason;
  }
  addEventListener('resize', () => clearHeaderCache('resize'), { passive: true });
  document.fonts?.ready?.then?.(() => clearHeaderCache('fonts-ready'));
  document.fonts?.addEventListener?.('loadingdone', () => clearHeaderCache('font-loading-done'));
})();