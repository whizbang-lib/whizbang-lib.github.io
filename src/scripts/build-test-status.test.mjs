// Tests for build-test-status.mjs. Run: pnpm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildTestStatus } from './build-test-status.mjs';

const silent = { log() {} };

let ids = 0;
const nextId = () => `00000000-0000-0000-0000-${String(++ids).padStart(12, '0')}`;

/**
 * A TRX file shaped like the one TUnit writes with --report-trx: each result joins to a test definition whose
 * TestMethod carries the class name and, in codeBase, the test assembly the test ran from. Pass codeBase: null to
 * leave the attribute out.
 */
function trx(tests) {
  const results = [];
  const defs = [];
  for (const t of tests) {
    const testId = nextId();
    results.push(`    <UnitTestResult executionId="${nextId()}" testId="${testId}" testName="${t.method}" computerName="ci" duration="00:00:00.0250000" outcome="${t.outcome ?? 'Passed'}" />`);
    const codeBase = t.codeBase === null ? '' : ` codeBase="${t.codeBase ?? `/ci/tests/${t.assembly}/bin/Release/net10.0/${t.assembly}.dll`}"`;
    defs.push(`    <UnitTest name="${t.method}" id="${testId}">\n      <Execution id="${nextId()}" />\n      <TestMethod${codeBase} adapterTypeName="executor://TUnitExtension/1.12.125.0" className="${t.className}" name="${t.method}" />\n    </UnitTest>`);
  }
  return `﻿<?xml version="1.0" encoding="utf-8"?>\n<TestRun id="${nextId()}" name="ci" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n  <Results>\n${results.join('\n')}\n  </Results>\n  <TestDefinitions>\n${defs.join('\n')}\n  </TestDefinitions>\n</TestRun>\n`;
}

/** A TRX tree laid out like the library CI's downloaded trx-* artifacts: { 'trx-unit': [tests], ... }. */
function trxTree(artifacts) {
  const dir = mkdtempSync(join(tmpdir(), 'test-status-trx-'));
  for (const [artifact, tests] of Object.entries(artifacts)) {
    mkdirSync(join(dir, artifact), { recursive: true });
    writeFileSync(join(dir, artifact, '_ci_2026-10-09_00_00_00.trx'), trx(tests));
  }
  return dir;
}

