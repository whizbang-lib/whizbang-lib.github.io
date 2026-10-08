#!/usr/bin/env node
// Builds the security-advisories page from the OSV database (api.osv.dev).
//
// Usage:
//   node src/scripts/build-security-advisories.mjs [--data <json>] [--page <md>]
//
// What it does:
//   1. Discovers every published Whizbang package id from NuGet's public search
//      (ids starting "SoftwareExtravaganza.Whizbang"), so a consumer that references
//      only a transport or data package still matches.
//   2. Asks OSV which advisories affect any of them, then reads each advisory.
//   3. Writes the data (default src/assets/data/security-advisories.json) and renders
//      the page (default src/assets/docs/v1.0.0/fundamentals/security/security-advisories.md).
//
// Three properties are load-bearing; do not weaken them:
//   - UNAUTHENTICATED. GitHub's advisory API returns DRAFTS to an authenticated caller, so a
//     token here could publish an embargoed vulnerability. OSV holds published records only,
//     and every request below is anonymous.
//   - NEVER A HARD FAILURE, NEVER AN EMPTY PAGE BY ACCIDENT. A failed fetch keeps the last
//     committed data, warns, and still renders the page from it. "No advisories" is shown only
//     when a fetch succeeded and found none.
//   - DATED AND LINKED. The page says when the data was fetched and links the live list, so a
//     snapshot can be behind GitHub's advisories but never contradict them.
//
// Prints "changed=true|false" (advisories or package ids differ from the committed data, ignoring
// the fetch date) so a scheduled job can open a PR only when something real changed.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { pathToFileURL } from 'url';

export const PACKAGE_PREFIX = 'SoftwareExtravaganza.Whizbang';
export const LIVE_LIST_URL = 'https://github.com/whizbang-lib/whizbang/security/advisories';
const NUGET_SEARCH = 'https://azuresearch-usnc.nuget.org/query';
const OSV = 'https://api.osv.dev/v1';
const TIMEOUT_MS = 20000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Every published package id with the Whizbang prefix, sorted. Throws if none are found. */
export async function discoverPackages(fetchImpl = fetch) {
  const url = `${NUGET_SEARCH}?q=${encodeURIComponent(PACKAGE_PREFIX)}&prerelease=true&take=1000`;
  const body = await getJson(fetchImpl, url);
  const ids = [...new Set((body.data ?? []).map((p) => p.id).filter((id) => id.startsWith(`${PACKAGE_PREFIX}.`)))].sort();
  if (ids.length === 0) throw new Error('NuGet search returned no Whizbang packages');
  return ids;
}

