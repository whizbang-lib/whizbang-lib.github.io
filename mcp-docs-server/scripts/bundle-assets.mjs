#!/usr/bin/env node
// Bundles a snapshot of the docs-site assets into bundled-assets/ so the
// published npm package works standalone (consumer mode) without a docs-repo
// checkout. Runs from prepublishOnly. Live test-status data is deliberately
// NOT bundled — it is always fetched from the live site so badges never lie.

import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoAssets = path.resolve(__dirname, '../../src/assets');
const outDir = path.resolve(__dirname, '../bundled-assets');

if (!existsSync(path.join(repoAssets, 'docs'))) {
  console.error(`Docs assets not found at ${repoAssets} — bundle-assets must run from a docs-repo checkout.`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Markdown corpus (the server reads pages directly)
cpSync(path.join(repoAssets, 'docs'), path.join(outDir, 'docs'), { recursive: true });

// Indexes and maps the server loads (enhanced-search-index is skipped — 13 MB,
// only used for optional semantic search which degrades gracefully)
for (const f of ['docs-list.json', 'search-index.json', 'code-docs-map.json', 'code-tests-map.json']) {
  const src = path.join(repoAssets, f);
  if (existsSync(src)) cpSync(src, path.join(outDir, f));
  else console.warn(`⚠ ${f} missing — run the docs index generators first`);
}

// Provenance stamp
let sha = 'unknown';
try {
  sha = execSync('git rev-parse HEAD', { cwd: repoAssets }).toString().trim();
} catch { /* not a git checkout */ }
writeFileSync(
  path.join(outDir, 'bundle-info.json'),
  JSON.stringify({ bundledAt: new Date().toISOString(), docsRepoCommit: sha }, null, 2)
);

console.log(`✅ Bundled docs assets → ${outDir} (docs repo ${sha.slice(0, 8)})`);
