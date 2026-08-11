#!/usr/bin/env node
// Headless "Verified by tests" status across the whole released site — the same
// thing the badges show, without opening a browser. Cross-references every test
// linked in the docs (tests=[…] on C# fences + mermaid, and {verified: …} inline
// tokens) against the live CI data in src/assets/data/test-status/*.json.
//
// A badge renders from test-status ONLY (not code-tests-map.json): a key resolves
// green/red/skipped if it's in ANY shard; otherwise it renders "no data".
//
//   node src/scripts/test-status-report.mjs              # summary + per-section rollup
//   node src/scripts/test-status-report.mjs --failing    # RED badges: page:line + test (most urgent)
//   node src/scripts/test-status-report.mjs --missing     # linked but NO CI result (renders "no data")
//   node src/scripts/test-status-report.mjs --gaps        # C# examples with no test linked ("needs test")
//   node src/scripts/test-status-report.mjs --fixable     # excused blocks whose cited test IS in test-status (re-link -> green)
//   node src/scripts/test-status-report.mjs --page dispatcher   # restrict to matching page paths
//   node src/scripts/test-status-report.mjs --json        # machine-readable dump of everything
//
// Flags combine; with no detail flag you get the summary.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const DOCS = 'src/assets/docs/v1.0.0';
const STATUS_DIR = 'src/assets/data/test-status';
const CS = new Set(['csharp', 'cs', 'c#']);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const pageFilter = (() => { const i = argv.indexOf('--page'); return i >= 0 ? argv[i + 1] : null; })();
const JSON_OUT = has('--json');

// ---- load live test-status (key -> {o, shard}) ----
const status = new Map();
let runMeta = null;
for (const f of readdirSync(STATUS_DIR)) {
  if (!f.endsWith('.json')) continue;
  const data = JSON.parse(readFileSync(join(STATUS_DIR, f), 'utf8'));
  if (f === 'index.json') { runMeta = data.run || null; continue; }
  for (const k of Object.keys(data)) status.set(k, { o: data[k].o, shard: f });
}
const statusClasses = new Set([...status.keys()].map((k) => k.split('.')[0]));

