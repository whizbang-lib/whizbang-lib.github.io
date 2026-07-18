#!/usr/bin/env node
// Prints the version the MCP docs server should publish as — it tracks the
// Whizbang library release it documents.
//
// Base version source, in order:
//   1. The SHARED source: the library version carried by the living-docs
//      test-status pipeline (src/assets/data/test-status/index.json →
//      run.libraryVersion). The library CI stamps its GitVersion there, so this
//      is the same number the site already shows — no second lookup to drift.
//   2. Fallback: the largest published version of the library on nuget.org (by
//      semver INCLUDING prereleases — NOT nuget's "latest stable", since the
//      library is all-prerelease and a stray stable like 0.9.4 must not win).
// The shared source is authoritative once the test-status pipeline is active
// (needs DOCS_REPO_PUSH_TOKEN); until then nuget keeps this working.

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = 'softwareextravaganza.whizbang.core';
const URL = `https://api.nuget.org/v3-flatcontainer/${PKG}/index.json`;
const TEST_STATUS = path.resolve(__dirname, '../../src/assets/data/test-status/index.json');
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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

// 1. Shared source: the library version stamped by the test-status pipeline.
function baseFromTestStatus() {
  try {
    const v = JSON.parse(readFileSync(TEST_STATUS, 'utf8'))?.run?.libraryVersion;
    return typeof v === 'string' && SEMVER_RE.test(v) ? v : null;
  } catch {
    return null; // file absent (pipeline not active yet) — fall back to nuget
  }
}

// 2. Fallback: largest published library version on nuget.
async function baseFromNuget() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`nuget.org query for ${PKG} failed: ${res.status}`);
  const { versions } = await res.json();
  if (!Array.isArray(versions) || versions.length === 0) throw new Error('no versions from nuget.org');
  return [...versions].sort(cmp).at(-1);
}

let base = baseFromTestStatus();
if (base) {
  console.error(`base version from test-status pipeline: ${base}`);
} else {
  base = await baseFromNuget();
  console.error(`base version from nuget.org fallback: ${base}`);
}

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
