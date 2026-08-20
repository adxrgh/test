(() => {
  'use strict';

  const I = window.TypeBlockEditorialIndex;
  if (!I) return;
  const K = I.constants;

  function makePlacement(entry, entryIndex, spec, band, forcedHeaderRows = null) {
    const measuredHeader = I.headerMetrics(entry, spec.span, spec.role);
    const headerRows = forcedHeaderRows == null ? measuredHeader.rows : forcedHeaderRows;
    const bodyRows = spec.bodyRows ?? I.bodyRowsFor(entry, spec.span, spec.role);
    const rows = K.cellChromeRows + headerRows + bodyRows;
    const placement = {
      id: entry.id,
      entryIndex,
      x: spec.x,
      row: spec.row,
      span: spec.span,
      rows,
      bodyRows,
      headerRows,
      measuredHeaderRows: measuredHeader.rows,
      phraseId: band.id,
      bandId: band.id,
      bandType: band.type,
      role: spec.role,
      template: band.template,
      indexVersion: I.version
    };
    placement.shape = I.shapeFor(entry, placement.span, placement.rows, bodyRows, spec.role);
    placement.shape.stability = typeof stability === 'function' ? stability(entry, placement) : 0;
    return placement;
  }

  function alignedHeaderRows(group, spans, roles) {
    return Math.max(0, ...group.map((entry, index) => I.headerMetrics(entry, spans[index], roles[index]).rows));
  }

  function placeMatrixBand(band, rowStart, variant) {
    const group = entries.slice(band.start, band.end);
    const count = group.length;
    const placements = [];
    const contentRow = rowStart + K.bandHeaderRows;
    if (count === 1) return placeFeatureBand(band, rowStart);

    if (count === 2) {
      band.template = 'matrix-3-3';
      const headerRows = alignedHeaderRows(group, [3, 3], ['matrix', 'matrix']);
      const bodyRows = group.map(entry => I.bodyRowsFor(entry, 3, 'matrix'));
      if (I.ratioFor(group) <= 1.14) bodyRows.fill(Math.max(...bodyRows));
      group.forEach((entry, localIndex) => {
        placements.push(makePlacement(entry, band.start + localIndex, {
          x: localIndex * 3,
          row: contentRow,
          span: 3,
          role: 'matrix',
          bodyRows: bodyRows[localIndex]
        }, band, headerRows));
      });
    } else if (count === 3) {
      band.template = 'matrix-pair-plus-wide';
      const top = group.slice(0, 2);
      const topHeader = alignedHeaderRows(top, [3, 3], ['matrix', 'matrix']);
      top.forEach((entry, localIndex) => {
        placements.push(makePlacement(entry, band.start + localIndex, {
          x: localIndex * 3,
          row: contentRow,
          span: 3,
          role: 'matrix'
        }, band, topHeader));
      });
      const topBottom = Math.max(...placements.map(placement => placement.row + placement.rows));
      placements.push(makePlacement(group[2], band.start + 2, {
        x: 0,
        row: topBottom + K.innerGapRows,
        span: 6,
        role: 'lead'
      }, band));
    } else {
      band.template = 'matrix-2x2';
      const headerRows = alignedHeaderRows(group, [3, 3, 3, 3], ['matrix', 'matrix', 'matrix', 'matrix']);
      const topPlacements = [];
      for (let localIndex = 0; localIndex < 2; localIndex += 1) {
        const placement = makePlacement(group[localIndex], band.start + localIndex, {
          x: localIndex * 3,
          row: contentRow,
          span: 3,
          role: 'matrix'
        }, band, headerRows);
        placements.push(placement);
        topPlacements.push(placement);
      }
      const secondRow = Math.max(...topPlacements.map(placement => placement.row + placement.rows)) + K.innerGapRows;
      for (let localIndex = 2; localIndex < 4; localIndex += 1) {
        placements.push(makePlacement(group[localIndex], band.start + localIndex, {
          x: (localIndex - 2) * 3,
          row: secondRow,
          span: 3,
          role: 'matrix'
        }, band, headerRows));
      }
    }

    const bottom = Math.max(...placements.map(placement => placement.row + placement.rows));
    Object.assign(band, {
      row: rowStart,
      contentRow,
      height: bottom - rowStart,
      axis: 'grid',
      placements
    });
    return { placements, bottom };
  }

  function placeLeadBand(band, rowStart, variant) {
    const group = entries.slice(band.start, band.end);
    if (group.length < 3) {
      band.type = 'matrix';
      return placeMatrixBand(band, rowStart, variant);
    }

    const contentRow = rowStart + K.bandHeaderRows;
    const mirror = Boolean(variant.mirrorLead && !I.isMobile());
    band.template = mirror ? 'lead-4-2-mirror' : 'lead-4-2';
    const mainX = mirror ? 2 : 0;
    const supportX = mirror ? 0 : 4;
    const supportHeader = alignedHeaderRows(group.slice(1), [2, 2], ['support', 'support']);
    const placements = [];

    const main = makePlacement(group[0], band.start, {
      x: mainX,
      row: contentRow,
      span: 4,
      role: 'lead'
    }, band);
    placements.push(main);

    const supportA = makePlacement(group[1], band.start + 1, {
      x: supportX,
      row: contentRow,
      span: 2,
      role: 'support'
    }, band, supportHeader);
    placements.push(supportA);

    placements.push(makePlacement(group[2], band.start + 2, {
      x: supportX,
      row: supportA.row + supportA.rows + K.innerGapRows,
      span: 2,
      role: 'support'
    }, band, supportHeader));

    const bottom = Math.max(...placements.map(placement => placement.row + placement.rows));
    Object.assign(band, {
      row: rowStart,
      contentRow,
      height: bottom - rowStart,
      axis: mirror ? 'right' : 'left',
      placements
    });
    return { placements, bottom };
  }

  function placeFeatureBand(band, rowStart) {
    const entry = entries[band.start];
    const contentRow = rowStart + K.bandHeaderRows;
    band.template = 'feature-6';
    const placement = makePlacement(entry, band.start, {
      x: 0,
      row: contentRow,
      span: 6,
      role: 'feature'
    }, band);
    const bottom = placement.row + placement.rows;
    Object.assign(band, {
      row: rowStart,
      contentRow,
      height: bottom - rowStart,
      axis: 'full',
      placements: [placement]
    });
    return { placements: [placement], bottom };
  }

  function boundaryCost(band, signals) {
    let cost = I.number(band.fitCost);
    for (let index = band.start + 1; index < band.end; index += 1) {
      const boundary = signals[index] || {};
      cost += I.number(boundary.breakStrength, 0.5) * 18;
      if (boundary.hardBreak) cost += 50;
    }
    if (band.start > 0) {
      const boundary = signals[band.start] || {};
      cost += Math.max(0, 0.28 - I.number(boundary.breakStrength, 0.5)) * 16;
    }
    return cost;
  }

  function indexMetrics(ps, bands, rawCost) {
    let area = 0;
    let shape = 0;
    let move = 0;
    ps.forEach((placement, index) => {
      const entry = entries[index];
      const target = I.layoutWeight(entry);
      const actual = placement.span * placement.bodyRows;
      area += Math.abs(actual - target) / Math.max(1, target) * 100;
      shape += I.number(placement.shape?.intrinsic);
      move += I.number(placement.shape?.stability);
    });

    const editorial = bands.length
      ? bands.reduce((sum, band) => sum + I.number(band.fitCost), 0) / bands.length + rawCost / Math.max(1, bands.length) * 0.12
      : 0;
    const semantic = typeof semanticCost === 'function' ? semanticCost(ps) : 0;
    const diag = typeof rolling === 'function'
      ? rolling(ps)
      : { cost: 0, whiteField: 0, corridor: 0, balance: 0, wins: [], worst: null, p90: 0, mean: 0, max: 0 };
    const m = {
      shape: shape / Math.max(1, ps.length),
      editorial: Math.max(0, Math.min(100, editorial)),
      semantic,
      area: area / Math.max(1, ps.length),
      whiteField: I.number(diag.whiteField),
      rolling: Math.max(0, Math.min(100, I.number(diag.cost) + 0.16 * I.number(diag.corridor) + 0.12 * I.number(diag.balance))),
      move: move / Math.max(1, ps.length)
    };
    const weighted = typeof score === 'function'
      ? score(m)
      : Object.values(m).reduce((sum, value) => sum + value, 0) / Object.keys(m).length;
    return { m, diag, score: weighted + rawCost / Math.max(1, entries.length) * 0.025 };
  }

  function buildCandidate(variant) {
    const formed = I.formBands(variant);
    const bands = formed.bands.map(band => ({ ...band }));
    const placements = [];
    let row = 0;
    let rawCost = 0;

    bands.forEach((band, bandIndex) => {
      band.id = bandIndex;
      const placed = band.type === 'matrix'
        ? placeMatrixBand(band, row, variant)
        : band.type === 'lead'
          ? placeLeadBand(band, row, variant)
          : placeFeatureBand(band, row);
      placements.push(...placed.placements);
      rawCost += boundaryCost(band, formed.signals);
      row = placed.bottom + K.bandGapRows;
    });

    const ps = placements.sort((a, b) => a.entryIndex - b.entryIndex);
    const result = indexMetrics(ps, bands, rawCost);
    return {
      ps,
      bands,
      phrases: bands.map(band => ({
        id: band.id,
        start: band.start,
        end: band.end,
        template: band.template,
        axis: band.axis,
        row: band.row,
        height: band.height,
        gap: K.bandGapRows,
        cost: band.fitCost
      })),
      phraseCount: bands.length,
      bandCount: bands.length,
      rawCost,
      bottom: Math.max(0, row - K.bandGapRows),
      m: result.m,
      diag: result.diag,
      s: result.score,
      datasetSignature: I.datasetSignature(),
      layoutProfile: I.profileKey(),
      variant: variant.id,
      variantLabel: variant.label,
      indexVersion: I.version
    };
  }

  function placementSignature(candidate) {
    return candidate.ps
      .map(placement => `${placement.x},${placement.row},${placement.span},${placement.rows},${placement.bandType}`)
      .join('|');
  }

  function generateIndex() {
    window.TypeBlockLayoutProfile?.applyDom?.();
    if (!entries.length) {
      candidates = [];
      selected = 0;
      if (typeof renderAll === 'function') renderAll();
      return;
    }

    const unique = new Map();
    I.variants.forEach(variant => {
      const candidate = buildCandidate(variant);
      const key = placementSignature(candidate);
      const current = unique.get(key);
      if (!current || candidate.s < current.s) unique.set(key, candidate);
    });
    candidates = [...unique.values()].sort((a, b) => a.s - b.s).slice(0, K.maxCandidates);
    selected = 0;
    I.updateStatus?.();
    if (typeof renderAll === 'function') renderAll();
  }

  Object.assign(I, { buildCandidate, generate: generateIndex });
  generate = generateIndex;
})();