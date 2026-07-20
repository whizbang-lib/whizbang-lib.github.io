#!/usr/bin/env node
// Verified-coverage burndown report for released docs (src/assets/docs/v1.0.0).
// For each page counts C# code examples and their verification state
// (verified via tests=, excused via unverified=, or an amber "needs test" gap)
// plus Mermaid diagrams and how many carry caption+tests. See
// .claude/skills/whizbang-docs-authoring/SKILL.md §3 for the conventions.
//
//   node src/scripts/coverage-report.mjs            # full per-page table
//   node src/scripts/coverage-report.mjs --summary  # totals only
//   node src/scripts/coverage-report.mjs --gaps     # only pages with remaining gaps

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = 'src/assets/docs/v1.0.0';
const CS = new Set(['csharp', 'cs', 'c#']);
const SUMMARY = process.argv.includes('--summary');
const GAPS_ONLY = process.argv.includes('--gaps');

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (e.endsWith('.md')) out.push(p);
  }
  return out;
}

const rows = [];
const tot = { pages: 0, cs: 0, csV: 0, csE: 0, gap: 0, mer: 0, merDone: 0 };

for (const f of walk(ROOT)) {
  const base = f.slice(f.lastIndexOf('/') + 1);
  if (base === '_folder.md' || base === 'README.md') continue;
  const text = readFileSync(f, 'utf8');
  let cs = 0, csV = 0, csE = 0, mer = 0, merDone = 0;
  // Match each fence opener + its {metadata} (which may span multiple lines up to
  // the first `}`) — mirrors the site's runtime parser. Handles both the inline
  // `key="v"` and multi-line `key: v` metadata forms.
  // Metadata capture is quote-aware (mirrors code-block-parser.service.ts): a `}`
  // inside a quoted value must not end the metadata region, else trailing
  // tests=/unverified= keys are missed and the block is miscounted as a gap.
  for (const m of text.matchAll(/^```([A-Za-z0-9#+_-]+)(\{(?:"[^"]*"|'[^']*'|[^}"'])*\})?/gm)) {
    const lang = m[1].toLowerCase();
    const meta = m[2] || '';
    if (lang === 'mermaid') {
      mer++;
      if (/caption\s*[:=]/.test(meta) && /tests\s*[:=]\s*\[/.test(meta)) merDone++;
    } else if (CS.has(lang)) {
      cs++;
      if (/tests\s*[:=]\s*\[/.test(meta)) csV++;
      else if (/unverified\s*[:=]/.test(meta)) csE++;
    }
  }
  if (cs === 0 && mer === 0) continue;
  const gap = cs - csV - csE;
  rows.push({ page: f.replace(ROOT + '/', ''), cs, csV, csE, gap, mer, merDone });
  tot.pages++; tot.cs += cs; tot.csV += csV; tot.csE += csE; tot.gap += gap; tot.mer += mer; tot.merDone += merDone;
}

rows.sort((a, b) => b.gap - a.gap || b.cs - a.cs);
const pct = tot.cs ? Math.round(((tot.csV + tot.csE) / tot.cs) * 100) : 0;

if (!SUMMARY) {
  const pad = (s, n) => String(s).padEnd(n);
  const r = (s, n) => String(s).padStart(n);
  console.log(pad('PAGE', 58) + r('C#', 4) + r('✓', 5) + r('n/a', 5) + r('gap', 5) + r('mer', 5) + r('done', 6));
  console.log('-'.repeat(88));
  for (const x of rows) {
    if (GAPS_ONLY && x.gap === 0 && x.mer === x.merDone) continue;
    console.log(pad(x.page, 58) + r(x.cs, 4) + r(x.csV, 5) + r(x.csE, 5) + r(x.gap, 5) + r(x.mer, 5) + r(x.merDone, 6));
  }
  console.log('-'.repeat(88));
}
console.log(`Pages: ${tot.pages} | C# examples: ${tot.cs} | verified: ${tot.csV} | excused: ${tot.csE} | gap: ${tot.gap}`);
console.log(`C# coverage (verified+excused): ${tot.csV + tot.csE}/${tot.cs} = ${pct}%`);
console.log(`Mermaid with caption+tests: ${tot.merDone}/${tot.mer}`);