const shard = (outDir, assembly) => {
  const path = join(outDir, `${assembly}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};
const index = (outDir) => JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'));

const STAYS = { assembly: 'Whizbang.Core.Tests', className: 'Whizbang.Core.Tests.Async.AsyncTimeoutHelperTests', method: 'ATaskThatCompletesInTime_PassesThroughAsync' };
const MOVED_METHOD = 'WaitAsync_RepeatedWhilePending_ReturnsTheSameTaskAndKeepsOneWaiterAsync';
const MOVED_KEY = `WakeSignalTests.${MOVED_METHOD}`;

test('a test file moved to another project with its namespace unchanged is reported under the project it ran in', () => {
  const trxDir = trxTree({
    'trx-unit': [STAYS],
    'trx-component': [
      { assembly: 'Whizbang.Core.Component.Tests', className: 'Whizbang.Core.Tests.Async.WakeSignalTests', method: MOVED_METHOD },
    ],
  });
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  buildTestStatus({ trxDir, outDir, log: silent });

  assert.equal(shard(outDir, 'Whizbang.Core.Component.Tests')?.[MOVED_KEY]?.o, 'passed');
  assert.equal(shard(outDir, 'Whizbang.Core.Component.Tests')[MOVED_KEY].s, 'component');
  assert.ok(!(MOVED_KEY in shard(outDir, 'Whizbang.Core.Tests')), 'the old project must no longer claim the moved test');
  assert.deepEqual(index(outDir).assemblies['Whizbang.Core.Tests'], { file: 'Whizbang.Core.Tests.json', passed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(index(outDir).assemblies['Whizbang.Core.Component.Tests'], { file: 'Whizbang.Core.Component.Tests.json', passed: 1, failed: 0, skipped: 0 });
});

test('a test whose namespace names no test project is reported under the assembly it ran in', () => {
  const trxDir = trxTree({
    'trx-integration': [
      { assembly: 'Whizbang.Core.Integration.Tests', className: 'TestNamespaces.MyApp.Orders.Events.OrderEventTests', method: 'RoundTripsAsync' },
    ],
  });
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  buildTestStatus({ trxDir, outDir, log: silent });

  assert.deepEqual(Object.keys(index(outDir).assemblies), ['Whizbang.Core.Integration.Tests']);
  assert.equal(shard(outDir, 'Whizbang.Core.Integration.Tests')['OrderEventTests.RoundTripsAsync'].o, 'passed');
});

test('a test assembly whose name has no ".Tests" segment keeps its results', () => {
  const trxDir = trxTree({
    'trx-integration': [
      { assembly: 'ECommerce.IntegrationTests', className: 'ECommerce.IntegrationTests.OrderServiceIntegrationTests', method: 'CreatesAnOrderAsync' },
    ],
  });
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  buildTestStatus({ trxDir, outDir, log: silent });

  assert.equal(shard(outDir, 'ECommerce.IntegrationTests')?.['OrderServiceIntegrationTests.CreatesAnOrderAsync']?.o, 'passed');
});

test('a new test project gets its own shard and index entry with no registration anywhere', () => {
  const trxDir = trxTree({
    'trx-component': [
      { assembly: 'Whizbang.Core.Component.Tests', className: 'Whizbang.Core.Component.Tests.ComponentSuiteTests', method: 'TheSuiteRunsAsync' },
      { assembly: 'Whizbang.Core.Component.Tests', className: 'Whizbang.Core.Component.Tests.ComponentSuiteTests', method: 'AFailingTestAsync', outcome: 'Failed' },
    ],
  });
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  const written = buildTestStatus({ trxDir, outDir, log: silent });

  assert.deepEqual(written.assemblies['Whizbang.Core.Component.Tests'], { file: 'Whizbang.Core.Component.Tests.json', passed: 1, failed: 1, skipped: 0 });
  assert.deepEqual(written.suites.component, { passed: 1, failed: 1, skipped: 0 });
});

test('a project whose every test moved out leaves no shard behind from the previous run', () => {
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');
  buildTestStatus({
    trxDir: trxTree({ 'trx-unit': [{ assembly: 'Whizbang.Old.Tests', className: 'Whizbang.Old.Tests.FooTests', method: 'BarAsync' }] }),
    outDir,
    log: silent,
  });
  assert.ok(shard(outDir, 'Whizbang.Old.Tests'));

  buildTestStatus({
    trxDir: trxTree({ 'trx-component': [{ assembly: 'Whizbang.New.Tests', className: 'Whizbang.Old.Tests.FooTests', method: 'BarAsync' }] }),
    outDir,
    log: silent,
  });

  assert.equal(shard(outDir, 'Whizbang.Old.Tests'), null);
  assert.deepEqual(Object.keys(index(outDir).assemblies), ['Whizbang.New.Tests']);
});

test('the suite comes from the artifact folder, not from a directory above the TRX root', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'test-status-')), 'trx-checkout', 'trx');
  mkdirSync(join(root, 'trx-component'), { recursive: true });
  writeFileSync(join(root, 'trx-component', '_ci.trx'), trx([STAYS]));
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  const written = buildTestStatus({ trxDir: root, outDir, log: silent });

  assert.deepEqual(Object.keys(written.suites), ['component']);
});

test('a republished artifact (trx-queue/trx-component/…) keeps the suite of the folder that holds the TRX', () => {
  const trxDir = mkdtempSync(join(tmpdir(), 'test-status-queue-'));
  mkdirSync(join(trxDir, 'trx-queue', 'trx-component'), { recursive: true });
  writeFileSync(join(trxDir, 'trx-queue', 'trx-component', '_ci.trx'), trx([STAYS]));
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  const written = buildTestStatus({ trxDir, outDir, log: silent });

  assert.deepEqual(Object.keys(written.suites), ['component']);
});

test('without a codeBase the project is still inferred from the namespace', () => {
  const trxDir = trxTree({
    'trx-unit': [{ assembly: 'unused', codeBase: null, className: 'Whizbang.Core.Tests.Async.WakeSignalTests', method: MOVED_METHOD }],
  });
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  buildTestStatus({ trxDir, outDir, log: silent });

  assert.equal(shard(outDir, 'Whizbang.Core.Tests')[MOVED_KEY].o, 'passed');
});

test('a directory without TRX files is refused and nothing is written', () => {
  const trxDir = mkdtempSync(join(tmpdir(), 'test-status-empty-'));
  const outDir = join(mkdtempSync(join(tmpdir(), 'test-status-out-')), 'test-status');

  assert.throws(() => buildTestStatus({ trxDir, outDir, log: silent }), /No \.trx files/);
  assert.equal(existsSync(outDir), false);
});
