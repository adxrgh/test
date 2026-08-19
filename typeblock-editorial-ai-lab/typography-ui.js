(() => {
  'use strict';

  const metrics = window.TypeBlockTextMetrics;
  if (!metrics) return;

  if (typeof activeDatasetSignature === 'function') {
    const baseDatasetSignature = activeDatasetSignature;
    activeDatasetSignature = () => `${metrics.version}|${baseDatasetSignature()}`;
  }
  if (typeof candidateSignature === 'function') {
    const baseCandidateSignature = candidateSignature;
    candidateSignature = state => `${metrics.version}|${baseCandidateSignature(state)}`;
  }

  if (typeof renderLayout === 'function') {
    const baseRenderLayout = renderLayout;
    renderLayout = function typographyRenderLayout() {
      baseRenderLayout();
      const candidate = candidates[selected];
      if (!candidate) return;
      document.querySelectorAll('#layout .block').forEach((block, index) => {
        const entry = entries[index];
        const placement = candidate.ps[index];
        const body = block.querySelector('.body');
        if (!entry || !placement || !body) return;
        const lineCount = metrics.visibleLines(entry, placement.span, placement.rows);
        body.style.webkitLineClamp = String(lineCount);
        body.style.lineClamp = String(lineCount);
        block.dataset.textMetric = `${metrics.version}:${placement.span}:${lineCount}`;
      });
      const stageMeta = document.getElementById('stageMeta');
      if (stageMeta && !stageMeta.textContent.includes('TYPE V1')) stageMeta.textContent += ' · TYPE V1';
      const stats = document.getElementById('stats');
      if (stats && !stats.textContent.includes('typography:')) {
        stats.textContent = `typography: ${metrics.version} · 16/24 body · browser measured\n${stats.textContent}`;
      }
    };
  }

  if (typeof renderEditorial === 'function') {
    const baseRenderEditorial = renderEditorial;
    renderEditorial = function typographyRenderEditorial() {
      baseRenderEditorial();
      const entry = entries.find(item => item.id === focus);
      if (!entry) return;
      const index = entries.indexOf(entry);
      const placement = candidates[selected]?.ps?.[index];
      const grid = document.querySelector('#editorialInspector .editorial-grid');
      if (!placement || !grid) return;
      const measured = metrics.shapeMetrics(entry, placement.span, placement.rows);
      grid.insertAdjacentHTML(
        'beforeend',
        `<span>Typography</span><b>${uiEscape(metrics.version)}</b>` +
        `<span>Measured lines</span><b>${measured.fullLineCount} / ${measured.visibleLines}</b>` +
        `<span>Line measure</span><b>${measured.cpl.toFixed(1)} chars</b>` +
        `<span>Last line</span><b>${Math.round(measured.lastLineRatio * 100)}%</b>`
      );
    };
  }

  if (typeof setLayoutProfile === 'function') {
    const baseSetLayoutProfile = setLayoutProfile;
    setLayoutProfile = function typographySetLayoutProfile(id) {
      metrics.invalidate(`profile:${id}`);
      return baseSetLayoutProfile(id);
    };
  }

  if (typeof applyText === 'function') {
    const baseApplyText = applyText;
    applyText = function typographyApplyText(preserve = true) {
      metrics.invalidate('content');
      return baseApplyText(preserve);
    };
  }
})();
