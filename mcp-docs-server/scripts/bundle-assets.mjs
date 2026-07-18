#!/usr/bin/env node
// Bundles a snapshot of the docs-site assets into bundled-assets/ so the
// published npm package works standalone (consumer mode) without a docs-repo
// checkout. Runs from prepublishOnly. Live test-status data is deliberately
// NOT bundled — it is always fetched from the live site so badges never lie.
//
// docs-list.json and search-index.json are GENERATED here from the bundled
// markdown (using gray-matter, a package dependency) rather than copied from
// the repo: those files are gitignored build artifacts, so a fresh CI/publish
// checkout doesn't have them — copying produced an incomplete bundle. The
// code↔docs / code↔tests maps ARE committed, so those are copied.

import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoAssets = path.resolve(__dirname, '../../src/assets');
const outDir = path.resolve(__dirname, '../bundled-assets');
const docsSrc = path.join(repoAssets, 'docs');

if (!existsSync(docsSrc)) {
  console.error(`Docs assets not found at ${repoAssets} — bundle-assets must run from a docs-repo checkout.`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Markdown corpus (the server reads pages directly)
const outDocs = path.join(outDir, 'docs');
cpSync(docsSrc, outDocs, { recursive: true });

// Walk the bundled markdown once.
function walk(dir, base = dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p, base));
    else if (entry.endsWith('.md')) out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}
const mdFiles = walk(outDocs).sort();

// docs-list.json — array of slugs (path without .md), exactly what
// FileLoader.listDocFiles expects.
const slugs = mdFiles.map((f) => f.replace(/\.md$/, ''));
writeFileSync(path.join(outDir, 'docs-list.json'), JSON.stringify(slugs, null, 0));

// search-index.json — SearchDocument[] { type, slug, title, category, url, chunks }.
// MiniSearch is built from this at runtime; chunk the body so search stays
// granular without pulling in the heavy embedding pipeline.
const CHUNK = 1500;
const titleFromSlug = (slug) =>
  slug.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const searchDocs = mdFiles.map((f) => {
  const slug = f.replace(/\.md$/, '');
  let data = {}, body = '';
  try { ({ data, content: body } = matter(readFileSync(path.join(outDocs, f), 'utf8'))); } catch { /* keep raw */ }
  // Strip code fences and markdown noise for cleaner search text.
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[#>|*\-\s].*$/gm, (l) => l.replace(/[#>|*`]/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK) {
    const t = text.slice(i, i + CHUNK);
    chunks.push({ id: `${slug}-chunk-${chunks.length}`, text: t, startIndex: i, preview: t.slice(0, 150) });
  }
  if (chunks.length === 0) chunks.push({ id: `${slug}-chunk-0`, text: '', startIndex: 0, preview: '' });
  return {
    type: 'document',
    slug,
    title: data.title || titleFromSlug(slug),
    category: data.category || (slug.includes('/') ? slug.split('/')[0] : 'General'),
    url: `/docs/${slug}`,
    chunks,
  };
});
writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(searchDocs));

// Committed maps — copy as-is (present in every checkout).
for (const f of ['code-docs-map.json', 'code-tests-map.json']) {
  const src = path.join(repoAssets, f);
  if (existsSync(src)) cpSync(src, path.join(outDir, f));
  else console.warn(`⚠ ${f} missing — code↔docs/tests navigation will be limited`);
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

console.log(
  `✅ Bundled docs → ${outDir}: ${mdFiles.length} pages, ${searchDocs.length} search docs (docs repo ${sha.slice(0, 8)})`
);
