// Tests for library-review-recheck.mjs. Run: pnpm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { libraryPullRequestsToRecheck, formatOutput, run, MAX_DISPATCHES } from './library-review-recheck.mjs';

/** A pull_request_target event, trimmed to the fields the script reads. */
function event({ action = 'opened', body = 'Docs for whizbang-lib/whizbang#1805', changes } = {}) {
  return { action, pull_request: { number: 1579, body }, ...(changes ? { changes } : {}) };
}

// --- libraryPullRequestsToRecheck -------------------------------------------------------------------------------

test('a docs pull request opened or reopened names the library pull request to re-check', () => {
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'opened' })), [1805]);
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'reopened' })), [1805]);
});

test('a link by URL counts, as it does for the linked-change gate', () => {
  const body = 'Docs for https://github.com/whizbang-lib/whizbang/pull/1805 and whizbang-lib/whizbang#1806';
  assert.deepEqual(libraryPullRequestsToRecheck(event({ body })), [1805, 1806]);
});

test('an edit re-checks only when the description changed', () => {
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'edited', changes: { body: { from: 'Docs' } } })), [1805]);
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'edited', changes: { title: { from: 'old' } } })), []);
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'edited' })), []);
});

test('any other action re-checks nothing', () => {
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'synchronize' })), []);
  assert.deepEqual(libraryPullRequestsToRecheck(event({ action: 'closed' })), []);
});

test('references in code, to other repositories, or with no number re-check nothing', () => {
  const body = [
    '`Docs for whizbang-lib/whizbang#1`',
    '```',
    'Docs for whizbang-lib/whizbang#2',
    '```',
    'whizbang-lib/whizbang-lib.github.io#3, other/whizbang#4, whizbang-lib/whizbang#, #5',
  ].join('\n');
  assert.deepEqual(libraryPullRequestsToRecheck(event({ body })), []);
});

test('an empty or missing description, or a missing pull request, re-checks nothing', () => {
  assert.deepEqual(libraryPullRequestsToRecheck(event({ body: '' })), []);
  assert.deepEqual(libraryPullRequestsToRecheck(event({ body: null })), []);
  assert.deepEqual(libraryPullRequestsToRecheck({ action: 'opened' }), []);
  assert.deepEqual(libraryPullRequestsToRecheck(null), []);
});

test('only positive numbers of at most nine digits are sent, each once, at most MAX_DISPATCHES of them', () => {
  const many = Array.from({ length: MAX_DISPATCHES + 5 }, (_, i) => `whizbang-lib/whizbang#${i + 1}`).join(' ');
  const numbers = libraryPullRequestsToRecheck(event({ body: `${many} whizbang-lib/whizbang#1` }));
  assert.equal(numbers.length, MAX_DISPATCHES);
  assert.deepEqual(numbers, Array.from({ length: MAX_DISPATCHES }, (_, i) => i + 1));

  const odd = 'whizbang-lib/whizbang#0 whizbang-lib/whizbang#1234567890 whizbang-lib/whizbang#42';
  assert.deepEqual(libraryPullRequestsToRecheck(event({ body: odd })), [42]);
});

// --- formatOutput -----------------------------------------------------------------------------------------------

test('formatOutput writes the numbers as one JSON step output', () => {
  assert.equal(formatOutput([1805, 1806]), 'numbers=[1805,1806]\n');
  assert.equal(formatOutput([]), 'numbers=[]\n');
});

// --- run --------------------------------------------------------------------------------------------------------

test('run reads the event file and writes the step output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-recheck-'));
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output');
  writeFileSync(eventPath, JSON.stringify(event()));
  writeFileSync(outputPath, '');
  const lines = [];
  const numbers = run({ eventPath, outputPath, log: (line) => lines.push(line) });
  assert.deepEqual(numbers, [1805]);
  assert.equal(readFileSync(outputPath, 'utf8'), 'numbers=[1805]\n');
  assert.deepEqual(lines, ['Docs pull request #1579 (opened) names whizbang-lib/whizbang#1805.']);
});

test('run says so when there is nothing to re-check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-recheck-'));
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'output');
  writeFileSync(eventPath, JSON.stringify(event({ action: 'edited' })));
  writeFileSync(outputPath, '');
  const lines = [];
  assert.deepEqual(run({ eventPath, outputPath, log: (line) => lines.push(line) }), []);
  assert.equal(readFileSync(outputPath, 'utf8'), 'numbers=[]\n');
  assert.deepEqual(lines, ['Docs pull request #1579 (edited) names no library pull request to re-check.']);
});

test('run fails without the event and output files', () => {
  assert.throws(() => run({ eventPath: '', outputPath: 'x', log: () => {} }), /GITHUB_EVENT_PATH and GITHUB_OUTPUT are required/);
  assert.throws(() => run({ eventPath: 'x', outputPath: undefined, log: () => {} }), /GITHUB_EVENT_PATH and GITHUB_OUTPUT are required/);
});
