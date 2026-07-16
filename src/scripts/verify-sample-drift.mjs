#!/usr/bin/env node
// SpecFlow-style living-docs check: code samples that declare a source test
// via code-block metadata {testFile: "...", testMethod: "..."} must match that
// test's actual body — the doc snippet IS the test, modulo whitespace.
//
// A tagged sample passes when its normalized lines appear as a contiguous
// subsequence of the referenced test method's normalized body. Drift (test
// changed, doc didn't) fails the check.
//
//   node src/scripts/verify-sample-drift.mjs [--strict] [--root src/assets/docs/v1.0.0]
//
// Warning-only by default (exit 0); --strict exits 1 on drift. The library
// repo is located via WHIZBANG_LIB_PATH or the ../whizbang sibling.

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const STRICT = process.argv.includes('--strict');
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg !== -1 ? process.argv[rootArg + 1] : 'src/assets/docs/v1.0.0';
const LIB = process.env.WHIZBANG_LIB_PATH || resolve('..', 'whizbang');

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

const normalize = (s) =>
  s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !l.startsWith('//'));

/** Extracts the body of a method from C# source by brace matching. */
function extractMethodBody(source, methodName) {
  const sigIdx = source.search(new RegExp(`\\b${methodName}\\s*\\(`));
  if (sigIdx === -1) return null;
  const braceStart = source.indexOf('{', sigIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  return null;
}

/** True when `needle` lines appear as a contiguous subsequence of `hay`. */
function isContiguousSubsequence(needle, hay) {
  if (needle.length === 0) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const failures = [];
let tagged = 0;

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  // Fenced blocks with {...} metadata containing testFile/testMethod
  const blockRe = /^```[a-z#+]+\{([\s\S]*?)\}\s*\n([\s\S]*?)^```\s*$/gim;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const meta = m[1];
    const code = m[2];
    const testFile = (meta.match(/testFile:\s*"([^"]+)"/) || [])[1];
    const testMethod = (meta.match(/testMethod:\s*"([^"]+)"/) || [])[1];
    if (!testFile || !testMethod) continue;
    tagged++;

    const libFile = join(LIB, testFile);
    if (!existsSync(libFile)) {
      failures.push(`${file}: testFile not found in library: ${testFile}`);
      continue;
    }
    const source = readFileSync(libFile, 'utf8');
    const body = extractMethodBody(source, testMethod);
    if (body === null) {
      failures.push(`${file}: method '${testMethod}' not found in ${testFile}`);
      continue;
    }
    if (!isContiguousSubsequence(normalize(code), normalize(body))) {
      failures.push(
        `${file}: sample drifted from ${testFile}:${testMethod} — snippet no longer matches the test body`
      );
    }
  }
}

if (failures.length > 0) {
  console.log(`${STRICT ? '✗' : '⚠'} Sample drift: ${failures.length} issue(s) across ${tagged} tagged samples:\n`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(STRICT ? 1 : 0);
}
console.log(`✓ Sample drift check passed (${tagged} tagged samples verified against library tests).`);
