#!/usr/bin/env node
// Prints the version the MCP docs server should publish as: the LARGEST
// published version of the Whizbang library on nuget.org (by semver, including
// prereleases). The docs server tracks the library release it documents.
//
// Largest-by-semver — NOT nuget's "latest stable" — on purpose: the library is
// all-prerelease, and a stray/bad stable (e.g. 0.9.4) must never outrank the
// real newest alpha (e.g. 0.860.8-alpha.9).
//
// Interim source: nuget.org. Follow-up: read the library version carried by the
// living-docs test-status pipeline instead (test-status/index.json.libraryVersion).

const PKG = 'softwareextravaganza.whizbang.core';
const URL = `https://api.nuget.org/v3-flatcontainer/${PKG}/index.json`;

function semverKey(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
  if (!m) return [0, 0, 0, 1, []];
  const base = [Number(m[1]), Number(m[2]), Number(m[3])];
  // A release (no prerelease) outranks any prerelease of the same base.
  if (!m[4]) return [...base, 1, []];
  const pre = m[4].split('.').map((p) => (/^\d+$/.test(p) ? [0, Number(p)] : [1, p]));
  return [...base, 0, pre];
}

function cmp(a, b) {
  const ka = semverKey(a), kb = semverKey(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  const pa = ka[4], pb = kb[4];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1; // shorter prerelease list = lower precedence
    if (y === undefined) return 1;
    if (x[0] !== y[0]) return x[0] - y[0]; // numeric identifiers rank below alnum
    if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  }
  return 0;
}

const res = await fetch(URL);
if (!res.ok) {
  console.error(`Failed to query nuget.org for ${PKG}: ${res.status}`);
  process.exit(1);
}
const { versions } = await res.json();
if (!Array.isArray(versions) || versions.length === 0) {
  console.error('No versions returned from nuget.org');
  process.exit(1);
}
const base = [...versions].sort(cmp).at(-1);

// The npm version tracks the library version. But the docs server may need to
// re-release for the SAME library version (a docs/server fix with no library
// bump). npm can't republish an existing version, so append a `.N` revision to
// the prerelease identifier — semver-valid and higher-precedence than the base
// (a larger prerelease field set outranks a smaller one when the prefix is
// equal). e.g. base 0.860.8-alpha.9 already on npm -> 0.860.8-alpha.9.1.
const NPM = '@whizbang/docs-mcp-server';
async function isPublished(v) {
  const r = await fetch(`https://registry.npmjs.org/${NPM}/${v}`);
  return r.ok;
}
let out = base;
if (await isPublished(base)) {
  const hasPrerelease = base.includes('-');
  for (let n = 1; ; n++) {
    const candidate = hasPrerelease ? `${base}.${n}` : `${base}-mcp.${n}`;
    if (!(await isPublished(candidate))) { out = candidate; break; }
  }
}
process.stdout.write(out);
