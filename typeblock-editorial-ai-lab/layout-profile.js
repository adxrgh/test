(() => {
  'use strict';

  const STORAGE_KEY = 'typeblock-layout-profile-v1';
  const PROFILES = {
    desktop: {
      id: 'desktop',
      label: 'Desktop',
      canvasWidth: null,
      viewportHeight: null,
      margin: 0,
      gutter: 12,
      referenceColumnWidth: 110
    },
    mobile: {
      id: 'mobile',
      label: 'Mobile 390×844',
      canvasWidth: 390,
      viewportHeight: 844,
      margin: 16,
      gutter: 8,
      referenceColumnWidth: 110
    }
  };

  function savedProfile() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return PROFILES[value] ? value : null;
    } catch {
      return null;
    }
  }

  // The lab now opens in the phone profile so the new behavior is immediately visible.
  let current = savedProfile() || 'mobile';

  function active() {
    return PROFILES[current];
  }

  function isMobile() {
    return current === 'mobile';
  }

  function applyDom() {
    const profile = active();
    document.documentElement.dataset.layoutProfile = profile.id;
    const app = document.getElementById('app');
    const stage = document.querySelector('.stage');
    app?.classList.toggle('profile-mobile', isMobile());
    app?.classList.toggle('profile-desktop', !isMobile());
    stage?.classList.toggle('profile-mobile-stage', isMobile());
    document.querySelectorAll('[data-layout-profile]').forEach(button => {
      button.classList.toggle('on', button.dataset.layoutProfile === profile.id);
      button.setAttribute('aria-pressed', String(button.dataset.layoutProfile === profile.id));
    });
    const status = document.getElementById('profileStatus');
    if (status) {
      status.innerHTML = isMobile()
        ? '<strong>MOBILE 390×844</strong> — six logical columns, 16 pt margins, 8 pt gutters; long text is restricted to 5–6 columns.'
        : '<strong>DESKTOP</strong> — the full six-column Editorial Phrase template set is active.';
    }
  }

  function set(id) {
    if (!PROFILES[id]) return active();
    current = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
    applyDom();
    return active();
  }

  function layoutWidth() {
    const node = document.getElementById('layout');
    const measured = Number(node?.clientWidth || 0);
    if (measured > 0) return measured;
    const profile = active();
    return profile.canvasWidth
      ? profile.canvasWidth - profile.margin * 2
      : 720;
  }

  function columnWidth() {
    const profile = active();
    return Math.max(1, (layoutWidth() - profile.gutter * (C - 1)) / C);
  }

  function targetScale() {
    if (!isMobile()) return 1;
    const ratio = active().referenceColumnWidth / columnWidth();
    return clamp(ratio, 1.65, 2.15);
  }

  function targetFor(entry) {
    return Math.max(1, Number(entry?.target || 1) * targetScale());
  }

  function cjkRatio(entry) {
    const text = String(entry?.body || '');
    if (!text.length) return 0;
    const count = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    return count / text.length;
  }

  function minSpan(entry) {
    if (!isMobile()) return 2;
    const metadata = entry?.editorial?.status === 'ready' ? entry.editorial : null;
    const fn = metadata?.function || 'neutral';
    const chars = Number(entry?.chars || 0);
    const territory = Number(entry?.target || 0);

    if (fn === 'referenceMaterial' || chars >= 760 || territory >= 64) return 5;
    if (fn === 'background' || chars >= 360 || territory >= 43) return 4;
    if (entry?.provenance === 'authored' && chars <= 280) return 3;
    return 4;
  }

  function lineMeasureRange(entry) {
    const cjk = cjkRatio(entry) > 0.25;
    if (isMobile()) return cjk ? [16, 27] : [38, 62];
    return cjk ? [25, 44] : [55, 76];
  }

  function viewportHeight() {
    return active().viewportHeight || Math.max(520, window.innerHeight || 720);
  }

  window.TypeBlockLayoutProfile = {
    profiles: PROFILES,
    active,
    set,
    isMobile,
    applyDom,
    layoutWidth,
    columnWidth,
    targetScale,
    targetFor,
    minSpan,
    lineMeasureRange,
    viewportHeight,
    key: () => current
  };

  applyDom();
})();

function isMobileLayout(){return Boolean(window.TypeBlockLayoutProfile?.isMobile?.())}
function layoutGutter(){return Number(window.TypeBlockLayoutProfile?.active?.().gutter || G)}
function layoutTargetFor(entry){return Number(window.TypeBlockLayoutProfile?.targetFor?.(entry) || entry?.target || 1)}
function layoutMinSpan(entry){return Number(window.TypeBlockLayoutProfile?.minSpan?.(entry) || 2)}
function layoutLineMeasureRange(entry){return window.TypeBlockLayoutProfile?.lineMeasureRange?.(entry) || [30,76]}
function layoutViewportHeight(){return Number(window.TypeBlockLayoutProfile?.viewportHeight?.() || Math.max(520,innerHeight||720))}
function layoutProfileKey(){return String(window.TypeBlockLayoutProfile?.key?.() || 'desktop')}
