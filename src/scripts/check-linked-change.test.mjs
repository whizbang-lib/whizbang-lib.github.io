// Tests for check-linked-change.mjs. Run: pnpm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripCode,
  findLibraryRefs,
  findClosingRefs,
  exemptionReason,
  evaluate,
  renderSummary,
  makeGitHubLookup,
  LIBRARY_REPO,
} from './check-linked-change.mjs';

const THIS_REPO = 'whizbang-lib/whizbang-lib.github.io';

/** A pull request as the REST API returns it, trimmed to the fields the gate reads. */
function pr({ body = '', login = 'a-person', type = 'User', head = 'docs/some-page', base = 'develop' } = {}) {
  return { number: 77, body, user: { login, type }, head: { ref: head }, base: { ref: base } };
}

/**
 * A lookup over a fixed set of existing items: { 'owner/repo#N': 'issue' | 'pull' }. Records every call so a
 * test can prove a lookup did or did not happen.
 */
function lookupOf(items) {
  const calls = [];
  const lookup = async (repo, number) => {
    calls.push(`${repo}#${number}`);
    const kind = items[`${repo}#${number}`];
    return kind ? { kind } : null;
  };
  lookup.calls = calls;
  return lookup;
}

// --- stripCode -------------------------------------------------------------------------------------------------

test('stripCode removes fenced code blocks, both backtick and tilde fences', () => {
  const text = 'before\n```\nFixes #1\n```\nmiddle\n~~~md\nFixes #2\n~~~\nafter';
  const stripped = stripCode(text);
  assert.ok(!stripped.includes('#1'));
  assert.ok(!stripped.includes('#2'));
  assert.ok(stripped.includes('before') && stripped.includes('middle') && stripped.includes('after'));
});

test('stripCode removes inline code spans, including double-backtick spans', () => {
  const stripped = stripCode('see `Fixes #3` and ``Fixes #4`` but Fixes #5');
  assert.ok(!stripped.includes('#3'));
  assert.ok(!stripped.includes('#4'));
  assert.ok(stripped.includes('Fixes #5'));
});

test('stripCode removes an unterminated fence to the end of the text, as Markdown does', () => {
  assert.ok(!stripCode('text\n```\nFixes #6\nno closing fence').includes('#6'));
});

// --- findLibraryRefs -------------------------------------------------------------------------------------------

test('findLibraryRefs finds the short form owner/repo#N', () => {
  assert.deepEqual(findLibraryRefs('Docs for whizbang-lib/whizbang#1458'), [1458]);
});

test('findLibraryRefs finds issue and pull request URLs, with and without the scheme', () => {
  const body = [
    'https://github.com/whizbang-lib/whizbang/issues/10',
    'https://github.com/whizbang-lib/whizbang/pull/11/files',
    'github.com/whizbang-lib/whizbang/pull/12',
    'http://github.com/whizbang-lib/whizbang/issues/13#issuecomment-1',
  ].join('\n');
  assert.deepEqual(findLibraryRefs(body), [10, 11, 12, 13]);
});

test('findLibraryRefs returns each number once, in ascending order', () => {
  assert.deepEqual(findLibraryRefs('whizbang-lib/whizbang#9 and https://github.com/whizbang-lib/whizbang/pull/9 and whizbang-lib/whizbang#2'), [2, 9]);
});

test('findLibraryRefs does not match this docs repository', () => {
  assert.deepEqual(findLibraryRefs('whizbang-lib/whizbang-lib.github.io#5'), []);
  assert.deepEqual(findLibraryRefs('https://github.com/whizbang-lib/whizbang-lib.github.io/pull/5'), []);
});

test('findLibraryRefs does not match other repositories whose names contain the library name', () => {
  for (const body of [
    'other-org/whizbang#5',
    'notwhizbang-lib/whizbang#5',
    'whizbang-lib/whizbang-samples#5',
    'whizbang-lib/whizbang.tools#5',
    'https://github.com/someone/whizbang-lib/whizbang/pull/5',
    'https://gitlab.com/whizbang-lib/whizbang/issues/5',
    'https://github.com/whizbang-lib/whizbangx/pull/5',
  ]) {
    assert.deepEqual(findLibraryRefs(body), [], body);
  }
});

test('findLibraryRefs ignores references inside code, which GitHub does not link', () => {
  assert.deepEqual(findLibraryRefs('`Docs for whizbang-lib/whizbang#1`\n```\nwhizbang-lib/whizbang#2\n```'), []);
});

test('findLibraryRefs does not take a number that runs into letters', () => {
  assert.deepEqual(findLibraryRefs('whizbang-lib/whizbang#12abc'), []);
});

test('findLibraryRefs handles an empty or missing body', () => {
  assert.deepEqual(findLibraryRefs(''), []);
  assert.deepEqual(findLibraryRefs(null), []);
  assert.deepEqual(findLibraryRefs(undefined), []);
});

