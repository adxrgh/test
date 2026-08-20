(() => {
  'use strict';

  const I = window.TypeBlockEditorialIndex;
  if (!I || typeof renderLayout !== 'function') return;

  const baseRenderLayout = renderLayout;
  renderLayout = function finalizedEditorialIndexRender() {
    baseRenderLayout();
    const candidate = candidates[selected];
    if (!candidate) return;

    document.querySelectorAll('#layout .editorial-cell').forEach((cell, index) => {
      const placement = candidate.ps[index];
      const body = cell.querySelector('.body');
      if (!placement || !body) return;
      const lines = Math.max(1, Number(placement.shape?.previewLines || 1));
      body.style.webkitLineClamp = String(lines);
      body.style.lineClamp = String(lines);
      cell.dataset.previewLines = String(lines);
      cell.dataset.previewCoverage = String(Number(placement.shape?.previewCoverage || 0));
    });
    I.updateStatus?.();
  };

  ['clean', 'grid', 'bounds', 'worst'].forEach(id => {
    const control = document.getElementById(id);
    if (control) control.onchange = renderLayout;
  });
  const semantic = document.getElementById('semantic');
  if (semantic) semantic.onchange = () => generate();
})();