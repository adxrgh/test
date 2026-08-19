(() => {
  'use strict';

  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const LATEST_COUNT = 10;
  const fileInput = document.getElementById('dataFile');
  const status = document.getElementById('dataStatus');

  function setDataStatus(html) {
    status.innerHTML = html;
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function firstValue(record, keys) {
    for (const key of keys) {
      const value = record?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function timestampFromValue(raw) {
    if (raw === null || raw === undefined || raw === '') return NaN;
    if (typeof raw === 'number') {
      const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
      return Number.isFinite(ms) ? ms : NaN;
    }
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function externalIdFrom(record, index) {
    return String(firstValue(record, ['id', 'entryID', 'entryId', 'uuid', '_id']) || `row-${index + 1}`);
  }

  function escapeDatasetBody(text) {
    return text
      .replace(/^---\s*$/gm, '———')
      .replace(/^@(source|cue)\b/gim, '＠$1');
  }

  function stableLatest(records) {
    return records
      .sort((a, b) => (b.timestamp - a.timestamp) || (b.sourceIndex - a.sourceIndex))
      .slice(0, LATEST_COUNT)
      .sort((a, b) => (a.timestamp - b.timestamp) || (a.sourceIndex - b.sourceIndex));
  }

  function normalizeFudebamExport(json) {
    const source = json.entries;
    const valid = [];
    const stats = {
      format: 'fudebam',
      total: source.length,
      invalidRecord: 0,
      inactive: 0,
      hidden: 0,
      merged: 0,
      hiddenAndMerged: 0,
      emptyText: 0,
      missingDate: 0
    };

    source.forEach((record, sourceIndex) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        stats.invalidRecord += 1;
        return;
      }

      // Fudebam tombstones and merged source records are not active Layout Entries.
      const isHidden = Boolean(record.hiddenAt);
      const isMerged = Boolean(record.mergedIntoEntryID);
      if (isHidden) stats.hidden += 1;
      if (isMerged) stats.merged += 1;
      if (isHidden && isMerged) stats.hiddenAndMerged += 1;
      if (isHidden || isMerged) {
        stats.inactive += 1;
        return;
      }

      const text = typeof record.content === 'string' ? record.content.trim() : '';
      if (!text) {
        stats.emptyText += 1;
        return;
      }

      const timestamp = timestampFromValue(record.createdAt);
      if (!Number.isFinite(timestamp)) {
        stats.missingDate += 1;
        return;
      }

      const captureOrigin = String(record.captureOrigin || 'unknown').toLowerCase();
      valid.push({
        externalId: externalIdFrom(record, sourceIndex),
        text,
        timestamp,
        sourceIndex,
        captureOrigin,
        provenance: captureOrigin === 'authored' ? 'authored' : 'collected'
      });
    });

    if (!valid.length) {
      throw new Error(
        'No active Fudebam Entries found. The importer requires entries[].content and entries[].createdAt, and excludes hiddenAt / mergedIntoEntryID records.'
      );
    }

    const latest = stableLatest(valid);
    const latestIds = new Set(latest.map(record => record.externalId));
    const annotations = Array.isArray(json.annotations) ? json.annotations : [];
    const selectedAnnotations = annotations.filter(annotation =>
      annotation &&
      latestIds.has(String(annotation.entryID || '')) &&
      (annotation.status === undefined || annotation.status === 'active')
    );

    const annotationKinds = selectedAnnotations.reduce((result, annotation) => {
      const kind = String(annotation.kind || 'unknown');
      result[kind] = (result[kind] || 0) + 1;
      return result;
    }, {});

    const selectedAuthored = latest.filter(record => record.provenance === 'authored').length;

    return {
      ...stats,
      valid: valid.length,
      latest,
      selectedAuthored,
      selectedCollected: latest.length - selectedAuthored,
      sidecars: {
        annotations: annotations.length,
        revisions: Array.isArray(json.revisions) ? json.revisions.length : 0,
        aiReviewSessions: Array.isArray(json.aiReviewSessions) ? json.aiReviewSessions.length : 0,
        selectedAnnotations: selectedAnnotations.length,
        annotationKinds
      }
    };
  }

  function genericTextFrom(record) {
    const value = firstValue(record, ['plainText', 'content', 'body', 'text', 'note']);
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(String).join('\n').trim();
    return '';
  }

  function genericProvenanceFrom(record) {
    if (record?.isAuthored === true || record?.isMine === true) return 'authored';
    const raw = String(firstValue(record, ['provenance', 'source', 'sourceType', 'kind', 'origin']) || '').toLowerCase();
    if (/(authored|self|own|mine|user|journal|note|thought)/.test(raw)) return 'authored';
    return 'collected';
  }

  function normalizePlainArray(source) {
    const valid = [];
    const stats = {
      format: 'plain-array',
      total: source.length,
      invalidRecord: 0,
      inactive: 0,
      hidden: 0,
      merged: 0,
      hiddenAndMerged: 0,
      emptyText: 0,
      missingDate: 0
    };

    source.forEach((record, sourceIndex) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        stats.invalidRecord += 1;
        return;
      }
      const text = genericTextFrom(record);
      if (!text) {
        stats.emptyText += 1;
        return;
      }
      const timestamp = timestampFromValue(firstValue(record, [
        'createdAt', 'created_at', 'creationDate', 'created',
        'timestamp', 'date', 'updatedAt', 'updated_at'
      ]));
      if (!Number.isFinite(timestamp)) {
        stats.missingDate += 1;
        return;
      }
      valid.push({
        externalId: externalIdFrom(record, sourceIndex),
        text,
        timestamp,
        sourceIndex,
        captureOrigin: null,
        provenance: genericProvenanceFrom(record)
      });
    });

    if (!valid.length) {
      throw new Error('No valid records found. Every array record needs text and a parseable createdAt/date.');
    }

    const latest = stableLatest(valid);
    const selectedAuthored = latest.filter(record => record.provenance === 'authored').length;
    return {
      ...stats,
      valid: valid.length,
      latest,
      selectedAuthored,
      selectedCollected: latest.length - selectedAuthored,
      sidecars: null
    };
  }

  function normalizeRecords(json) {
    if (json && !Array.isArray(json) && Array.isArray(json.entries)) {
      return normalizeFudebamExport(json);
    }
    if (Array.isArray(json)) {
      return normalizePlainArray(json);
    }
    throw new Error(
      'Expected a Fudebam export with a top-level "entries" array, or a plain JSON array. Other top-level collections are not treated as Entries.'
    );
  }

  function toDatasetText(records) {
    return records.map(record => (
      `@source ${record.provenance}\n${escapeDatasetBody(record.text)}`
    )).join('\n---\n');
  }

  function dateLabel(ms) {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms));
  }

  function sidecarSummary(result) {
    if (!result.sidecars) return '';
    const selected = result.sidecars.selectedAnnotations;
    const kinds = Object.entries(result.sidecars.annotationKinds)
      .map(([kind, count]) => `${count} ${escapeHTML(kind)}`)
      .join(', ');
    const selectedLabel = selected
      ? `${selected} active annotation${selected === 1 ? '' : 's'} linked to the selected Entries${kinds ? ` (${kinds})` : ''}`
      : 'no active annotations linked to the selected Entries';

    return (
      ` Sidecars kept separate: ${result.sidecars.annotations} annotations, ` +
      `${result.sidecars.revisions} revisions, ${result.sidecars.aiReviewSessions} AI review sessions; ${selectedLabel}.`
    );
  }

  function exclusionSummary(result) {
    const parts = [];
    if (result.inactive) {
      let inactive = `${result.inactive} inactive`;
      const flags = [];
      if (result.hidden) flags.push(`${result.hidden} hidden`);
      if (result.merged) flags.push(`${result.merged} marked merged`);
      if (result.hiddenAndMerged) flags.push(`${result.hiddenAndMerged} both`);
      if (flags.length) inactive += ` (${flags.join(', ')})`;
      parts.push(inactive);
    }
    if (result.emptyText) parts.push(`${result.emptyText} without text`);
    if (result.missingDate) parts.push(`${result.missingDate} without valid createdAt`);
    if (result.invalidRecord) parts.push(`${result.invalidRecord} invalid`);
    return parts.length ? ` Excluded: ${parts.join('; ')}.` : '';
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

    // Never carry metadata, billing, or placement state from the previous dataset.
    entries = [];
    candidates = [];
    previous = new Map();
    focus = null;
    lastUsage = null;
    applyText(false);

    const from = result.latest[0].timestamp;
    const to = result.latest[result.latest.length - 1].timestamp;
    const formatLabel = result.format === 'fudebam' ? 'Fudebam export' : 'plain JSON array';

    setDataStatus(
      `<strong>${escapeHTML(file.name)}</strong> — ${formatLabel}: ` +
      `${result.latest.length} latest active Entries selected from ${result.valid} active / ${result.total} total. ` +
      `Layout order: ${dateLabel(from)} → ${dateLabel(to)}. ` +
      `Selected source identity: ${result.selectedAuthored} authored / ${result.selectedCollected} collected.` +
      exclusionSummary(result) +
      sidecarSummary(result) +
      ` The file remains local; only these ${result.latest.length} Entry texts are sent after you click LIVE Analyze.`
    );

    setMode('live');
    setStatus(
      `<strong>LIVE</strong> — ${result.latest.length} imported Entries are ready. ` +
      `Click Analyze stale / missing to run OpenRouter.`
    );
  }

  fileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDataStatus(`<strong>READING</strong> — ${escapeHTML(file.name)}`);
    try {
      await importFile(file);
    } catch (error) {
      setDataStatus(`<strong>IMPORT FAILED</strong> — ${escapeHTML(String(error.message || error))}`);
    } finally {
      fileInput.value = '';
    }
  });

  setMode('live');
})();
