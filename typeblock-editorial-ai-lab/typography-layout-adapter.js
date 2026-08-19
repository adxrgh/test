(() => {
  'use strict';

  if (!window.TypeBlockTextMetrics) return;

  const profile = window.TypeBlockLayoutProfile;
  if (profile) {
    profile.lineMeasureRange = entry => {
      const text = String(entry?.body || '');
      const cjk = text.length ? ((text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length / text.length) > 0.25 : false;
      if (profile.isMobile()) return cjk ? [18, 24] : [36, 55];
      return cjk ? [22, 32] : [45, 65];
    };
  }

  rowsFor = function measuredRowsFor(entry, span) {
    const base = Math.max(4, Math.round(layoutTargetFor(entry) / span));
    return window.TypeBlockTextMetrics.rowsFor(entry, span, base);
  };

  intrinsic = function measuredIntrinsic(entry, placement) {
    const metric = window.TypeBlockTextMetrics.shapeMetrics(entry, placement.span, placement.rows);
    const range = layoutLineMeasureRange(entry);
    const cpl = metric.cpl;
    const lineCost = cpl < range[0]
      ? (range[0] - cpl) * 2.25
      : cpl > range[1]
        ? (cpl - range[1]) * 1.55
        : 0;
    const fillCost = metric.fill < 0.72 ? (0.72 - metric.fill) * 120 : 0;
    const widowCost = metric.fullyVisible && metric.lastLineRatio < 0.16
      ? (0.16 - metric.lastLineRatio) * 180
      : 0;
    const height = Math.max(8, placement.rows * U);
    const aspect = metric.blockWidth / height;
    const minAspect = isMobileLayout() ? 0.26 : 0.48;
    const maxAspect = isMobileLayout() ? 4.8 : 5.6;
    const aspectCost = aspect < minAspect
      ? (minAspect - aspect) * 42
      : aspect > maxAspect
        ? (aspect - maxAspect) * 9
        : 0;
    return {
      cost: clamp(lineCost + fillCost + widowCost + aspectCost, 0, 100),
      fill: metric.fill,
      cpl,
      aspect,
      fullLineCount: metric.fullLineCount,
      visibleLines: metric.visibleLines,
      lastLineRatio: metric.lastLineRatio,
      fullyVisible: metric.fullyVisible,
      widow: widowCost
    };
  };

  makeLocalPlacement = function measuredLocalPlacement(entry, index, x, row, span, phraseId, templateName, phraseSize) {
    const placement = { id: entry.id, x, row, span, rows: rowsFor(entry, span), phraseId, template: templateName };
    const measured = intrinsic(entry, placement);
    placement.shape = {
      intrinsic: measured.cost,
      editorial: roleSpanCost(entry, span, phraseSize),
      context: 0,
      stability: stability(entry, placement),
      fill: measured.fill,
      cpl: measured.cpl,
      aspect: measured.aspect,
      fullLineCount: measured.fullLineCount,
      visibleLines: measured.visibleLines,
      lastLineRatio: measured.lastLineRatio,
      fullyVisible: measured.fullyVisible,
      widow: measured.widow,
      total: 0
    };
    return placement;
  };
})();