/** The ids of every OSV record affecting any of the packages. Follows per-query pagination. */
export async function queryVulnIds(packageIds, fetchImpl = fetch) {
  const found = new Set();
  let pending = packageIds.map((name) => ({ package: { name, ecosystem: 'NuGet' } }));
  while (pending.length > 0) {
    const body = await getJson(fetchImpl, `${OSV}/querybatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: pending }),
    });
    const results = body.results ?? [];
    if (results.length !== pending.length) throw new Error('OSV querybatch returned a different number of results than queries');
    const next = [];
    results.forEach((r, i) => {
      for (const v of r.vulns ?? []) found.add(v.id);
      if (r.next_page_token) next.push({ ...pending[i], page_token: r.next_page_token });
    });
    pending = next;
  }
  return [...found].sort();
}

/** One OSV record reduced to what the page shows, keeping only Whizbang packages. */
export function normalize(vuln) {
  const affected = (vuln.affected ?? [])
    .filter((a) => a.package?.ecosystem === 'NuGet' && a.package?.name?.startsWith(`${PACKAGE_PREFIX}.`))
    .map((a) => {
      const events = (a.ranges ?? []).filter((r) => r.type === 'ECOSYSTEM').flatMap((r) => r.events ?? []);
      const fixed = events.map((e) => e.fixed).filter(Boolean);
      const introduced = events.map((e) => e.introduced).filter((v) => v !== undefined);
      return { package: a.package.name, introduced: introduced[0] ?? null, fixed: fixed[0] ?? null };
    })
    .sort((x, y) => x.package.localeCompare(y.package));
  const cve = (vuln.aliases ?? []).filter((a) => a.startsWith('CVE-')).sort();
  const cvss = (vuln.severity ?? []).find((s) => s.type?.startsWith('CVSS'))?.score ?? null;
  return {
    id: vuln.id,
    cve,
    summary: vuln.summary ?? '',
    severity: vuln.database_specific?.severity ?? null,
    cvss,
    cwe: vuln.database_specific?.cwe_ids ?? [],
    published: vuln.published ?? null,
    withdrawn: vuln.withdrawn ?? null,
    url: vuln.id.startsWith('GHSA-') ? `${LIVE_LIST_URL}/${vuln.id}` : `https://osv.dev/vulnerability/${vuln.id}`,
    affected,
  };
}

/** Fetches everything. Throws on any failure, so the caller can keep the committed data. */
export async function fetchAdvisories(fetchImpl = fetch) {
  const packages = await discoverPackages(fetchImpl);
  const ids = await queryVulnIds(packages, fetchImpl);
  const advisories = [];
  for (const id of ids) {
    const vuln = await getJson(fetchImpl, `${OSV}/vulns/${encodeURIComponent(id)}`);
    const n = normalize(vuln);
    if (n.affected.length > 0) advisories.push(n);
  }
  advisories.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '') || a.id.localeCompare(b.id));
  return { packages, advisories };
}

