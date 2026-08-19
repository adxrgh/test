import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const files = [
  "core.js",
  "layout-profile.js",
  "text-metrics.js",
  "projection-metrics.js",
  "provider-openrouter.js",
  "solver-phrase-model.js",
  "typography-layout-adapter.js",
  "solver-phrase-templates.js",
  "solver-phrase-engine.js",
  "ui.js",
  "typography-ui.js",
  "persistence.js",
  "editorial-projection.js",
  "projection-ui.js",
  "import-data.js",
  "server.mjs",
  "api/editorial-scan.mjs",
  "api/editorial-projection.mjs"
];

let failed = false;
for (const relative of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], {
    encoding: "utf8"
  });
  if (result.status === 0) {
    console.log(`OK  ${relative}`);
    continue;
  }
  failed = true;
  console.error(`FAIL ${relative}`);
  if (result.stderr) console.error(result.stderr.trim());
}

if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} files.`);
