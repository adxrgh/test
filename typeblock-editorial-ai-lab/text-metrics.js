(() => {
  'use strict';

  const VERSION = 'type-v1';
  const cache = new Map();
  let host = null;
  let lastReason = 'initial';

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
    host.id = 'typeblock-text-metrics-host';
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

  function profileKey() {
    return typeof layoutProfileKey === 'function' ? layoutProfileKey() : 'desktop';
  }

  function gutter() {
    return typeof layoutGutter === 'function' ? layoutGutter() : 12;
  }

  function layoutWidth() {
    const node = document.getElementById('layout');
    const measured = Number(node?.clientWidth || 0);
    if (measured > 0) return measured;
    return profileKey() === 'mobile' ? 358 : 720;
  }

  function blockWidth(span) {
    const gap = gutter();
    const column = (layoutWidth() - gap * 5) / 6;
    return Math.max(1, span * column + (span - 1) * gap);
  }

  function bodyWidth(span) {
    return Math.max(24, blockWidth(span) - cssNumber('--tb-block-pad-x', 8) * 2);
  }

  function lineHeight() {
    return cssNumber('--tb-type-body-line', 24);
  }

  function chromeHeight(entry) {
    const base = cssNumber('--tb-block-chrome', 32);
    const cue = entry?.cue ? cssNumber('--tb-type-cue-line', 24) : 0;
    return base + cue;
  }

  function cacheKey(entry, span) {
    const width = bodyWidth(span).toFixed(2);
    const digest = entry?.digest || entry?.externalId || entry?.id || 'entry';
    return [VERSION, profileKey(), digest, span, width].join('|');
  }

  function lineRects(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const raw = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    range.detach?.();
    const lines = new Map();
    raw.forEach(rect => {
      const key = Math.round(rect.top * 2) / 2;
      const existing = lines.get(key);
      if (!existing) {
        lines.set(key, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        return;
      }
      existing.left = Math.min(existing.left, rect.left);
      existing.right = Math.max(existing.right, rect.right);
      existing.bottom = Math.max(existing.bottom, rect.bottom);
    });
    return [...lines.values()].sort((a, b) => a.top - b.top);
  }

  function measure(entry, span) {
    const key = cacheKey(entry, span);
    const cached = cache.get(key);
    if (cached) return cached;

    const width = bodyWidth(span);
    const node = document.createElement('div');
    node.textContent = String(entry?.body || '');
    Object.assign(node.style, {
      width: `${width}px`,
      margin: '0',
      padding: '0',
      border: '0',
      fontFamily: cssString('--tb-font-sans', 'sans-serif'),
      fontSize: `${cssNumber('--tb-type-body-size', 16)}px`,
      lineHeight: `${lineHeight()}px`,
      fontWeight: String(cssNumber('--tb-type-body-weight', 400)),
      letterSpacing: cssString('--tb-tracking-body', '0'),
      whiteSpace: 'normal',
      overflowWrap: 'break-word',
      wordBreak: 'normal',
      textWrap: 'pretty',
      fontSynthesis: 'none'
    });
    ensureHost().appendChild(node);

    const rects = lineRects(node);
    const fallbackLines = Math.max(1, Math.round(node.scrollHeight / lineHeight()));
    const fullLineCount = Math.max(1, rects.length || fallbackLines);
    const characterCount = Math.max(1, Number(entry?.chars || String(entry?.body || '').length || 1));
    const cpl = characterCount / fullLineCount;
    const last = rects.at(-1);
    const lastLineRatio = last ? Math.max(0, Math.min(1, (last.right - last.left) / width)) : 1;
    const result = {
      version: VERSION,
      profile: profileKey(),
      span,
      blockWidth: blockWidth(span),
      bodyWidth: width,
      lineHeight: lineHeight(),
      fullLineCount,
      fullTextHeight: fullLineCount * lineHeight(),
      cpl,
      lastLineRatio,
      cjkRatio: characterCount ? ((String(entry?.body || '').match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length / characterCount) : 0
    };

    node.remove();
    cache.set(key, result);
    updateStatus();
    return result;
  }

  function visibleLines(entry, span, rows) {
    const available = Math.max(lineHeight(), Number(rows || 0) * 8 - chromeHeight(entry));
    return Math.max(1, Math.floor(available / lineHeight()));
  }

  function rowsFor(entry, span, baseRows) {
    const metric = measure(entry, span);
    const basePixels = Math.max(32, Number(baseRows || 0) * 8);
    const chrome = chromeHeight(entry);
    const requested = Math.max(1, Math.round((basePixels - chrome) / lineHeight()));
    const minimum = metric.fullLineCount <= 1 ? 1 : 2;
    const lines = Math.max(minimum, Math.min(metric.fullLineCount, requested));
    return Math.max(4, Math.ceil((chrome + lines * lineHeight()) / 8));
  }

  function shapeMetrics(entry, span, rows) {
    const metric = measure(entry, span);
    const visible = visibleLines(entry, span, rows);
    const fullyVisible = metric.fullLineCount <= visible;
    const fill = metric.fullLineCount >= visible ? 1 : metric.fullLineCount / Math.max(1, visible);
    return {
      ...metric,
      visibleLines: visible,
      fullyVisible,
      fill,
      lastLineRatio: fullyVisible ? metric.lastLineRatio : 1,
      chromeHeight: chromeHeight(entry)
    };
  }

  function invalidate(reason = 'manual') {
    cache.clear();
    lastReason = reason;
    updateStatus();
  }

  function updateStatus() {
    const node = document.getElementById('typographyStatus');
    if (!node) return;
    node.innerHTML = `<strong>TYPE V1 READY</strong> — 16/24 body, 20/24 dominant, 4/8 baseline lock; ${cache.size} browser-measured text states cached locally.`;
    node.dataset.reason = lastReason;
  }

  function scheduleRegenerate(reason) {
    setTimeout(() => {
      invalidate(reason);
      if (typeof generate === 'function' && typeof entries !== 'undefined' && entries.length) {
        candidates = [];
        selected = 0;
        generate();
      }
    }, 0);
  }

  window.TypeBlockTextMetrics = {
    version: VERSION,
    measure,
    rowsFor,
    visibleLines,
    shapeMetrics,
    invalidate,
    cacheSize: () => cache.size,
    status: () => ({ version: VERSION, cached: cache.size, reason: lastReason })
  };

  addEventListener('resize', () => invalidate('resize'), { passive: true });
  if (document.fonts?.ready) document.fonts.ready.then(() => scheduleRegenerate('fonts-ready'));
  document.fonts?.addEventListener?.('loadingdone', () => scheduleRegenerate('font-loading-done'));
  updateStatus();
})();