// --- findClosingRefs -------------------------------------------------------------------------------------------

test('findClosingRefs accepts every closing keyword and tense, case-insensitively', () => {
  const words = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
  words.forEach((word, i) => {
    assert.deepEqual(findClosingRefs(`${word} #${i + 1}`), [i + 1], word);
    assert.deepEqual(findClosingRefs(`${word.toUpperCase()} #${i + 1}`), [i + 1], word.toUpperCase());
  });
});

test('findClosingRefs accepts a colon after the keyword and the full name of this repository', () => {
  assert.deepEqual(findClosingRefs('Fixes: #4'), [4]);
  assert.deepEqual(findClosingRefs(`Closes ${THIS_REPO}#8`), [8]);
});

test('findClosingRefs finds several keywords and returns each number once, ascending', () => {
  assert.deepEqual(findClosingRefs('Fixes #20\nResolves #3, closes #20'), [3, 20]);
});

test('findClosingRefs ignores a bare reference with no keyword', () => {
  assert.deepEqual(findClosingRefs('Refs #4 and see #5'), []);
});

test('findClosingRefs ignores keywords that are part of a longer word', () => {
  assert.deepEqual(findClosingRefs('prefixes #4, unfixed #5, enclosed #6'), []);
});

test('findClosingRefs ignores a keyword inside inline code or a fenced block', () => {
  assert.deepEqual(findClosingRefs('`Fixes #4`'), []);
  assert.deepEqual(findClosingRefs('```\nFixes #5\n```'), []);
});

test('findClosingRefs does not count a closing keyword aimed at another repository', () => {
  assert.deepEqual(findClosingRefs('Fixes whizbang-lib/whizbang#4'), []);
  assert.deepEqual(findClosingRefs('Fixes other-org/thing#4'), []);
});

// --- exemptionReason -------------------------------------------------------------------------------------------

test('a pull request authored by a bot is exempt', () => {
  assert.match(exemptionReason(pr({ login: 'github-actions[bot]', type: 'Bot', head: 'chore/sync-main-auto' })), /bot/i);
  assert.match(exemptionReason(pr({ login: 'whizbang-release-bot[bot]', type: 'Bot', head: 'test-status/39124705761' })), /bot/i);
});

test('the release pull request from a release branch into main is exempt, whoever opens it', () => {
  assert.match(exemptionReason(pr({ head: 'release/v1.1.140', base: 'main' })), /release/i);
});

test('a release branch into develop is not exempt, nor is any other branch into main', () => {
  assert.equal(exemptionReason(pr({ head: 'release/v1.1.140', base: 'develop' })), null);
  assert.equal(exemptionReason(pr({ head: 'hotfix/broken-link', base: 'main' })), null);
});

test('a person whose login ends in [bot] but whose account type is User is not exempt', () => {
  assert.equal(exemptionReason(pr({ login: 'sneaky[bot]', type: 'User' })), null);
});

// --- evaluate --------------------------------------------------------------------------------------------------

