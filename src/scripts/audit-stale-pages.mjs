#!/usr/bin/env node

/**
 * Stale Page Detector
 *
 * Compares `lastMaintainedCommit` frontmatter against the library's current HEAD.
 * Reports pages that need review because their referenced source files have changed.
 *
 * Usage: node src/scripts/audit-stale-pages.mjs [--all] [--set-current]
 *   --all           Show all pages, not just stale ones
 *   --set-current   Set lastMaintainedCommit to current HEAD for all pages (after verification)
 *
 * Requires: code-docs-map.json (run generate-code-docs-map.mjs first)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DOCS_ROOT = 'src/assets/docs/v1.0.0';
const CODE_DOCS_MAP = 'src/assets/code-docs-map.json';
const LIBRARY_PATH = path.resolve('..', 'whizbang');

const showAll = process.argv.includes('--all');
const setCurrent = process.argv.includes('--set-current');

function findMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith('.md') && entry.name !== '_folder.md' && entry.name !== 'README.md') files.push(full);
  }
  return files;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return null;
  return content.substring(3, endIdx);
}

function getLastMaintainedCommit(fmText) {
  const match = fmText.match(/lastMaintainedCommit:\s*['"]?([a-f0-9]+)['"]?/);
  return match ? match[1] : null;
}

function getCodeReferences(fmText) {
  const refs = [];
  const lines = fmText.split('\n');
  let inCodeRefs = false;
  for (const line of lines) {
    if (line.match(/^codeReferences:/)) { inCodeRefs = true; continue; }
    if (inCodeRefs && line.match(/^\s+-\s+(.+)/)) {
      refs.push(line.match(/^\s+-\s+(.+)/)[1].trim().replace(/^['">-]+\s*/, ''));
    } else if (inCodeRefs && !line.match(/^\s/)) {
      inCodeRefs = false;
    }
  }
  return refs;
}

function getChangedFilesSince(commit, files) {
  if (!commit || files.length === 0) return [];
  try {
    const fileArgs = files.map(f => `"${f}"`).join(' ');
    const output = execSync(
      `git diff --name-only ${commit}..HEAD -- ${fileArgs}`,
      { cwd: LIBRARY_PATH, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    ).trim();
    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}

function getCurrentHead() {
  return execSync('git rev-parse --short HEAD', { cwd: LIBRARY_PATH, encoding: 'utf-8' }).trim();
}

function setLastMaintainedCommit(filePath, commit) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm) return;

  if (fm.includes('lastMaintainedCommit:')) {
    content = content.replace(/lastMaintainedCommit:\s*['"]?[a-f0-9]*['"]?/, `lastMaintainedCommit: '${commit}'`);
  } else {
    // Add before closing ---
    const endIdx = content.indexOf('---', 3);
    content = content.substring(0, endIdx) + `lastMaintainedCommit: '${commit}'\n` + content.substring(endIdx);
  }
  fs.writeFileSync(filePath, content);
}

// Main
const currentHead = getCurrentHead();
console.log(`Library HEAD: ${currentHead}\n`);

const mdFiles = findMarkdownFiles(DOCS_ROOT);
const stale = [];
const current = [];
const noCommit = [];

for (const file of mdFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm) continue;

  const lastCommit = getLastMaintainedCommit(fm);
  const codeRefs = getCodeReferences(fm);
  const rel = path.relative('.', file);

  if (!lastCommit) {
    noCommit.push({ file: rel, codeRefs: codeRefs.length });
    continue;
  }

  if (codeRefs.length === 0) {
    current.push({ file: rel, commit: lastCommit, reason: 'no codeReferences' });
    continue;
  }

  const changed = getChangedFilesSince(lastCommit, codeRefs);
  if (changed.length > 0) {
    stale.push({ file: rel, lastCommit, changedFiles: changed });
  } else {
    current.push({ file: rel, commit: lastCommit, reason: 'up to date' });
  }
}

// Set current if requested
if (setCurrent) {
  console.log(`Setting lastMaintainedCommit to ${currentHead} on all pages...\n`);
  for (const file of mdFiles) {
    setLastMaintainedCommit(file, currentHead);
  }
  console.log(`Updated ${mdFiles.length} pages.\n`);
}

// Report
if (stale.length > 0) {
  console.log(`⚠️  STALE PAGES (${stale.length}):\n`);
  for (const s of stale) {
    console.log(`  ${s.file}`);
    console.log(`    Last maintained: ${s.lastCommit}`);
    console.log(`    Changed files: ${s.changedFiles.join(', ')}`);
  }
}

if (noCommit.length > 0) {
  console.log(`\n📋 NO lastMaintainedCommit (${noCommit.length} pages):`);
  if (showAll) {
    for (const n of noCommit) console.log(`  ${n.file} (${n.codeRefs} codeRefs)`);
  } else {
    console.log(`  Use --all to list them`);
  }
}

if (showAll && current.length > 0) {
  console.log(`\n✅ CURRENT (${current.length}):`);
  for (const c of current) console.log(`  ${c.file} (${c.commit})`);
}

console.log(`\nSummary: ${stale.length} stale, ${current.length} current, ${noCommit.length} no commit tracked`);
