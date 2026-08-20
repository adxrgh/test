import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.dirname(fileURLToPath(import.meta.url));

function emptyRolling() {
  return {
    cost: 0,
    whiteField: 0,
    corridor: 0,
    balance: 0,
    wins: [],
    worst: null,
    p90: 0,
    mean: 0,
    max: 0
  };
}

const layoutNode = { clientWidth: 358 };
const context = {
  console,
  Promise,
  Map,
  Set,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  Date,
  C: 6,
  U: 8,
  entries: [
    { id: 1, chars: 4200, target: 104, provenance: "collected", digest: "a", editorial: { status: "ready", function: "referenceMaterial" } },
    { id: 2, chars: 420, target: 40, provenance: "authored", digest: "b", editorial: { status: "ready", function: "response" } },
    { id: 3, chars: 360, target: 38, provenance: "authored", digest: "c", editorial: { status: "ready", function: "continuation" } },
    { id: 4, chars: 1700, target: 70, provenance: "collected", digest: "d", editorial: { status: "ready", function: "referenceMaterial" } },
    { id: 5, chars: 1550, target: 67, provenance: "collected", digest: "e", editorial: { status: "ready", function: "referenceMaterial" } },
    { id: 6, chars: 1450, target: 64, provenance: "collected", digest: "f", editorial: { status: "ready", function: "background" } },
    { id: 7, chars: 1320, target: 61, provenance: "collected", digest: "g", editorial: { status: "ready", function: "background" } },
    { id: 8, chars: 6900, target: 135, provenance: "collected", digest: "h", editorial: { status: "ready", function: "referenceMaterial" } },
    { id: 9, chars: 980, target: 56, provenance: "collected", digest: "i", editorial: { status: "ready", function: "background" } },
    { id: 10, chars: 250, target: 33, provenance: "authored", digest: "j", editorial: { status: "ready", function: "fragment" } }
  ],
  candidates: [],
  selected: 0,
  W: { shape: 1, editorial: 1, semantic: 1, area: 1, whiteField: 1, rolling: 1, move: 1 },
  activeDatasetSignature: () => "smoke-dataset",
  layoutProfileKey: () => "mobile",
  isMobileLayout: () => true,
  layoutGutter: () => 8,
  layoutTargetFor: entry => entry.target,
  layoutMinSpan: () => 3,
  editorialValue: entry => entry.editorial,
  boundarySignals: () => Array.from({ length: 10 }, (_, index) => ({
    breakStrength: index === 0 ? 1 : 0.2,
    continuity: index === 0 ? 0 : 0.75,
    topicShift: index === 0 ? 1 : 0.18,
    hardBreak: false,
    hardJoin: index > 0
  })),
  stability: () => 0,
  semanticCost: () => 0,
  rolling: emptyRolling,
  score: metrics => Object.values(metrics).reduce((sum, value) => sum + Number(value || 0), 0),
  renderAll: () => {},
  generate: () => {},
  addEventListener: () => {},
  document: {
    getElementById: id => id === "layout" ? layoutNode : null,
    createElement: () => ({
      style: {},
      className: "",
      appendChild() {},
      remove() {},
      isConnected: true
    }),
    body: { appendChild() {} },
    fonts: { ready: Promise.resolve(), addEventListener() {} }
  }
};
context.window = context;
vm.createContext(context);

for (const file of ["editorial-index-core.js", "editorial-index-layout.js"]) {
  const source = await readFile(path.join(root, file), "utf8");
  vm.runInContext(source, context, { filename: file });
  if (file === "editorial-index-core.js") {
    const index = context.TypeBlockEditorialIndex;
    index.headerMetrics = () => ({ rows: 0, height: 0, titleLines: 0, deckLines: 0 });
    index.bodyRowsFor = (entry, span, role) => {
      const minimum = role === "support" ? 6 : role === "matrix" ? 9 : 12;
      return Math.max(minimum, Math.ceil(entry.target / span / 3) * 3);
    };
    index.shapeFor = (entry, span, rows, bodyRows) => ({
      intrinsic: 0,
      editorial: 0,
      context: 0,
      stability: 0,
      fill: 1,
      cpl: 20,
      aspect: span / rows,
      previewLines: Math.max(1, Math.floor(bodyRows / 3)),
      previewCoverage: 0.5,
      total: 0
    });
  }
}

context.generate();
assert.ok(context.candidates.length >= 1, "at least one index candidate should be generated");

for (const candidate of context.candidates) {
  assert.equal(candidate.ps.length, context.entries.length, "every Entry must have exactly one placement");
  assert.deepEqual(candidate.ps.map(placement => placement.entryIndex), [...context.entries.keys()], "placements must preserve source order");
  assert.ok(candidate.bands.length >= 1, "candidate must contain editorial bands");
  assert.ok(candidate.bands.every(band => ["lead", "matrix", "feature"].includes(band.type)), "only legal band types may be used");
  assert.equal(candidate.bands[0].start, 0, "bands must start at the first Entry");
  assert.equal(candidate.bands.at(-1).end, context.entries.length, "bands must cover the final Entry");
  for (let index = 1; index < candidate.bands.length; index += 1) {
    assert.equal(candidate.bands[index - 1].end, candidate.bands[index].start, "bands must be contiguous without reordering or dense backfill");
  }
  assert.ok(candidate.ps.every(placement => placement.span >= 1 && placement.span <= 6 && placement.rows > 0), "all placements must remain inside the six-column grid");
}

console.log(`Editorial index smoke test passed for ${context.candidates.length} candidate(s).`);
