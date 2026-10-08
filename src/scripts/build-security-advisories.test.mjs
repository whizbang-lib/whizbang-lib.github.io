// Tests for build-security-advisories.mjs. Run: pnpm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main, normalize, hasChanged, renderPage, queryVulnIds, LIVE_LIST_URL } from './build-security-advisories.mjs';

const silent = { log() {}, warn() {} };

const OSV_RECORD = {
  id: 'GHSA-aaaa-bbbb-cccc',
  summary: 'A lens exposes fields its scope hides',
  aliases: ['CVE-2026-0001'],
  published: '2026-10-09T00:00:00Z',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N' }],
  database_specific: { severity: 'MODERATE', cwe_ids: ['CWE-200'] },
  affected: [
    { package: { ecosystem: 'NuGet', name: 'SoftwareExtravaganza.Whizbang.Transports.HotChocolate' },
      ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '0.2614.0' }] }] },
    { package: { ecosystem: 'NuGet', name: 'Some.Other.Package' },
      ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '9.9.9' }] }] },
  ],
};

/** A fake fetch that records every request and answers from a route table. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, respond] of routes) {
      if (String(url).includes(match)) {
        const body = typeof respond === 'function' ? respond(String(url), init) : respond;
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { impl, calls };
}

const HAPPY = [
  ['azuresearch', { data: [{ id: 'SoftwareExtravaganza.Whizbang.Core' }, { id: 'SoftwareExtravaganza.Whizbang.Transports.HotChocolate' }, { id: 'Unrelated.Package' }] }],
  ['querybatch', (_u, init) => ({ results: JSON.parse(init.body).queries.map((q) => (q.package.name.endsWith('HotChocolate') ? { vulns: [{ id: OSV_RECORD.id }] } : {})) })],
  ['/vulns/', OSV_RECORD],
];

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'sec-adv-'));
  return { dataPath: join(dir, 'data.json'), pagePath: join(dir, 'page.md') };
}

test('every request is unauthenticated, so a draft advisory can never be fetched', async () => {
  const { impl, calls } = fakeFetch(HAPPY);
  await main({ ...tempPaths(), fetchImpl: impl, log: silent });
  assert.ok(calls.length >= 3);
  for (const c of calls) {
    const headers = Object.fromEntries(Object.entries(c.init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(headers.authorization, undefined, `${c.url} sent an Authorization header`);
    assert.ok(!/api\.github\.com/.test(c.url), `${c.url} queried GitHub's API, which serves drafts to authenticated callers`);
  }
});

test('queries every discovered Whizbang package id, and only those', async () => {
  const { impl, calls } = fakeFetch(HAPPY);
  await main({ ...tempPaths(), fetchImpl: impl, log: silent });
  const batch = calls.find((c) => c.url.includes('querybatch'));
  const names = JSON.parse(batch.init.body).queries.map((q) => q.package.name);
  assert.deepEqual(names, ['SoftwareExtravaganza.Whizbang.Core', 'SoftwareExtravaganza.Whizbang.Transports.HotChocolate']);
});

test('a successful fetch writes the data and renders the advisory with its upgrade target', async () => {
  const paths = tempPaths();
  const { impl } = fakeFetch(HAPPY);
  const result = await main({ ...paths, fetchImpl: impl, now: () => new Date('2026-10-10T12:00:00Z'), log: silent });
  assert.equal(result.changed, true);
  const page = readFileSync(paths.pagePath, 'utf8');
  assert.match(page, /as of \*\*2026-10-10\*\*/);
  assert.match(page, /GHSA-aaaa-bbbb-cccc \/ CVE-2026-0001/);
  assert.match(page, /\| `SoftwareExtravaganza\.Whizbang\.Transports\.HotChocolate` \| < 0\.2614\.0 \(fixed in 0\.2614\.0\) \| 0\.2614\.0 or later \|/);
  assert.ok(!page.includes('Some.Other.Package'), 'a non-Whizbang package in the same record must not be listed');
  assert.ok(page.includes(LIVE_LIST_URL), 'the page links the live list');
});