// ---- walk docs, extract linked keys + bare gaps + excuses ----
function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (e.endsWith('.md')) out.push(p);
  }
  return out;
}
const KEY = /[A-Z][A-Za-z0-9_]*\.[A-Za-z0-9_]+Async/g;
// quote-aware fence-metadata capture (mirrors code-block-parser.service.ts)
const FENCE = /^```([A-Za-z0-9#+_-]+)((?:\{(?:"[^"]*"|'[^']*'|[^}"'])*\})?)/gm;
const VERIFIED_TOKEN = /\{verified:\s*([^}]+)\}/g;

const links = [];       // {page,line,kind,key,outcome}
const gaps = [];        // {page,line,title}  C# fence, no tests/unverified
const fixable = [];     // {page,line,cls,title}  unverified excuse citing a class that IS in test-status

const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;

for (const file of walk(DOCS)) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  if (base === '_folder.md' || base === 'README.md') continue;
  const rel = file.replace(DOCS + '/', '');
  if (pageFilter && !rel.includes(pageFilter)) continue;
  const text = readFileSync(file, 'utf8');

  // fences (C# + mermaid)
  let m;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text))) {
    const lang = m[1].toLowerCase();
    const meta = m[2] || '';
    const line = lineAt(text, m.index);
    const title = (meta.match(/title\s*[:=]\s*"([^"]+)"/) || [])[1] || '(untitled)';
    const testsM = meta.match(/tests\s*[:=]\s*\[([^\]]*)\]/);
    const unver = /unverified\s*[:=]/.test(meta);
    if (testsM) {
      for (const key of testsM[1].match(KEY) || []) {
        const st = status.get(key);
        links.push({ page: rel, line, kind: lang === 'mermaid' ? 'diagram' : 'code', key, outcome: st ? st.o : 'missing', shard: st?.shard });
      }
    } else if (CS.has(lang) && !unver) {
      gaps.push({ page: rel, line, title });
    }
    if (unver) {
      // excuse citing a class present in test-status => re-linkable to green
      const cls = (meta.match(/verified by ([A-Za-z0-9_]+Tests)/) || [])[1];
      if (cls && statusClasses.has(cls)) fixable.push({ page: rel, line, cls, title });
    }
  }
  // inline {verified: …} tokens (prose/tables/headings)
  let vm;
  VERIFIED_TOKEN.lastIndex = 0;
  while ((vm = VERIFIED_TOKEN.exec(text))) {
    const line = lineAt(text, vm.index);
    for (const key of vm[1].match(KEY) || []) {
      const st = status.get(key);
      links.push({ page: rel, line, kind: 'inline', key, outcome: st ? st.o : 'missing', shard: st?.shard });
    }
  }
}

// ---- tally ----
const tally = { passed: 0, failed: 0, skipped: 0, missing: 0 };
for (const l of links) tally[l.outcome] = (tally[l.outcome] || 0) + 1;
const distinctLinked = new Set(links.map((l) => l.key));
const distinctMissing = new Set(links.filter((l) => l.outcome === 'missing').map((l) => l.key));

if (JSON_OUT) {
  console.log(JSON.stringify({ run: runMeta, tally, links, gaps, fixable }, null, 2));
  process.exit(0);
}

const failing = links.filter((l) => l.outcome === 'failed');
const missing = links.filter((l) => l.outcome === 'missing');

function detail(title, rows, fmt) {
  console.log(`\n${title} (${rows.length}):`);
  if (!rows.length) { console.log('  — none —'); return; }
  for (const r of rows.sort((a, b) => (a.page + a.line).localeCompare(b.page + b.line))) console.log('  ' + fmt(r));
}

// Detail flags
let shownDetail = false;
if (has('--failing')) { detail('🔴 FAILING linked tests (red badges)', failing, (r) => `${r.page}:${r.line}  ${r.key}  [${r.shard || '?'}]`); shownDetail = true; }
if (has('--missing')) { detail('⚪ Linked but NO CI result (renders "no data")', missing, (r) => `${r.page}:${r.line}  ${r.key}`); shownDetail = true; }
if (has('--gaps')) { detail('🟠 C# examples with NO test linked ("needs test")', gaps, (r) => `${r.page}:${r.line}  ${r.title}`); shownDetail = true; }
if (has('--fixable')) { detail('🟢 Excused but cited test IS in test-status (re-link -> green)', fixable, (r) => `${r.page}:${r.line}  ${r.cls}  (${r.title})`); shownDetail = true; }

// Summary (always, unless a detail flag was the whole ask)
if (!shownDetail) {
  if (runMeta) console.log(`Run ${runMeta.runId} @ ${runMeta.branch} (${runMeta.libraryVersion}) — ${runMeta.completedAt}`);
  console.log(`\nLinked test references: ${links.length} (${distinctLinked.size} distinct)`);
  console.log(`  🟢 passing:  ${tally.passed}`);
  console.log(`  🔴 failing:  ${tally.failed}`);
  console.log(`  ⚪ skipped:  ${tally.skipped}`);
  console.log(`  ⚪ no CI result (missing): ${tally.missing}  (${distinctMissing.size} distinct keys)`);
  console.log(`🟠 C# examples with no test linked (needs-test gaps): ${gaps.length}`);
  console.log(`🟢 excused blocks whose cited test IS in test-status (re-link candidates): ${fixable.length}`);

  // Per-section rollup
  const sec = {};
  for (const l of links) { const s = l.page.split('/').slice(0, 2).join('/'); (sec[s] = sec[s] || { p: 0, f: 0, m: 0 }); sec[s][l.outcome === 'passed' ? 'p' : l.outcome === 'failed' ? 'f' : 'm']++; }
  for (const g of gaps) { const s = g.page.split('/').slice(0, 2).join('/'); (sec[s] = sec[s] || { p: 0, f: 0, m: 0, gap: 0 }); sec[s].gap = (sec[s].gap || 0) + 1; }
  console.log('\nPer-section (pass / fail / no-data / needs-test):');
  for (const s of Object.keys(sec).sort()) { const x = sec[s]; console.log(`  ${s.padEnd(30)} ${String(x.p).padStart(4)} / ${x.f} / ${x.m || 0} / ${x.gap || 0}`); }

  console.log('\nDetail: add --failing | --missing | --gaps | --fixable | --page <substr> | --json');
  if (tally.failed) console.log('⚠️  There are FAILING linked tests — run with --failing.');
}
