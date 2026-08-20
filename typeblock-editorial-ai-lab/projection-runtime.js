(() => {
  'use strict';

  const VERSION = 'projection-control-v1';
  const button = document.getElementById('analyzeProjection');
  const status = document.getElementById('projectionStatus');
  const projection = window.EditorialProjection;
  let busy = false;

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setStatus(html) {
    if (status) status.innerHTML = html;
  }

  function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function backendHealth() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        signal: controller.signal
      });
      const raw = await response.text();
      let data = {};
      if (raw) {
        try { data = JSON.parse(raw); } catch {
          throw new Error(`Local backend health check returned non-JSON output (HTTP ${response.status}).`);
        }
      }
      if (!response.ok) throw new Error(data?.error || `Local backend health check failed with HTTP ${response.status}.`);
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Local backend health check timed out after 8 seconds.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleClick(event) {
    event?.preventDefault?.();

    if (busy) {
      setStatus('<strong>PROJECTION BUSY</strong> — a title/deck request is already running.');
      return;
    }
    if (!projection?.analyze) {
      setStatus('<strong>PROJECTION CONTROL FAILED</strong> — the Editorial Projection module did not initialize. Reload after updating the local files.');
      return;
    }

    busy = true;
    button.disabled = true;
    setStatus('<strong>CLICK RECEIVED</strong> — checking whether the running localhost backend supports Editorial Projection…');
    await nextPaint();

    try {
      const health = await backendHealth();
      const capability = health?.capabilities?.editorialProjection === true;
      if (!capability) {
        throw new Error(
          'The page files are newer than the running Node server. Stop the current npm process and restart npm start so /api/editorial-projection is loaded.'
        );
      }
      if (health.hasKey === false) {
        throw new Error('The local backend has no OpenRouter key. Check OPENROUTER_API_KEY in .env and restart npm start.');
      }

      setStatus('<strong>BACKEND READY</strong> — starting the missing title/deck projection…');
      await nextPaint();
      const result = await projection.analyze();
      if (!result?.ok && !status?.textContent?.includes('PARTIAL')) {
        setStatus('<strong>PROJECTION FAILED</strong> — the projection module returned an unsuccessful result. Check the terminal log for details.');
      }
    } catch (error) {
      setStatus(`<strong>PROJECTION DID NOT START</strong> — ${escapeHTML(error.message || error)}`);
      console.error('[TypeBlock projection control]', error);
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  if (!button || !status) return;
  button.type = 'button';
  button.dataset.projectionControl = VERSION;
  button.onclick = handleClick;
  status.dataset.projectionControl = VERSION;
})();