test('a failed fetch keeps the committed data and still renders it, never an empty page', async () => {
  const paths = tempPaths();
  const committed = { fetchedAt: '2026-10-01T00:00:00Z', source: 'api.osv.dev', packages: ['SoftwareExtravaganza.Whizbang.Transports.HotChocolate'], advisories: [normalize(OSV_RECORD)] };
  writeFileSync(paths.dataPath, JSON.stringify(committed));
  const { impl } = fakeFetch([['azuresearch', new Error('network down')]]);
  const result = await main({ ...paths, fetchImpl: impl, log: silent });
  assert.deepEqual(JSON.parse(readFileSync(paths.dataPath, 'utf8')), committed, 'committed data must be left untouched');
  assert.equal(result.changed, false);
  const page = readFileSync(paths.pagePath, 'utf8');
  assert.match(page, /as of \*\*2026-10-01\*\*/);
  assert.match(page, /GHSA-aaaa-bbbb-cccc/);
});

test('a failed fetch with no committed data says the data is unavailable, not that there are no advisories', async () => {
  const paths = tempPaths();
  const { impl } = fakeFetch([['azuresearch', new Error('network down')]]);
  await main({ ...paths, fetchImpl: impl, log: silent });
  assert.equal(existsSync(paths.dataPath), false);
  const page = readFileSync(paths.pagePath, 'utf8');
  assert.match(page, /could not be fetched/);
  assert.ok(!/No published advisory affects/.test(page));
});

test('an OSV error mid-run is a failure, not a partial list', async () => {
  const paths = tempPaths();
  const committed = { fetchedAt: '2026-10-01T00:00:00Z', packages: ['SoftwareExtravaganza.Whizbang.Core'], advisories: [normalize(OSV_RECORD)] };
  writeFileSync(paths.dataPath, JSON.stringify(committed));
  const routes = HAPPY.filter(([m]) => m !== '/vulns/');
  const { impl } = fakeFetch(routes); // the record lookup 404s
  await main({ ...paths, fetchImpl: impl, log: silent });
  assert.deepEqual(JSON.parse(readFileSync(paths.dataPath, 'utf8')), committed);
});

test('no advisories after a successful fetch is stated with the package count', () => {
  const page = renderPage({ fetchedAt: '2026-10-10T00:00:00Z', packages: ['a', 'b', 'c'], advisories: [] });
  assert.match(page, /No published advisory affects any of the 3 Whizbang packages\./);
});

test('the fetch date alone is not a change; an advisory or package id is', () => {
  const base = { fetchedAt: '2026-10-01T00:00:00Z', packages: ['p'], advisories: [] };
  assert.equal(hasChanged(base, { ...base, fetchedAt: '2026-10-02T00:00:00Z' }), false);
  assert.equal(hasChanged(base, { ...base, packages: ['p', 'q'] }), true);
  assert.equal(hasChanged(base, { ...base, advisories: [normalize(OSV_RECORD)] }), true);
  assert.equal(hasChanged(null, base), true);
});

test('OSV per-query pagination is followed', async () => {
  let page = 0;
  const { impl } = fakeFetch([['querybatch', (_u, init) => {
    const q = JSON.parse(init.body).queries;
    page++;
    return page === 1
      ? { results: q.map(() => ({ vulns: [{ id: 'GHSA-1' }], next_page_token: 'tok' })) }
      : { results: q.map(() => ({ vulns: [{ id: 'GHSA-2' }] })) };
  }]]);
  assert.deepEqual(await queryVulnIds(['SoftwareExtravaganza.Whizbang.Core'], impl), ['GHSA-1', 'GHSA-2']);
});

test('the rendered page satisfies the docs front-matter gate', () => {
  const page = renderPage({ fetchedAt: '2026-10-10T00:00:00Z', packages: ['a'], advisories: [normalize(OSV_RECORD)] });
  const fm = page.slice(4, page.indexOf('\n---', 4));
  for (const key of ['title', 'pageType', 'description', 'order', 'tags', 'codeReferences']) {
    assert.match(fm, new RegExp(`^${key}:`, 'm'), `front matter is missing ${key}`);
  }
  assert.ok(!/^```/m.test(page), 'no fenced code blocks, so no code-block metadata is owed');
});

test('the page tells consumers how NuGet Audit warns them, including transitive packages', () => {
  const page = renderPage({ fetchedAt: '2026-10-10T00:00:00Z', packages: ['a'], advisories: [] });
  assert.match(page, /## How you are warned/);
  assert.match(page, /NuGet Audit/);
  assert.match(page, /<NuGetAuditMode>all<\/NuGetAuditMode>/);
  assert.match(page, /NU1903;NU1904/);
});
