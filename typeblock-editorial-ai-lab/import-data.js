(() => {
  'use strict';

  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const LATEST_COUNT = 10;
  const fileInput = document.getElementById('dataFile');
  const status = document.getElementById('dataStatus');

  function setDataStatus(html) {
    status.innerHTML = html;
  }

  function firstValue(record, keys) {
    for (const key of keys) {
      const value = record?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function textFrom(record) {
    const value = firstValue(record, ['plainText', 'content', 'body', 'text', 'note']);
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(String).join('\n').trim();
    return '';
  }

  function timestampFrom(record) {
    const raw = firstValue(record, [
      'createdAt', 'created_at', 'creationDate', 'created',
      'timestamp', 'date', 'updatedAt', 'updated_at'
    ]);
    if (raw === null) return NaN;
    if (typeof raw === 'number') {
      const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
      return Number.isFinite(ms) ? ms : NaN;
    }
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function provenanceFrom(record) {
    if (record?.isAuthored === true || record?.isMine === true) return 'authored';
    const raw = String(firstValue(record, ['provenance', 'source', 'sourceType', 'kind', 'origin']) || '').toLowerCase();
    if (/(authored|self|own|mine|user|journal|note|thought)/.test(raw)) return 'authored';
    return 'collected';
  }

  function externalIdFrom(record, index) {
    return String(firstValue(record, ['id', 'entryID', 'entryId', 'uuid', '_id']) || `row-${index + 1}`);
  }

  function escapeDatasetBody(text) {
    return text
      .replace(/^---\s*$/gm, '———')
      .replace(/^@(source|cue)\b/gim, '＠$1');
  }

  function normalizeRecords(json) {
    const source = Array.isArray(json)
      ? json
      : Array.isArray(json?.entries)
        ? json.entries
        : Array.isArray(json?.items)
          ? json.items
          : null;
    if (!source) throw new Error('JSON must be an array, {"entries": [...]}, or {"items": [...]}.');

    const valid = [];
    let emptyText = 0;
    let missingDate = 0;

    source.forEach((record, index) => {
      if (!record || typeof record !== 'object') return;
      const text = textFrom(record);
      if (!text) {
        emptyText += 1;
        return;
      }
      const timestamp = timestampFrom(record);
      if (!Number.isFinite(timestamp)) {
        missingDate += 1;
        return;
      }
      valid.push({
        externalId: externalIdFrom(record, index),
        text,
        timestamp,
        provenance: provenanceFrom(record)
      });
    });

    if (!valid.length) {
      throw new Error('No valid records found. Every selected record needs text and a parseable createdAt/date.');
    }

    const latest = valid
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, LATEST_COUNT)
      .sort((a, b) => a.timestamp - b.timestamp);

    return { total: source.length, valid: valid.length, emptyText, missingDate, latest };
  }

  function toDatasetText(records) {
    return records.map(record => (
      `@source ${record.provenance}\n${escapeDatasetBody(record.text)}`
    )).join('\n---\n');
  }

  function dateLabel(ms) {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(ms));
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 50 MB.');
    const text = await file.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }

    const result = normalizeRecords(json);
    document.getElementById('src').value = toDatasetText(result.latest);

    // Do not carry metadata or cost from the previous dataset into the imported one.
    entries = [];
    candidates = [];
    previous = new Map();
    focus = null;
    lastUsage = null;
    applyText(false);

    const from = result.latest[0].timestamp;
    const to = result.latest[result.latest.length - 1].timestamp;
    setDataStatus(
      `<strong>${file.name}</strong> — ${result.latest.length} latest Entries selected from ${result.valid} valid / ${result.total} total. ` +
      `Layout order: ${dateLabel(from)} → ${dateLabel(to)}. ` +
      `${result.missingDate} skipped without dates; ${result.emptyText} skipped without text. ` +
      `The file stays in this browser; only these ${result.latest.length} Entries are sent when you click LIVE Analyze.`
    );

    setMode('live');
    setStatus(`<strong>LIVE</strong> — ${result.latest.length} imported Entries are ready. Click Analyze stale / missing to run OpenRouter.`);
  }

  fileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDataStatus(`<strong>READING</strong> — ${file.name}`);
    try {
      await importFile(file);
    } catch (error) {
      setDataStatus(`<strong>IMPORT FAILED</strong> — ${String(error.message || error)}`);
    } finally {
      fileInput.value = '';
    }
  });

  // MOCK is intentionally removed from the public experiment.
  setMode('live');
})();
