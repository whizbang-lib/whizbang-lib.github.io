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
import { join, basename, relative } from 'path';
import { pathToFileURL } from 'url';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
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

// The test project a result belongs to. The TRX names the assembly the test ran from
// (TestMethod codeBase), which is the project even when a test file moved between
// projects and kept its old namespace. Only a TRX without a codeBase falls back to
// the namespace: Whizbang.Core.Tests.Offloads.FooTests → Whizbang.Core.Tests.
function testAssembly(className, codeBase) {
  const fromCodeBase = (codeBase ?? '').split(/[\\/]/).pop().replace(/\.(dll|exe)$/i, '');
  if (fromCodeBase) return fromCodeBase;
  return className.split('.Tests')[0] + '.Tests';
}

// TRX is machine-generated XML with a stable shape; targeted regex parsing
// avoids an XML dependency. Join <UnitTest id> → <TestMethod className codeBase>
// with <UnitTestResult testId> → outcome/duration.
export function parseTrx(file) {
  const xml = readFileSync(file, 'utf8');

  const classById = new Map();
  const unitTestRe = /<UnitTest\b[^>]*\sid="([^"]+)"[\s\S]*?<TestMethod\b([^>]*)>/g;
  let m;
  while ((m = unitTestRe.exec(xml)) !== null) {
    const attrs = m[2];
    const full = (attrs.match(/\sclassName="([^",]+)/) || [])[1];
    if (!full) continue;
    const codeBase = (attrs.match(/\scodeBase="([^"]*)"/) || [])[1];
    classById.set(m[1], { full, short: full.split('.').pop(), assembly: testAssembly(full, codeBase) });
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
      assembly: cls.assembly,
      outcome: outcome === 'passed' ? 'passed' : outcome === 'failed' ? 'failed' : 'skipped',
      ms,
    });
  }
  return results;
}

/**
 * Builds the test-status data from every TRX file under trxDir into outDir, replacing what is there.
 * Throws when trxDir holds no TRX file. Returns the index it wrote.
 */
export function buildTestStatus({ trxDir, outDir, run = {}, log = console }) {
  const trxFiles = walk(trxDir);
  if (trxFiles.length === 0) {
    throw new Error(`No .trx files under ${trxDir}`);
  }

  const shards = new Map(); // assembly → { key → {o,d} }
  const suites = {}; // suite → counts

  for (const file of trxFiles) {
    // Suite from artifact folder or filename prefix (e.g. trx-unit/…, unit-*.trx), read below
    // trxDir only, so a directory above it can never name the suite.
    const suite =
      (relative(trxDir, file).match(/trx-([a-z-]+)/i) || [])[1] ||
      (basename(file).match(/^([a-z]+)[-_.]/i) || [])[1] ||
      'tests';
    suites[suite] ??= { passed: 0, failed: 0, skipped: 0 };
    for (const r of parseTrx(file)) {
      suites[suite][r.outcome]++;
      if (!shards.has(r.assembly)) shards.set(r.assembly, {});
      shards.get(r.assembly)[r.key] = { o: r.outcome, d: r.ms, s: suite };
    }
  }

  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const assemblies = {};
  let total = { passed: 0, failed: 0, skipped: 0 };
  for (const [assembly, tests] of [...shards.entries()].sort()) {
    const fileName = `${assembly}.json`;
    writeFileSync(join(outDir, fileName), JSON.stringify(tests));
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const t of Object.values(tests)) counts[t.o]++;
    assemblies[assembly] = { file: fileName, ...counts };
    for (const k of Object.keys(total)) total[k] += counts[k];
  }

  const index = {
    run: {
      runId: run.runId ?? null,
      sha: run.sha ?? null,
      branch: run.branch ?? null,
      libraryVersion: run.libraryVersion ?? null,
      completedAt: new Date().toISOString(),
    },
    total,
    suites,
    assemblies,
  };
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  log.log(`✅ test-status: ${trxFiles.length} TRX → ${shards.size} assembly shards, ` +
    `${total.passed} passed / ${total.failed} failed / ${total.skipped} skipped`);
  return index;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const trxDir = arg('trx-dir');
  if (!trxDir) {
    console.error('Missing --trx-dir');
    process.exit(1);
  }
  try {
    buildTestStatus({
      trxDir,
      outDir: arg('out', 'src/assets/data/test-status'),
      run: {
        runId: arg('run-id', null),
        sha: arg('sha', null),
        branch: arg('branch', null),
        libraryVersion: arg('library-version', null),
      },
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