/** True when the advisories or package ids differ; the fetch date alone is not a change. */
export function hasChanged(previous, next) {
  const strip = (d) => JSON.stringify({ packages: d?.packages ?? [], advisories: d?.advisories ?? [] });
  return strip(previous) !== strip(next);
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function rangeText(a) {
  if (a.fixed) return `< ${a.fixed} (fixed in ${a.fixed})`;
  return a.introduced && a.introduced !== '0' ? `>= ${a.introduced} (no fix)` : 'all versions (no fix)';
}

/** The page, rendered from data. Deterministic for a given input. */
export function renderPage(data) {
  const asOf = (data.fetchedAt ?? '').slice(0, 10) || 'an unknown date';
  const live = data.advisories.filter((a) => !a.withdrawn);
  const withdrawn = data.advisories.filter((a) => a.withdrawn);
  const out = [];
  out.push('---');
  out.push('title: Security Advisories');
  out.push('pageType: reference');
  out.push('audience: consumer');
  out.push('status: current');
  out.push('version: 1.0.0');
  out.push('category: Security');
  out.push('order: 90');
  out.push('description: >-');
  out.push('  Published security advisories for the Whizbang packages, generated from the OSV');
  out.push('  database, with the affected and fixed version of each package.');
  out.push("tags: 'security, advisories, cve, ghsa, osv, vulnerabilities'");
  out.push('codeReferences:');
  out.push('  - SECURITY.md');
  out.push('---');
  out.push('');
  out.push('<!-- GENERATED by src/scripts/build-security-advisories.mjs from api.osv.dev. Do not edit by hand. -->');
  out.push('');
  out.push('# Security Advisories');
  out.push('');
  out.push(`This page lists the published advisories that affect a Whizbang package, as of **${asOf}**. `
    + `It is generated from the [OSV database](https://osv.dev), the same records Dependabot and other `
    + `scanners read. The authoritative, always-current list is the repository's `
    + `[security advisories](${LIVE_LIST_URL}).`);
  out.push('');
  if (live.length === 0) {
    out.push(`No published advisory affects any of the ${data.packages.length} Whizbang packages.`);
    out.push('');
  } else {
    for (const a of live) {
      const ids = [a.id, ...a.cve].join(' / ');
      out.push(`## ${esc(a.summary || a.id)}`);
      out.push('');
      out.push(`- **Advisory**: [${ids}](${a.url})`);
      if (a.severity) out.push(`- **Severity**: ${esc(a.severity.toLowerCase())}${a.cvss ? ` (\`${esc(a.cvss)}\`)` : ''}`);
      if (a.cwe.length > 0) out.push(`- **Weakness**: ${a.cwe.join(', ')}`);
      if (a.published) out.push(`- **Published**: ${a.published.slice(0, 10)}`);
      out.push('');
      out.push('| Package | Affected | Upgrade to |');
      out.push('|---|---|---|');
      for (const p of a.affected) out.push(`| \`${p.package}\` | ${esc(rangeText(p))} | ${p.fixed ? `${p.fixed} or later` : 'no fixed version'} |`);
      out.push('');
    }
  }
  if (withdrawn.length > 0) {
    out.push('## Withdrawn');
    out.push('');
    for (const a of withdrawn) out.push(`- [${a.id}](${a.url}), withdrawn ${a.withdrawn.slice(0, 10)}: ${esc(a.summary)}`);
    out.push('');
  }
  out.push('## How you are warned');
  out.push('');
  out.push('You do not need to check this page. When an advisory is published, the .NET SDK warns at restore: '
    + '[NuGet Audit](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) compares every package '
    + 'version a project resolves with the GitHub Advisory Database and reports NU1901 to NU1904 (low to critical). '
    + 'Dependabot and other scanners read the same records.');
  out.push('');
  out.push('To make sure an affected Whizbang package cannot go unnoticed:');
  out.push('');
  out.push('- Keep NuGet Audit on (the default) and audit transitive packages too, with `<NuGetAuditMode>all</NuGetAuditMode>` '
    + 'in `Directory.Build.props`. A Whizbang package is often referenced through another one.');
  out.push('- To fail the build rather than warn, add `NU1903;NU1904` (high and critical) to `<WarningsAsErrors>`.');
  out.push('- Never add a `<NuGetAuditSuppress>` for a Whizbang advisory as a way to stay on an affected version; upgrade instead.');
  out.push('');
  out.push("## Reporting a vulnerability");
  out.push('');
  out.push('Report a vulnerability privately, as described in the repository\'s '
    + '[security policy](https://github.com/whizbang-lib/whizbang/blob/main/SECURITY.md). Do not open a public issue.');
  out.push('');
  return out.join('\n');
}

function readJson(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export async function main({ dataPath, pagePath, fetchImpl = fetch, now = () => new Date(), log = console } = {}) {
  const previous = readJson(dataPath);
  let data;
  let changed = false;
  try {
    const fetched = await fetchAdvisories(fetchImpl);
    data = { fetchedAt: now().toISOString(), source: 'api.osv.dev', ...fetched };
    changed = hasChanged(previous, data);
    write(dataPath, `${JSON.stringify(data, null, 2)}\n`);
    log.log(`security-advisories: ${data.advisories.length} advisories across ${data.packages.length} packages (changed=${changed})`);
  } catch (err) {
    if (!previous) {
      // No committed data to fall back on: render the page with an explicit "unavailable" state
      // rather than "no advisories", which would claim something nobody checked.
      log.warn(`::warning::security-advisories: fetch failed and no committed data exists (${err.message})`);
      write(pagePath, renderUnavailable());
      return { changed: false, ok: false };
    }
    log.warn(`::warning::security-advisories: fetch failed, keeping the committed data from ${previous.fetchedAt} (${err.message})`);
    data = previous;
  }
  write(pagePath, renderPage(data));
  return { changed, ok: data !== previous };
}

export function renderUnavailable() {
  return renderPage({ fetchedAt: null, packages: [], advisories: [] })
    .replace(/No published advisory affects any of the 0 Whizbang packages\./,
      `The advisory data could not be fetched for this build. See the [security advisories](${LIVE_LIST_URL}) for the current list.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await main({
    dataPath: arg('data', 'src/assets/data/security-advisories.json'),
    pagePath: arg('page', 'src/assets/docs/v1.0.0/fundamentals/security/security-advisories.md'),
  });
  console.log(`changed=${result.changed}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`, { flag: 'a' });
}