test('passes on a library reference that exists', async () => {
  const lookup = lookupOf({ [`${LIBRARY_REPO}#1458`]: 'pull' });
  const result = await evaluate(pr({ body: 'Docs for whizbang-lib/whizbang#1458' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.found, [`${LIBRARY_REPO}#1458`]);
});

test('passes on a library issue as well as a library pull request', async () => {
  const lookup = lookupOf({ [`${LIBRARY_REPO}#40`]: 'issue' });
  const result = await evaluate(pr({ body: 'https://github.com/whizbang-lib/whizbang/issues/40' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'pass');
});

test('passes on a closing keyword for an issue in this repository that exists', async () => {
  const lookup = lookupOf({ [`${THIS_REPO}#1231`]: 'issue' });
  const result = await evaluate(pr({ body: 'Fixes #1231' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.found, [`${THIS_REPO}#1231`]);
});

test('fails when the description names nothing, and says exactly what to add', async () => {
  const lookup = lookupOf({});
  const result = await evaluate(pr({ body: 'Rewrites the getting started page.' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'fail');
  assert.match(result.message, /Add `Docs for whizbang-lib\/whizbang#N` \(the library pull request or issue this documents\) to the description, then re-run this check/);
  assert.match(result.message, /library pull request find its docs/);
  assert.deepEqual(lookup.calls, [], 'nothing to look up, so no lookup');
});

test('fails on an empty description', async () => {
  const result = await evaluate(pr({ body: null }), { repo: THIS_REPO, lookup: lookupOf({}) });
  assert.equal(result.status, 'fail');
});

test('fails when the only reference does not exist, and names the missing reference', async () => {
  const lookup = lookupOf({});
  const result = await evaluate(pr({ body: 'Docs for whizbang-lib/whizbang#999999' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.missing, [`${LIBRARY_REPO}#999999`]);
  assert.match(result.message, /whizbang-lib\/whizbang#999999/);
  assert.match(result.message, /does not exist|not found/i);
});

test('a closing keyword aimed at a pull request in this repository does not count, since only issues close', async () => {
  const lookup = lookupOf({ [`${THIS_REPO}#1230`]: 'pull' });
  const result = await evaluate(pr({ body: 'Fixes #1230' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'fail');
});

test('passes when one reference is missing and another exists', async () => {
  const lookup = lookupOf({ [`${LIBRARY_REPO}#7`]: 'pull' });
  const result = await evaluate(pr({ body: 'Fixes #999999\nDocs for whizbang-lib/whizbang#7' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.found, [`${LIBRARY_REPO}#7`]);
});

test('a reference to this docs repository without a closing keyword does not count', async () => {
  const lookup = lookupOf({ [`${THIS_REPO}#5`]: 'issue' });
  const result = await evaluate(pr({ body: 'Related to whizbang-lib/whizbang-lib.github.io#5' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'fail');
});

test('references only inside code do not count', async () => {
  const lookup = lookupOf({ [`${LIBRARY_REPO}#1`]: 'pull', [`${THIS_REPO}#2`]: 'issue' });
  const result = await evaluate(pr({ body: '`Docs for whizbang-lib/whizbang#1`\n```\nFixes #2\n```' }), { repo: THIS_REPO, lookup });
  assert.equal(result.status, 'fail');
});

test('an exempt pull request passes as exempt without reading its description or looking anything up', async () => {
  const lookup = lookupOf({});
  const bot = await evaluate(pr({ login: 'github-actions[bot]', type: 'Bot', head: 'chore/sync-main-auto' }), { repo: THIS_REPO, lookup });
  const release = await evaluate(pr({ head: 'release/v1.1.140', base: 'main' }), { repo: THIS_REPO, lookup });
  assert.equal(bot.status, 'exempt');
  assert.equal(release.status, 'exempt');
  assert.deepEqual(lookup.calls, []);
});

test('a lookup that throws fails the check loudly rather than counting the reference either way', async () => {
  const lookup = async () => { throw new Error('GitHub API 500 for whizbang-lib/whizbang#1'); };
  await assert.rejects(evaluate(pr({ body: 'Docs for whizbang-lib/whizbang#1' }), { repo: THIS_REPO, lookup }), /500/);
});

// --- renderSummary ---------------------------------------------------------------------------------------------

test('renderSummary writes one line naming the outcome and the references', () => {
  assert.match(renderSummary({ status: 'pass', found: [`${LIBRARY_REPO}#7`] }), /^Gate · Linked change: passed.*whizbang-lib\/whizbang#7/);
  assert.match(renderSummary({ status: 'exempt', reason: 'authored by a bot' }), /^Gate · Linked change: exempt.*bot/);
  assert.match(renderSummary({ status: 'fail', message: 'Add it' }), /^Gate · Linked change: failed/);
});

// --- makeGitHubLookup ------------------------------------------------------------------------------------------

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = responses[url];
    if (!r) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  impl.calls = calls;
  return impl;
}

test('the GitHub lookup reads the issues endpoint with the token and tells an issue from a pull request', async () => {
  const fetchImpl = fakeFetch({
    'https://api.github.com/repos/whizbang-lib/whizbang/issues/1': { status: 200, body: { number: 1, pull_request: { url: 'x' } } },
    'https://api.github.com/repos/whizbang-lib/whizbang/issues/2': { status: 200, body: { number: 2 } },
  });
  const lookup = makeGitHubLookup({ token: 'secret', fetchImpl });
  assert.deepEqual(await lookup(LIBRARY_REPO, 1), { kind: 'pull' });
  assert.deepEqual(await lookup(LIBRARY_REPO, 2), { kind: 'issue' });
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer secret');
});

test('the GitHub lookup reports a 404 or 410 as not found', async () => {
  const fetchImpl = fakeFetch({ 'https://api.github.com/repos/whizbang-lib/whizbang/issues/4': { status: 410, body: {} } });
  const lookup = makeGitHubLookup({ token: 't', fetchImpl });
  assert.equal(await lookup(LIBRARY_REPO, 3), null);
  assert.equal(await lookup(LIBRARY_REPO, 4), null);
});

test('the GitHub lookup throws on any other failure, naming the reference', async () => {
  const fetchImpl = fakeFetch({ 'https://api.github.com/repos/whizbang-lib/whizbang/issues/5': { status: 500, body: {} } });
  const lookup = makeGitHubLookup({ token: 't', fetchImpl });
  await assert.rejects(lookup(LIBRARY_REPO, 5), /500.*whizbang-lib\/whizbang#5|whizbang-lib\/whizbang#5.*500/);
});
