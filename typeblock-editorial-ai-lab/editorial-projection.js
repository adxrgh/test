(() => {
  'use strict';

  const DB_NAME = 'typeblock-editorial-projection-v1';
  const DB_VERSION = 1;
  const STORE = 'projections';
  const SCHEMA_VERSION = 1;
  const DEFAULT_MODEL = 'openai/gpt-5-mini';
  const CLIENT_BATCH_SIZE = 2;
  const REQUEST_TIMEOUT_MS = 120000;
  const MIN_COLLECTED_TITLE = 220;
  const MIN_LONG_FORM = 600;

  let currentModel = DEFAULT_MODEL;
  let dbPromise = null;
  let restoreGeneration = 0;
  let storageWarning = null;

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function externalIdFor(entry, index = 0) {
    return String(entry?.externalId || `manual:${index + 1}`);
  }

  function sourceDigestFor(entry) {
    const source = String(entry?.rawBody || entry?.body || '');
    return typeof hash === 'function' ? hash(source) : String(entry?.digest || source.length);
  }

  function scopeKey(entry, index = 0) {
    return JSON.stringify([externalIdFor(entry, index), currentModel, SCHEMA_VERSION]);
  }

  function recordKey(entry, index = 0) {
    return JSON.stringify([externalIdFor(entry, index), sourceDigestFor(entry), currentModel, SCHEMA_VERSION]);
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is unavailable.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('scopeKey', 'scopeKey', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the projection cache.'));
      request.onblocked = () => reject(new Error('Projection cache upgrade is blocked by another tab.'));
    }).catch(error => {
      storageWarning = error;
      console.warn('[TypeBlock projection persistence]', error);
      return null;
    });
    return dbPromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Projection cache request failed.'));
    });
  }

  async function putRecords(records) {
    const db = await openDatabase();
    if (!db || !records.length) return 0;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      records.forEach(record => store.put(record));
      tx.oncomplete = () => resolve(records.length);
      tx.onerror = () => reject(tx.error || new Error('Projection cache write failed.'));
      tx.onabort = () => reject(tx.error || new Error('Projection cache write was aborted.'));
    }).catch(error => {
      storageWarning = error;
      console.warn('[TypeBlock projection persistence]', error);
      return 0;
    });
  }

  async function exactRecord(entry, index) {
    const db = await openDatabase();
    if (!db) return null;
    try {
      const tx = db.transaction(STORE, 'readonly');
      return await requestResult(tx.objectStore(STORE).get(recordKey(entry, index)));
    } catch (error) {
      storageWarning = error;
      console.warn('[TypeBlock projection persistence]', error);
      return null;
    }
  }

  async function scopeRecords(entry, index) {
    const db = await openDatabase();
    if (!db) return [];
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE).index('scopeKey');
      return (await requestResult(store.getAll(IDBKeyRange.only(scopeKey(entry, index))))) || [];
    } catch (error) {
      storageWarning = error;
      console.warn('[TypeBlock projection persistence]', error);
      return [];
    }
  }

  async function detectModel() {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (typeof data?.model === 'string' && data.model.trim()) currentModel = data.model.trim();
      }
    } catch {
      // Static previews keep the default model cache namespace.
    }
    return currentModel;
  }

  function languageFor(text) {
    const value = String(text || '');
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    if (cjk >= Math.max(4, latin * 0.35)) return 'zh';
    if (latin >= 4) return 'en';
    return 'other';
  }

  function planFor(entry) {
    const chars = Number(entry?.chars || String(entry?.body || '').length || 0);
    if (entry?.provenance === 'collected') {
      if (chars >= MIN_LONG_FORM) return { eligible: true, needTitle: true, needDeck: true, kind: 'long-collected' };
      if (chars >= MIN_COLLECTED_TITLE) return { eligible: true, needTitle: true, needDeck: false, kind: 'medium-collected' };
      return { eligible: false, needTitle: false, needDeck: false, kind: 'short-collected' };
    }
    if (chars >= MIN_LONG_FORM) return { eligible: true, needTitle: true, needDeck: false, kind: 'long-authored' };
    return { eligible: false, needTitle: false, needDeck: false, kind: 'casual-authored' };
  }

  function stripMetadataLines(chunk) {
    return String(chunk || '')
      .split(/\n/)
      .filter(line => !/^@(entry-id|source|cue)\s+/i.test(line))
      .join('\n')
      .trim();
  }

  function attachRawBodies(entryList, datasetText) {
    const chunks = String(datasetText || '').split(/\n\s*---\s*\n/).map(stripMetadataLines).filter(Boolean);
    entryList.forEach((entry, index) => {
      entry.rawBody = chunks[index] || String(entry.body || '');
    });
  }

  function cleanTitleCandidate(value) {
    return String(value || '')
      .replace(/^\s{0,3}#{1,6}\s*/, '')
      .replace(/^\s*["“”'‘’]+|["“”'‘’]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleLooksEditorial(value, restLength) {
    const title = cleanTitleCandidate(value);
    if (!title || restLength < 100) return false;
    if (/^(https?:\/\/|www\.|@|```|<\/?[a-z]|\{|\[)/i.test(title)) return false;
    if (/^[-*+•]\s+/.test(title) || /^\d+[.)、]\s*/.test(title)) return false;
    if (/[;{}=]{2,}|\b(const|let|var|function|class|import|struct)\b/i.test(title)) return false;
    const cjk = (title.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const words = title.split(/\s+/).filter(Boolean).length;
    const punctuation = (title.match(/[\p{P}\p{S}]/gu) || []).length;
    if (punctuation / Math.max(1, title.length) > 0.28) return false;
    if (cjk >= 4) return title.length >= 4 && title.length <= 42;
    if (cjk > 0) return false;
    return words >= 2 && words <= 14 && title.length <= 100;
  }

  function extractOriginalTitle(entry) {
    const raw = String(entry?.rawBody || '').replace(/\r\n?/g, '\n').trim();
    if (!raw.includes('\n')) return null;
    const lines = raw.split(/\n/);
    let titleIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim()) {
        titleIndex = index;
        break;
      }
    }
    if (titleIndex < 0) return null;
    const title = cleanTitleCandidate(lines[titleIndex]);
    const remainder = lines.slice(titleIndex + 1).join('\n').trim();
    if (!titleLooksEditorial(title, remainder.length)) return null;
    return {
      title,
      bodyText: remainder.replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim()
    };
  }

  function localProjection(entry) {
    const plan = planFor(entry);
    const extracted = plan.needTitle ? extractOriginalTitle(entry) : null;
    if (!plan.eligible) {
      return {
        status: 'notNeeded',
        plan: plan.kind,
        title: null,
        deck: null,
        titleSource: 'none',
        deckSource: 'none',
        bodyText: String(entry?.body || ''),
        confidence: 1,
        language: languageFor(entry?.body),
        sourceDigest: sourceDigestFor(entry),
        model: 'local-policy-v1',
        schemaVersion: SCHEMA_VERSION,
        generatedAt: null
      };
    }

    const title = extracted?.title || null;
    const needsTitle = plan.needTitle && !title;
    const needsDeck = plan.needDeck;
    return {
      status: needsTitle || needsDeck ? 'missing' : 'ready',
      plan: plan.kind,
      title,
      deck: null,
      titleSource: title ? 'extracted' : 'none',
      deckSource: 'none',
      bodyText: extracted?.bodyText || String(entry?.body || ''),
      confidence: title ? 0.98 : 0,
      language: languageFor(entry?.body),
      needsTitle,
      needsDeck,
      sourceDigest: sourceDigestFor(entry),
      model: title ? 'local-title-extractor-v1' : currentModel,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: title ? new Date().toISOString() : null
    };
  }

  function prepareEntries(entryList) {
    entryList.forEach(entry => {
      entry.projection = localProjection(entry);
      entry.projectionUsage = null;
    });
  }

  function projectionNeeds(entry) {
    const projection = entry?.projection;
    const plan = planFor(entry);
    if (!plan.eligible) return null;
    const needTitle = plan.needTitle && !String(projection?.title || '').trim();
    const needDeck = plan.needDeck && !String(projection?.deck || '').trim();
    if (!needTitle && !needDeck) {
      if (projection) projection.status = 'ready';
      return null;
    }
    return { needTitle, needDeck, plan };
  }

  function displayBody(entry) {
    return String(entry?.projection?.bodyText || entry?.body || '');
  }

  function normalizeGeneratedText(value, language, kind) {
    let text = String(value || '')
      .replace(/^\s*[#>*`"“”'‘’]+\s*/u, '')
      .replace(/["“”'‘’]+\s*$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    if (language === 'zh') {
      const limit = kind === 'title' ? 28 : 96;
      return [...text].slice(0, limit).join('').trim();
    }
    const limit = kind === 'title' ? 14 : 48;
    return text.split(/\s+/).slice(0, limit).join(' ').trim();
  }

  function projectionPayload(entry) {
    const needs = projectionNeeds(entry);
    if (!needs) return null;
    return {
      id: entry.id,
      provenance: entry.provenance,
      text: String(entry.body || ''),
      sourceDigest: sourceDigestFor(entry),
      needTitle: needs.needTitle,
      needDeck: needs.needDeck,
      existingTitle: String(entry.projection?.title || '')
    };
  }

  function estimateInput(entry) {
    const payload = projectionPayload(entry);
    return payload ? estimateTokens(JSON.stringify(payload)) : 0;
  }

  function projectionPreflight() {
    const todo = entries.filter(entry => projectionNeeds(entry));
    const input = todo.reduce((sum, entry) => sum + estimateInput(entry), 0);
    const output = todo.reduce((sum, entry) => {
      const needs = projectionNeeds(entry);
      return sum + (needs?.needTitle ? 36 : 0) + (needs?.needDeck ? 90 : 0);
    }, 0);
    return { count: todo.length, input, output, cost: priceCost(input, 0, output) };
  }

  function setStatus(html) {
    const node = document.getElementById('projectionStatus');
    if (node) node.innerHTML = html;
  }

  function renderLedger() {
    const node = document.getElementById('projectionLedger');
    if (!node) return;
    const preflight = projectionPreflight();
    const input = entries.reduce((sum, entry) => sum + Number(entry.projectionUsage?.inputTokens || 0), 0);
    const cached = entries.reduce((sum, entry) => sum + Number(entry.projectionUsage?.cachedInputTokens || 0), 0);
    const output = entries.reduce((sum, entry) => sum + Number(entry.projectionUsage?.outputTokens || 0), 0);
    const cost = entries.reduce((sum, entry) => sum + Number(entry.projectionUsage?.actualUSD || 0), 0);
    const generated = entries.filter(entry => entry.projection?.titleSource === 'generated' || entry.projection?.deckSource === 'generated').length;
    const extracted = entries.filter(entry => entry.projection?.titleSource === 'extracted').length;
    const average = generated ? cost / generated : 0;
    node.innerHTML =
      `<span>Next projection</span><b>${preflight.count} Entries</b>` +
      `<span>Preflight input</span><b>${preflight.input.toLocaleString()} tok</b>` +
      `<span>Estimated next cost</span><b>$${preflight.cost.toFixed(6)}</b>` +
      `<span>Original titles</span><b>${extracted}</b>` +
      `<span>AI projected</span><b>${generated}</b>` +
      `<span>Recorded input</span><b>${input.toLocaleString()}</b>` +
      `<span>Cached input</span><b>${cached.toLocaleString()}</b>` +
      `<span>Recorded output</span><b>${output.toLocaleString()}</b>` +
      `<span>Recorded cost</span><b>$${cost.toFixed(6)}</b>` +
      `<span>100-entry estimate</span><b>$${(average * 100).toFixed(4)}</b>`;
  }

  function invalidateAndGenerate(reason) {
    window.TypeBlockTextMetrics?.invalidate?.(`projection:${reason}`);
    candidates = [];
    selected = 0;
    if (typeof generate === 'function') generate();
    renderLedger();
  }

  async function saveEntries(entryList) {
    const records = [];
    entryList.forEach((entry, index) => {
      const projection = entry?.projection;
      if (!projection || projection.status !== 'ready' || !entry?.digest) return;
      records.push({
        key: recordKey(entry, index),
        scopeKey: scopeKey(entry, index),
        externalEntryID: externalIdFor(entry, index),
        sourceDigest: sourceDigestFor(entry),
        modelKey: currentModel,
        schemaVersion: SCHEMA_VERSION,
        projection: clone(projection),
        usage: clone(entry.projectionUsage || null),
        savedAt: new Date().toISOString()
      });
    });
    return putRecords(records);
  }

  function mergeRestored(entry, record) {
    const local = localProjection(entry);
    const cached = clone(record.projection || {});
    const projection = {
      ...local,
      ...cached,
      status: 'ready',
      sourceDigest: sourceDigestFor(entry),
      restored: true
    };
    if (local.titleSource === 'extracted') {
      projection.title = local.title;
      projection.titleSource = 'extracted';
      projection.bodyText = local.bodyText;
    }
    entry.projection = projection;
    entry.projectionUsage = clone(record.usage || null);
  }

  async function restore(entryList = entries) {
    const generation = ++restoreGeneration;
    await detectModel();
    let restored = 0;
    let local = 0;
    let stale = 0;
    let missing = 0;
    let notNeeded = 0;

    for (let index = 0; index < entryList.length; index += 1) {
      if (generation !== restoreGeneration) return null;
      const entry = entryList[index];
      entry.projection = localProjection(entry);
      entry.projectionUsage = null;
      if (entry.projection.status === 'notNeeded') {
        notNeeded += 1;
        continue;
      }

      const exact = await exactRecord(entry, index);
      if (exact?.projection) {
        mergeRestored(entry, exact);
        restored += 1;
        continue;
      }

      const previous = (await scopeRecords(entry, index))
        .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))[0];
      if (previous?.projection && projectionNeeds(entry)) {
        entry.projection.status = 'stale';
        entry.projection.previousSourceDigest = String(previous.sourceDigest || '');
        stale += 1;
      } else if (entry.projection.status === 'ready') {
        local += 1;
      } else {
        missing += 1;
      }
    }

    if (generation !== restoreGeneration) return null;
    invalidateAndGenerate('restore');
    setStatus(
      `<strong>PROJECTION RESTORED</strong> — ${restored} cached, ${local} original-title, ` +
      `${stale} stale, ${missing} missing, ${notNeeded} intentionally unprojected. No API call was made.`
    );
    return { restored, local, stale, missing, notNeeded, model: currentModel, warning: storageWarning };
  }

  async function requestBatch(batch) {
    const endpoint = document.getElementById('projectionEndpoint')?.value?.trim() || '/api/editorial-projection';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    let raw = '';
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, items: batch.map(projectionPayload) }),
        signal: controller.signal
      });
      raw = await response.text();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Local projection backend timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); } catch { throw new Error(`Projection backend returned non-JSON output (HTTP ${response.status}).`); }
    }
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);

    const map = new Map((data.projections || []).map(item => [item.id, item]));
    const omitted = batch.filter(entry => !map.has(entry.id));
    if (omitted.length) throw new Error(`Projection backend omitted Entry ${omitted.map(entry => entry.id).join(', ')}.`);

    const inputWeights = batch.map(entry => Math.max(1, estimateInput(entry)));
    const updates = batch.map(entry => {
      const source = entry.projection || localProjection(entry);
      const needs = projectionNeeds(entry);
      const result = map.get(entry.id);
      const language = ['zh', 'en', 'other'].includes(result.language) ? result.language : languageFor(entry.body);
      const generatedTitle = needs?.needTitle ? normalizeGeneratedText(result.title, language, 'title') : '';
      const generatedDeck = needs?.needDeck ? normalizeGeneratedText(result.deck, language, 'deck') : '';
      if (needs?.needTitle && !generatedTitle) throw new Error(`Entry ${entry.id} returned an empty required title.`);
      if (needs?.needDeck && !generatedDeck) throw new Error(`Entry ${entry.id} returned an empty required deck.`);
      return {
        entry,
        projection: {
          ...source,
          status: 'ready',
          title: source.title || generatedTitle || null,
          deck: source.deck || generatedDeck || null,
          titleSource: source.title ? source.titleSource : (generatedTitle ? 'generated' : 'none'),
          deckSource: source.deck ? source.deckSource : (generatedDeck ? 'generated' : 'none'),
          confidence: clamp(Number(result.confidence || 0), 0, 1),
          language,
          needsTitle: false,
          needsDeck: false,
          sourceDigest: sourceDigestFor(entry),
          model: data.model || currentModel,
          schemaVersion: SCHEMA_VERSION,
          generatedAt: new Date().toISOString()
        }
      };
    });
    updates.forEach(update => { update.entry.projection = update.projection; });

    const usage = data.usage || {};
    const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
    const cached = Number(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0);
    const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
    const reported = Number(data?.cost?.usd);
    const cost = Number.isFinite(reported) ? reported : priceCost(input, cached, output);
    const totalWeight = inputWeights.reduce((sum, value) => sum + value, 0) || 1;
    batch.forEach((entry, index) => {
      const share = inputWeights[index] / totalWeight;
      entry.projectionUsage = {
        inputTokens: Math.round(input * share),
        cachedInputTokens: Math.round(cached * share),
        outputTokens: Math.round(output * share),
        actualUSD: cost * share,
        kind: 'actual'
      };
    });

    const saved = await saveEntries(batch);
    return { input, cached, output, cost, saved };
  }

  function chunks(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
  }

  async function analyze() {
    await detectModel();
    const todo = entries.filter(entry => projectionNeeds(entry));
    if (!todo.length) {
      setStatus('<strong>PROJECTION READY</strong> — no eligible title or deck is stale or missing. No API call was made.');
      renderLedger();
      return { ok: true, processed: 0 };
    }

    const button = document.getElementById('analyzeProjection');
    if (button) button.disabled = true;
    const batches = chunks(todo, CLIENT_BATCH_SIZE);
    const totals = { processed: 0, saved: 0, input: 0, cached: 0, output: 0, cost: 0 };

    try {
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        setStatus(
          `<strong>PROJECTING / OPENROUTER</strong> — batch ${index + 1}/${batches.length}; ` +
          `${totals.processed}/${todo.length} complete and ${totals.saved} stored locally.`
        );
        const result = await requestBatch(batch);
        totals.processed += batch.length;
        totals.saved += result.saved;
        totals.input += result.input;
        totals.cached += result.cached;
        totals.output += result.output;
        totals.cost += result.cost;
        invalidateAndGenerate(`batch-${index + 1}`);
      }

      setStatus(
        `<strong>PROJECTION READY / OPENROUTER</strong> — ${totals.processed}/${todo.length} projected · ` +
        `${totals.input.toLocaleString()} input · ${totals.output.toLocaleString()} output · ` +
        `billed $${totals.cost.toFixed(6)} · ${totals.saved} saved locally.`
      );
      return { ok: true, ...totals };
    } catch (error) {
      const remaining = entries.filter(entry => projectionNeeds(entry)).length;
      setStatus(
        `<strong>PROJECTION PARTIAL</strong> — ${totals.processed}/${todo.length} complete and ${totals.saved} stored; ` +
        `${remaining} remain. ${escapeHTML(error.message || error)} Click Generate stale / missing to resume.`
      );
      invalidateAndGenerate('partial');
      return { ok: false, ...totals, error: String(error.message || error) };
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function clearGenerated() {
    const db = await openDatabase();
    let deleted = 0;
    if (db) {
      for (let index = 0; index < entries.length; index += 1) {
        const records = await scopeRecords(entries[index], index);
        if (!records.length) continue;
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          records.forEach(record => store.delete(record.key));
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Could not clear projection records.'));
        });
        deleted += records.length;
      }
    }
    prepareEntries(entries);
    invalidateAndGenerate('clear');
    setStatus(`<strong>PROJECTION CLEARED</strong> — ${deleted} cached AI projections removed. Reliable original titles remain locally extracted.`);
  }

  function installApplyHook() {
    if (typeof applyText !== 'function' || applyText.__typeblockProjectionWrapped) return;
    const baseApply = applyText;
    applyText = function projectionApplyText(preserve = true) {
      const result = baseApply(preserve);
      attachRawBodies(entries, document.getElementById('src')?.value || '');
      prepareEntries(entries);
      window.TypeBlockTextMetrics?.invalidate?.('projection-content');
      candidates = [];
      selected = 0;
      generate();
      restore(entries).catch(error => {
        console.warn('[TypeBlock projection restore]', error);
        setStatus(`<strong>PROJECTION RESTORE FAILED</strong> — ${escapeHTML(error.message || error)}`);
      });
      return result;
    };
    applyText.__typeblockProjectionWrapped = true;
  }

  function installButtons() {
    const analyzeButton = document.getElementById('analyzeProjection');
    if (analyzeButton) analyzeButton.onclick = analyze;
    const clearButton = document.getElementById('clearProjection');
    if (clearButton) clearButton.onclick = clearGenerated;
  }

  window.EditorialProjection = {
    schemaVersion: SCHEMA_VERSION,
    planFor,
    prepareEntries,
    restore,
    analyze,
    clearGenerated,
    displayBody,
    projectionNeeds,
    renderLedger,
    getModel: () => currentModel,
    getWarning: () => storageWarning
  };

  installApplyHook();
  installButtons();
  renderLedger();
})();
