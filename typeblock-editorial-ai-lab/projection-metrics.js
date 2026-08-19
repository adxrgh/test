(() => {
  'use strict';

  const metrics = window.TypeBlockTextMetrics;
  if (!metrics) return;

  const BASE_VERSION = metrics.version;
  const VERSION = `${BASE_VERSION}+projection-v1`;
  const headerCache = new Map();
  let host = null;

  const baseMeasure = metrics.measure.bind(metrics);
  const baseRowsFor = metrics.rowsFor.bind(metrics);
  const baseVisibleLines = metrics.visibleLines.bind(metrics);
  const baseShapeMetrics = metrics.shapeMetrics.bind(metrics);
  const baseInvalidate = metrics.invalidate.bind(metrics);

  function rootStyle() {
    return getComputedStyle(document.documentElement);
  }

  function cssNumber(name, fallback) {
    const value = Number.parseFloat(rootStyle().getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function cssString(name, fallback) {
    const value = rootStyle().getPropertyValue(name).trim();
    return value || fallback;
  }

  function ensureHost() {
    if (host?.isConnected) return host;
    host = document.createElement('div');
    host.id = 'typeblock-projection-metrics-host';
    Object.assign(host.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      width: '0',
      height: '0',
      visibility: 'hidden',
      pointerEvents: 'none'
    });
    document.body.appendChild(host);
    return host;
  }

  function projection(entry) {
    const value = entry?.projection;
    if (!value || value.status === 'notNeeded') return null;
    if (!value.title && !value.deck) return null;
    return value;
  }

  function displayBody(entry) {
    if (window.EditorialProjection?.displayBody) return window.EditorialProjection.displayBody(entry);
    return String(entry?.projection?.bodyText || entry?.body || '');
  }

  function proxyEntry(entry) {
    const body = displayBody(entry);
    const marker = [
      entry?.projection?.titleSource || 'none',
      entry?.projection?.title?.length || 0,
      entry?.projection?.bodyText?.length || body.length
    ].join(':');
    return {
      ...entry,
      body,
      chars: body.length,
      digest: `${entry?.digest || entry?.id || 'entry'}:projection-body:${marker}`
    };
  }

  function typographyFor(kind) {
    const mobile = typeof isMobileLayout === 'function' && isMobileLayout();
    if (kind === 'title') {
      return {
        family: cssString('--tb-font-sans', 'sans-serif'),
        size: cssNumber(mobile ? '--tb-type-title-mobile-size' : '--tb-type-title-size', mobile ? 25 : 31),
        line: cssNumber(mobile ? '--tb-type-title-mobile-line' : '--tb-type-title-line', mobile ? 32 : 40),
        weight: cssNumber('--tb-type-title-weight', 700),
        tracking: cssString('--tb-tracking-title', '-0.02em'),
        maxLines: 2
      };
    }
    return {
      family: cssString('--tb-font-sans', 'sans-serif'),
      size: cssNumber('--tb-type-deck-size', 20),
      line: cssNumber('--tb-type-deck-line', 24),
      weight: cssNumber('--tb-type-deck-weight', 500),
      tracking: cssString('--tb-tracking-deck', '-0.005em'),
      maxLines: 3
    };
  }

  function measureText(text, width, kind) {
    if (!text) return { lines: 0, height: 0 };
    const type = typographyFor(kind);
    const node = document.createElement('div');
    node.textContent = String(text);
    Object.assign(node.style, {
      width: `${width}px`,
      margin: '0',
      padding: '0',
      border: '0',
      fontFamily: type.family,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: String(type.weight),
      letterSpacing: type.tracking,
      whiteSpace: 'normal',
      overflowWrap: 'break-word',
      wordBreak: 'normal',
      textWrap: 'balance',
      fontSynthesis: 'none'
    });
    ensureHost().appendChild(node);
    const measuredLines = Math.max(1, Math.ceil(node.scrollHeight / type.line));
    const lines = Math.min(type.maxLines, measuredLines);
    node.remove();
    return { lines, height: lines * type.line };
  }

  function headerMetrics(entry, span) {
    const value = projection(entry);
    if (!value) return { titleLines: 0, deckLines: 0, extraHeight: 0, extraRows: 0 };
    const bodyMetric = baseMeasure(proxyEntry(entry), span);
    const key = [
      VERSION,
      typeof layoutProfileKey === 'function' ? layoutProfileKey() : 'desktop',
      entry?.digest || entry?.id,
      span,
      bodyMetric.bodyWidth.toFixed(2),
      value.title || '',
      value.deck || ''
    ].join('|');
    const cached = headerCache.get(key);
    if (cached) return cached;

    const title = measureText(value.title, bodyMetric.bodyWidth, 'title');
    const deck = measureText(value.deck, bodyMetric.bodyWidth, 'deck');
    const titleGap = title.lines ? cssNumber('--tb-projection-title-gap', 8) : 0;
    const deckGap = deck.lines ? cssNumber('--tb-projection-deck-gap', 8) : 0;
    const extraHeight = title.height + titleGap + deck.height + deckGap;
    const result = {
      titleLines: title.lines,
      deckLines: deck.lines,
      titleHeight: title.height,
      deckHeight: deck.height,
      extraHeight,
      extraRows: Math.ceil(extraHeight / 8)
    };
    headerCache.set(key, result);
    return result;
  }

  function measure(entry, span) {
    const result = baseMeasure(proxyEntry(entry), span);
    return { ...result, projectionHeader: headerMetrics(entry, span) };
  }

  function rowsFor(entry, span, baseRows) {
    const bodyRows = baseRowsFor(proxyEntry(entry), span, baseRows);
    return bodyRows + headerMetrics(entry, span).extraRows;
  }

  function bodyRows(entry, span, rows) {
    return Math.max(0, Number(rows || 0) - headerMetrics(entry, span).extraRows);
  }

  function bodyArea(entry, placement) {
    if (!placement) return 0;
    return Number(placement.span || 0) * bodyRows(entry, placement.span, placement.rows);
  }

  function visibleLines(entry, span, rows) {
    return baseVisibleLines(proxyEntry(entry), span, Math.max(4, bodyRows(entry, span, rows)));
  }

  function shapeMetrics(entry, span, rows) {
    const header = headerMetrics(entry, span);
    const result = baseShapeMetrics(proxyEntry(entry), span, Math.max(4, bodyRows(entry, span, rows)));
    return { ...result, projectionHeader: header, chromeHeight: result.chromeHeight + header.extraHeight };
  }

  function invalidate(reason = 'projection') {
    headerCache.clear();
    baseInvalidate(reason);
  }

  metrics.version = VERSION;
  metrics.measure = measure;
  metrics.rowsFor = rowsFor;
  metrics.bodyRows = bodyRows;
  metrics.bodyArea = bodyArea;
  metrics.visibleLines = visibleLines;
  metrics.shapeMetrics = shapeMetrics;
  metrics.headerMetrics = headerMetrics;
  metrics.displayBody = displayBody;
  metrics.invalidate = invalidate;
  metrics.baseVersion = BASE_VERSION;

  addEventListener('resize', () => headerCache.clear(), { passive: true });
  if (document.fonts?.ready) document.fonts.ready.then(() => headerCache.clear());
  document.fonts?.addEventListener?.('loadingdone', () => headerCache.clear());
})();
