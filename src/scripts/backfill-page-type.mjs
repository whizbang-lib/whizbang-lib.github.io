#!/usr/bin/env node
// One-shot heuristic backfill of the Diátaxis-based `pageType` frontmatter field
// (overview|concept|tutorial|guide|reference|troubleshooting) for pages that lack it.
// Heuristics are deliberately conservative defaults — content passes refine them
// page-by-page. Run with --dry-run to preview assignments without writing.
//
//   node src/scripts/backfill-page-type.mjs [--dry-run] [--root src/assets/docs/v1.0.0]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, basename, dirname } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg !== -1 ? process.argv[rootArg + 1] : 'src/assets/docs/v1.0.0';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

function inferPageType(file, title) {
  const name = basename(file, '.md').toLowerCase();
  const dir = dirname(file).toLowerCase();
  const t = (title || '').toLowerCase();
  const hay = `${dir}/${name} ${t}`;

  if (name === 'index' || name === dirname(file).split('/').pop()) return 'overview';
  if (/quick-start|tutorial|walkthrough|first-|your-first/.test(hay)) return 'tutorial';
  if (/troubleshoot|diagnostic|whiz\d|faq|common-issues|common-errors|error-reference|debugging/.test(hay)) return 'troubleshooting';
  if (/-reference|reference-|glossary|configuration-reference|options|api-surface|cheat-?sheet|matrix/.test(hay)) return 'reference';
  if (/migration-guide|migration-|how-to|howto|installation|deployment|setup|configuring|integrating|getting-started/.test(hay)) return 'guide';
  return 'concept';
}

const counts = {};
let updated = 0;
let skipped = 0;

for (const file of walk(ROOT)) {
  const base = basename(file);
  if (base === '_folder.md' || base === 'README.md') continue;
  const text = readFileSync(file, 'utf8');
  if (!text.startsWith('---\n')) { skipped++; continue; }
  const fmEnd = text.indexOf('\n---', 4);
  const fm = text.slice(4, fmEnd);
  if (/^pageType:/m.test(fm)) { skipped++; continue; }

  const title = (fm.match(/^title:\s*(.+)$/m) || [])[1];
  const pageType = inferPageType(file, title);
  counts[pageType] = (counts[pageType] || 0) + 1;

  if (DRY_RUN) {
    console.log(`${pageType.padEnd(15)} ${file}`);
  } else {
    // Insert after the title line when present, else at the top of the frontmatter.
    const lines = fm.split('\n');
    const titleIdx = lines.findIndex((l) => /^title:/.test(l));
    lines.splice(titleIdx === -1 ? 0 : titleIdx + 1, 0, `pageType: ${pageType}`);
    writeFileSync(file, `---\n${lines.join('\n')}${text.slice(fmEnd)}`);
  }
  updated++;
}

console.log(`\n${DRY_RUN ? '[dry-run] would update' : 'Updated'} ${updated} pages (${skipped} already had pageType or no frontmatter):`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(15)} ${v}`);
