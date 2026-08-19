(() => {
  'use strict';

  const DB_NAME = 'typeblock-editorial-ai-lab';
  const DB_VERSION = 1;
  const ANALYSIS_STORE = 'editorialAnalyses';
  const DATASET_STORE = 'datasets';
  const CURRENT_DATASET_ID = 'current';
  const ANALYSIS_SCHEMA_VERSION = 1;
  const DEFAULT_MODEL = 'openai/gpt-5-mini';

  let currentModel = DEFAULT_MODEL;
  let dbPromise = null;
  let storageWarning = null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ANALYSIS_STORE)) {
          const store = db.createObjectStore(ANALYSIS_STORE, { keyPath: 'key' });
          store.createIndex('scopeKey', 'scopeKey', { unique: false });
        }
        if (!db.objectStoreNames.contains(DATASET_STORE)) {
          db.createObjectStore(DATASET_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another open tab.'));
    }).catch(error => {
      storageWarning = error;
      console.warn('[TypeBlock persistence]', error);
      return null;
    });
    return dbPromise;
  }

  async function runTransaction(storeName, mode, operation) {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = operation(store, tx);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction was aborted.'));
    }).catch(error => {
      storageWarning = error;
      console.warn('[TypeBlock persistence]', error);
      return null;
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  function externalIdFor(entry, index = 0) {
    return String(entry?.externalId || `manual:${index + 1}`);
  }

  function scopeKey(externalEntryID, model = currentModel, schemaVersion = ANALYSIS_SCHEMA_VERSION) {
    return JSON.stringify([String(externalEntryID), String(model), Number(schemaVersion)]);
  }

  function analysisKey(externalEntryID, sourceDigest, model = currentModel, schemaVersion = ANALYSIS_SCHEMA_VERSION) {
    return JSON.stringify([
      String(externalEntryID),
      String(sourceDigest),
      String(model),
      Number(schemaVersion)
    ]);
  }

  async function detectBackendModel() {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) return currentModel;
      const data = await response.json();
      if (typeof data?.model === 'string' && data.model.trim()) currentModel = data.model.trim();
    } catch {
      // The static demo has no health endpoint. Keep the default model key.
    }
    return currentModel;
  }

  function setModel(model) {
    if (typeof model === 'string' && model.trim()) currentModel = model.trim();
    return currentModel;
  }

  function getModel() {
    return currentModel;
  }

  async function saveCurrentDataset(dataset) {
    const record = {
      id: CURRENT_DATASET_ID,
      fileName: String(dataset?.fileName || 'Local dataset'),
      datasetText: String(dataset?.datasetText || ''),
      importedAt: dataset?.importedAt || new Date().toISOString(),
      selectedCount: Number(dataset?.selectedCount || 0),
      format: String(dataset?.format || 'local'),
      meta: clone(dataset?.meta || null)
    };
    if (!record.datasetText.trim()) return false;
    const result = await runTransaction(DATASET_STORE, 'readwrite', store => {
      store.put(record);
      return true;
    });
    return Boolean(result);
  }

  async function loadCurrentDataset() {
    const db = await openDatabase();
    if (!db) return null;
    try {
      const tx = db.transaction(DATASET_STORE, 'readonly');
      return await requestResult(tx.objectStore(DATASET_STORE).get(CURRENT_DATASET_ID));
    } catch (error) {
      storageWarning = error;
      console.warn('[TypeBlock persistence]', error);
      return null;
    }
  }

  async function clearCurrentDataset() {
    const result = await runTransaction(DATASET_STORE, 'readwrite', store => {
      store.delete(CURRENT_DATASET_ID);
      return true;
    });
    return Boolean(result);
  }

  function normalizedEditorial(entry) {
    const editorial = entry?.editorial;
    if (!editorial || editorial.status !== 'ready') return null;
    return {
      status: 'ready',
      function: String(editorial.function || 'neutral'),
      continuity: Number(editorial.continuity || 0),
      dependency: String(editorial.dependency || 'standalone'),
      topicShift: Number(editorial.topicShift || 0),
      sourceDigest: String(entry.digest || editorial.sourceDigest || ''),
      model: String(editorial.model || currentModel),
      schemaVersion: Number(editorial.schemaVersion || ANALYSIS_SCHEMA_VERSION),
      analyzedAt: editorial.analyzedAt || new Date().toISOString()
    };
  }

  async function saveAnalyses(entryList) {
    const modelKey = currentModel;
    const records = [];
    entryList.forEach((entry, index) => {
      const editorial = normalizedEditorial(entry);
      if (!editorial || !entry?.digest) return;
      const externalEntryID = externalIdFor(entry, index);
      records.push({
        key: analysisKey(externalEntryID, entry.digest, modelKey, ANALYSIS_SCHEMA_VERSION),
        scopeKey: scopeKey(externalEntryID, modelKey, ANALYSIS_SCHEMA_VERSION),
        externalEntryID,
        sourceDigest: String(entry.digest),
        modelKey,
        actualModel: editorial.model,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        editorial,
        usage: clone(entry.usage || null),
        savedAt: new Date().toISOString()
      });
    });
    if (!records.length) return 0;
    const result = await runTransaction(ANALYSIS_STORE, 'readwrite', store => {
      records.forEach(record => store.put(record));
      return records.length;
    });
    return Number(result || 0);
  }

  async function getExactRecord(entry, index) {
    const db = await openDatabase();
    if (!db) return null;
    const externalEntryID = externalIdFor(entry, index);
    const key = analysisKey(externalEntryID, entry.digest, currentModel, ANALYSIS_SCHEMA_VERSION);
    try {
      const tx = db.transaction(ANALYSIS_STORE, 'readonly');
      return await requestResult(tx.objectStore(ANALYSIS_STORE).get(key));
    } catch (error) {
      storageWarning = error;
      console.warn('[TypeBlock persistence]', error);
      return null;
    }
  }

  async function getScopeRecords(entry, index) {
    const db = await openDatabase();
    if (!db) return [];
    const externalEntryID = externalIdFor(entry, index);
    const key = scopeKey(externalEntryID, currentModel, ANALYSIS_SCHEMA_VERSION);
    try {
      const tx = db.transaction(ANALYSIS_STORE, 'readonly');
      const indexStore = tx.objectStore(ANALYSIS_STORE).index('scopeKey');
      return (await requestResult(indexStore.getAll(IDBKeyRange.only(key)))) || [];
    } catch (error) {
      storageWarning = error;
      console.warn('[TypeBlock persistence]', error);
      return [];
    }
  }

  async function restoreAnalyses(entryList) {
    await detectBackendModel();
    let restored = 0;
    let stale = 0;
    let missing = 0;

    for (let index = 0; index < entryList.length; index += 1) {
      const entry = entryList[index];
      const exact = await getExactRecord(entry, index);
      if (exact?.editorial) {
        entry.externalId = exact.externalEntryID || externalIdFor(entry, index);
        entry.editorial = {
          ...clone(exact.editorial),
          status: 'ready',
          sourceDigest: String(entry.digest),
          restored: true
        };
        entry.usage = clone(exact.usage || null);
        restored += 1;
        continue;
      }

      const previous = (await getScopeRecords(entry, index))
        .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))[0];
      if (previous?.editorial) {
        entry.editorial = {
          ...clone(previous.editorial),
          status: 'stale',
          sourceDigest: String(entry.digest),
          previousSourceDigest: String(previous.sourceDigest || ''),
          restored: true
        };
        entry.usage = null;
        stale += 1;
      } else {
        entry.editorial = null;
        entry.usage = null;
        missing += 1;
      }
    }

    return { restored, stale, missing, model: currentModel, warning: storageWarning };
  }

  async function deleteAnalyses(entryList) {
    const db = await openDatabase();
    if (!db) return 0;
    let deleted = 0;
    try {
      for (let index = 0; index < entryList.length; index += 1) {
        const entry = entryList[index];
        const records = await getScopeRecords(entry, index);
        if (!records.length) continue;
        await runTransaction(ANALYSIS_STORE, 'readwrite', store => {
          records.forEach(record => store.delete(record.key));
          return records.length;
        });
        deleted += records.length;
      }
      return deleted;
    } catch (error) {
      storageWarning = error;
      console.warn('[TypeBlock persistence]', error);
      return deleted;
    }
  }

  function decodeEntryId(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function installParseAdapter() {
    if (typeof parse !== 'function' || parse.__typeblockIdentityAdapter) return;
    const baseParse = parse;
    const adapted = function adaptedParse(text) {
      const rawChunks = String(text || '').split(/\n\s*---\s*\n/);
      const sanitizedChunks = [];
      const externalIds = [];

      rawChunks.forEach((chunk, chunkIndex) => {
        let externalId = null;
        const kept = [];
        String(chunk || '').split(/\n/).forEach(line => {
          const match = line.match(/^@entry-id\s+(.+)$/i);
          if (match) externalId = decodeEntryId(match[1]);
          else kept.push(line);
        });
        const sanitized = kept.join('\n').trim();
        if (!sanitized) return;
        sanitizedChunks.push(sanitized);
        externalIds.push(externalId || `manual:${chunkIndex + 1}`);
      });

      const parsed = baseParse(sanitizedChunks.join('\n---\n'));
      parsed.forEach((entry, index) => {
        entry.externalId = externalIds[index] || `manual:${index + 1}`;
      });
      return parsed;
    };
    adapted.__typeblockIdentityAdapter = true;
    parse = adapted;
  }

  function appendStatus(message) {
    const node = document.getElementById('analysisStatus');
    if (!node || !message) return;
    node.innerHTML = `${node.innerHTML} ${message}`;
  }

  function installUIHooks() {
    installParseAdapter();

    if (typeof analyze === 'function' && !analyze.__typeblockPersistenceWrapped) {
      const baseAnalyze = analyze;
      const wrappedAnalyze = async function persistedAnalyze() {
        await detectBackendModel();
        await baseAnalyze();
        const ready = entries.filter(entry => entry.editorial?.status === 'ready');
        const saved = await saveAnalyses(ready);
        if (saved) appendStatus(`<strong>LOCAL SAVE</strong> — ${saved} analyses stored in this browser.`);
      };
      wrappedAnalyze.__typeblockPersistenceWrapped = true;
      analyze = wrappedAnalyze;
      const analyzeButton = document.getElementById('analyze');
      if (analyzeButton) analyzeButton.onclick = analyze;
    }

    const clearButton = document.getElementById('clearAnalysis');
    if (clearButton && !clearButton.dataset.persistenceHook) {
      clearButton.dataset.persistenceHook = 'true';
      clearButton.onclick = async () => {
        const deleted = await deleteAnalyses(entries);
        entries.forEach(entry => {
          entry.editorial = null;
          entry.usage = null;
        });
        lastUsage = null;
        setStatus(`<strong>CLEARED</strong> — ${deleted} saved analyses removed for the current Entries.`);
        generate();
      };
    }

    const applyButton = document.getElementById('apply');
    if (applyButton && !applyButton.dataset.persistenceHook) {
      const baseApply = applyButton.onclick;
      applyButton.dataset.persistenceHook = 'true';
      applyButton.onclick = async () => {
        if (typeof baseApply === 'function') baseApply();
        const existing = await loadCurrentDataset();
        await saveCurrentDataset({
          fileName: existing?.fileName || 'Edited local dataset',
          datasetText: document.getElementById('src')?.value || '',
          importedAt: existing?.importedAt || new Date().toISOString(),
          selectedCount: entries.length,
          format: existing?.format || 'edited',
          meta: existing?.meta || null
        });
        const result = await restoreAnalyses(entries);
        generate();
        setStatus(
          `<strong>LOCAL UPDATE</strong> — ${result.restored} restored, ${result.stale} stale, ${result.missing} missing.`
        );
      };
    }

    const resetButton = document.getElementById('reset');
    if (resetButton && !resetButton.dataset.persistenceHook) {
      const baseReset = resetButton.onclick;
      resetButton.dataset.persistenceHook = 'true';
      resetButton.onclick = async () => {
        await clearCurrentDataset();
        if (typeof baseReset === 'function') baseReset();
        installParseAdapter();
        applyText(false);
        setMode('live');
        setStatus('<strong>LIVE</strong> — sample restored. No imported dataset is pinned locally.');
      };
    }
  }

  window.EditorialPersistence = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    detectBackendModel,
    setModel,
    getModel,
    saveCurrentDataset,
    loadCurrentDataset,
    clearCurrentDataset,
    saveAnalyses,
    restoreAnalyses,
    deleteAnalyses,
    installParseAdapter,
    installUIHooks,
    getWarning: () => storageWarning
  };

  installUIHooks();
})();
