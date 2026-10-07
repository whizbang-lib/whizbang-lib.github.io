#!/usr/bin/env node
// Every configuration key the docs tell a reader to set must be one the library reads.
//
// The library records the keys it reads in docs/configuration-keys.txt, and a library test fails
// whenever its binding changes without that file. This script closes the other half: it finds every
// key written in the docs and fails on any the manifest does not hold, so a documented key can never
// again be inert (a reader sets it, nothing reads it, nothing says so).
//
//   node src/scripts/validate-config-keys.mjs [--root src/assets/docs/v1.0.0]
//
// Keys are found where their form is unambiguous:
//   - environment variables: Whizbang__Transports__AzureServiceBus__AcceptorFloor
//   - colon paths in backticks: `Whizbang:Transports:AzureServiceBus:AcceptorFloor`
//   - JSON code blocks: { "Whizbang": { "Tracing": { "Verbosity": "Debug" } } }
// for the roots the library reads: Whizbang, ConnectionStrings and ConnectionPool.
//
// A key matches when it is a manifest key or a section of one. A segment written as a placeholder
// (<name>, &lt;name&gt;, {name}, *, or an array index) stands for any name, and a manifest '*' is a
// name the consumer chooses. Keys documented on purpose although the library does not read them
// (a consumer-bound section, a warning example) are listed with their reason in
// src/scripts/config-keys-allowlist.txt.
//
// The library repo is located via WHIZBANG_LIB_PATH or the ../whizbang sibling; CI checks it out.

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, resolve, relative } from 'path';

const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg !== -1 ? process.argv[rootArg + 1] : 'src/assets/docs/v1.0.0';
const LIB = process.env.WHIZBANG_LIB_PATH || resolve('..', 'whizbang');
const MANIFEST = join(LIB, 'docs', 'configuration-keys.txt');
const ALLOWLIST = 'src/scripts/config-keys-allowlist.txt';
const ROOTS = ['Whizbang', 'ConnectionStrings', 'ConnectionPool'];

if (!existsSync(MANIFEST)) {
  console.error(`✗ ${MANIFEST} not found. Point WHIZBANG_LIB_PATH at a whizbang checkout that has it.`);
  process.exit(1);
}

const lines = (path) =>
  readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const manifest = lines(MANIFEST).map((k) => k.toLowerCase().split(':'));
const allowlist = existsSync(ALLOWLIST)
  ? lines(ALLOWLIST).map((l) => l.split('#')[0].trim().toLowerCase()).filter(Boolean)
  : [];

const isPlaceholder = (seg) => /^(<[^>]+>|&lt;[^&]+&gt;|\{[^}]+\}|\*|\d+|\.\.\.|…)$/.test(seg);
const segMatch = (lib, doc) => lib === doc || lib === '*' || isPlaceholder(doc);

// The names of the keys themselves (the last segment of every manifest key), to tell a section
// apart from a key written one level too high.
const leafNames = new Set(manifest.map((lib) => lib.at(-1)));

/**
 * True when the key is a manifest key, or a section that contains one. A shorter key whose last
 * segment lands on a consumer-chosen name ('*') is a section only if that segment is not itself a
 * key's name: Whizbang:Postgres:CommandTimeoutSeconds is the per-database key with its database
 * left out, not a database named CommandTimeoutSeconds.
 */
function isRead(key) {
  const doc = key.toLowerCase().split(':');
  return manifest.some((lib) => {
    if (lib.length < doc.length || !doc.every((seg, i) => segMatch(lib[i], seg))) return false;
    if (lib.length === doc.length) return true;
    const last = doc.length - 1;
    return !(lib[last] === '*' && leafNames.has(doc[last]));
  });
}

const isAllowed = (key) => {
  const k = key.toLowerCase();
  return allowlist.some((a) => k === a || k.startsWith(a + ':'));
};

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

const rootPattern = ROOTS.join('|');
const envVar = new RegExp(`\\b(?:${rootPattern})__[A-Za-z0-9_<>{}*.-]*[A-Za-z0-9>}*]`, 'g');
const colonPath = new RegExp(`\`((?:${rootPattern})(?::[A-Za-z0-9_<>{}*.&;-]+)+)\``, 'g');

/** Flattens a parsed JSON value into colon paths for the library's roots. */
function flatten(value, prefix, out) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}:${k}` : k, out);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}:${i}`, out));
  } else if (prefix) {
    out.push(prefix);
  }
  return out;
}

/** Parses a JSON code block, tolerating // comments and trailing commas; null when it is not JSON. */
function parseJson(body) {
  const cleaned = body
    .split('\n')
    .map((l) => l.replace(/^(\s*)\/\/.*$/, '$1'))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const violations = [];
const check = (key, file, line) => {
  // A trailing '*' written into prose ('Whizbang:Database*') names the section and everything in it.
  const clean = key.replace(/[.:]+$/, '').replace(/\*$/, '').replace(/:$/, '');
  if (!ROOTS.includes(clean.split(':')[0]) || clean.split(':').length < 2) return;
  if (isRead(clean) || isAllowed(clean)) return;
  violations.push({ key: clean, where: `${relative('.', file)}:${line}` });
};

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8').split('\n');
  let fence = null;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    const opening = raw.match(/^\s*```\s*([A-Za-z]*)/);
    if (opening && !fence) {
      fence = { lang: opening[1].toLowerCase(), start: i + 1, body: [] };
      continue;
    }
    if (fence && /^\s*```\s*$/.test(raw)) {
      if (fence.lang === 'json' || fence.lang === 'jsonc') {
        const parsed = parseJson(fence.body.join('\n'));
        if (parsed && typeof parsed === 'object') {
          for (const root of ROOTS) {
            if (parsed[root] !== undefined) {
              for (const key of flatten(parsed[root], root, [])) {
                const leaf = key.split(':').at(-1);
                const at = fence.body.findIndex((l) => l.includes(`"${leaf}"`));
                check(key, file, fence.start + 1 + Math.max(at, 0));
              }
            }
          }
        }
      }
      fence = null;
      continue;
    }
    if (fence) fence.body.push(raw);
    for (const m of raw.matchAll(envVar)) check(m[0].replaceAll('__', ':'), file, i + 1);
    for (const m of raw.matchAll(colonPath)) check(m[1], file, i + 1);
  }
}

const unique = new Map();
for (const v of violations) {
  if (!unique.has(v.key)) unique.set(v.key, []);
  unique.get(v.key).push(v.where);
}

if (unique.size === 0) {
  console.log(`✓ Every documented configuration key is one the library reads (${manifest.length} keys in the manifest).`);
  process.exit(0);
}

console.error(`✗ ${unique.size} documented configuration key(s) the library does not read:`);
for (const [key, where] of [...unique].sort(([a], [b]) => a.localeCompare(b))) {
  console.error(`  ${key}\n      ${where.slice(0, 4).join('\n      ')}${where.length > 4 ? `\n      (+${where.length - 4} more)` : ''}`);
}
console.error('\nFix the key, or make the library read it (and regenerate its docs/configuration-keys.txt).');
console.error(`A key documented on purpose although the library does not read it goes in ${ALLOWLIST} with its reason.`);
process.exit(1);
