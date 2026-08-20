(() => {
  'use strict';

  const I = window.TypeBlockEditorialIndex;
  if (!I || typeof renderLayout !== 'function') return;

  function installMeasureHost() {
    let host = document.getElementById('typeblock-index-measure-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'typeblock-index-measure-host';
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
    }
    host.classList.add('editorial-index-layout');
    I.state.measureHost = host;
  }

  function installRuntimeStyles() {
    if (document.getElementById('typeblock-index-runtime-style')) return;
    const style = document.createElement('style');
    style.id = 'typeblock-index-runtime-style';
    style.textContent = '.editorial-index-layout .cell-matrix .article-title{-webkit-line-clamp:2;}';
    document.head.appendChild(style);
  }

  installMeasureHost();
  installRuntimeStyles();

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