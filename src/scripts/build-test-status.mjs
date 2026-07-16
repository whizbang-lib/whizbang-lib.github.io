#!/usr/bin/env node
// Builds the live test-status data files consumed by the docs site from TRX
// files produced by the library CI (TUnit / Microsoft.Testing.Platform with
// --report-trx).
//
// Usage:
//   node src/scripts/build-test-status.mjs --trx-dir <dir> \
//     [--run-id N --sha X --branch B --library-version V] \
//     [--out src/assets/data/test-status]
//
// Output:
//   <out>/index.json          run metadata + per-suite summary + shard map
//   <out>/<Assembly>.json     { "ClassTests.MethodAsync": { "o": "passed"|"failed"|"skipped", "d": ms } }
//
// Identity contract: shard keys are `<ShortClassName>.<TestMethodName>` — the
// same identity code-tests-map.json uses in its testsToCode section, so doc
// pages can resolve `testReferences` frontmatter to live status. Suite name is
// inferred from the TRX filename prefix when present (unit.trx, postgres.trx…).

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, basename } from 'path';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const TRX_DIR = arg('trx-dir');
const OUT_DIR = arg('out', 'src/assets/data/test-status');
if (!TRX_DIR) {
  console.error('Missing --trx-dir');
  process.exit(1);
}

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.trx')) out.push(p);
  }
  return out;
}

// TRX is machine-generated XML with a stable shape; targeted regex parsing
// avoids an XML dependency. Join <UnitTest id> → <TestMethod className> with
// <UnitTestResult testId> → outcome/duration.
function parseTrx(file) {
  const xml = readFileSync(file, 'utf8');

  const classById = new Map();
  const unitTestRe = /<UnitTest[^>]*\sid="([^"]+)"[\s\S]*?className="([^",]+)/g;
  let m;
  while ((m = unitTestRe.exec(xml)) !== null) {
    const shortClass = m[2].split('.').pop();
    classById.set(m[1], { full: m[2], short: shortClass });
  }

  const results = [];
  const resultRe = /<UnitTestResult\b[^>]*/g;
  while ((m = resultRe.exec(xml)) !== null) {
    const tag = m[0];
    const attr = (n) => (tag.match(new RegExp(`${n}="([^"]*)"`)) || [])[1];
    const testId = attr('testId');
    const testName = attr('testName');
    const outcome = (attr('outcome') || 'NotExecuted').toLowerCase();
    const duration = attr('duration'); // hh:mm:ss.fffffff
    let ms = 0;
    if (duration) {
      const [h, min, s] = duration.split(':');
      ms = Math.round((Number(h) * 3600 + Number(min) * 60 + Number(s)) * 1000);
    }
    const cls = classById.get(testId);
    if (!testName || !cls) continue;
    results.push({
      key: `${cls.short}.${testName}`,
      assembly: cls.full.split('.Tests')[0] + '.Tests', // Whizbang.Core.Tests.Offloads.FooTests → Whizbang.Core.Tests
      outcome: outcome === 'passed' ? 'passed' : outcome === 'failed' ? 'failed' : 'skipped',
      ms,
    });
  }
  return results;
}

const trxFiles = walk(TRX_DIR);
if (trxFiles.length === 0) {
  console.error(`No .trx files under ${TRX_DIR}`);
  process.exit(1);
}

const shards = new Map(); // assembly → { key → {o,d} }
const suites = {}; // suite → counts
let unmatchedAssembly = 0;

for (const file of trxFiles) {
  // Suite from artifact folder or filename prefix (e.g. trx-unit/…, unit-*.trx)
  const suite =
    (file.match(/trx-([a-z-]+)/i) || [])[1] ||
    (basename(file).match(/^([a-z]+)[-_.]/i) || [])[1] ||
    'tests';
  suites[suite] ??= { passed: 0, failed: 0, skipped: 0 };
  for (const r of parseTrx(file)) {
    suites[suite][r.outcome]++;
    if (!r.assembly.includes('.Tests')) { unmatchedAssembly++; continue; }
    if (!shards.has(r.assembly)) shards.set(r.assembly, {});
    shards.get(r.assembly)[r.key] = { o: r.outcome, d: r.ms, s: suite };
  }
}

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const assemblies = {};
let total = { passed: 0, failed: 0, skipped: 0 };
for (const [assembly, tests] of [...shards.entries()].sort()) {
  const fileName = `${assembly}.json`;
  writeFileSync(join(OUT_DIR, fileName), JSON.stringify(tests));
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const t of Object.values(tests)) counts[t.o]++;
  assemblies[assembly] = { file: fileName, ...counts };
  for (const k of Object.keys(total)) total[k] += counts[k];
}

const index = {
  run: {
    runId: arg('run-id', null),
    sha: arg('sha', null),
    branch: arg('branch', null),
    libraryVersion: arg('library-version', null),
    completedAt: new Date().toISOString(),
  },
  total,
  suites,
  assemblies,
};
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

console.log(`✅ test-status: ${trxFiles.length} TRX → ${shards.size} assembly shards, ` +
  `${total.passed} passed / ${total.failed} failed / ${total.skipped} skipped` +
  (unmatchedAssembly ? ` (${unmatchedAssembly} results with unrecognized assembly skipped)` : ''));
