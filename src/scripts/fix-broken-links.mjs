#!/usr/bin/env node

/**
 * Fix Broken Markdown Links
 *
 * Scans all markdown files for internal links that don't resolve,
 * attempts to find the correct target by matching the filename
 * against existing files, and rewrites the link.
 *
 * Links that can't be auto-resolved are reported for manual review.
 *
 * Usage:
 *   node src/scripts/fix-broken-links.mjs           # Dry run (report only)
 *   node src/scripts/fix-broken-links.mjs --fix      # Apply fixes
 *   node src/scripts/fix-broken-links.mjs --remove   # Remove links that can't be resolved (keep text)
 */

import fs from 'fs';
import path from 'path';

const DOCS_ROOT = 'src/assets/docs';
const dryRun = !process.argv.includes('--fix') && !process.argv.includes('--remove');
const removeUnresolvable = process.argv.includes('--remove');

// Build index of all markdown files
function getAllMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md') && entry.name !== '_folder.md') {
      results.push(fullPath);
    }
  }
  return results;
}

// Build lookup: basename (without .md) → [full paths]
const allMdFiles = getAllMarkdownFiles(DOCS_ROOT);
const fileIndex = new Map();
for (const fp of allMdFiles) {
  const basename = path.basename(fp, '.md');
  if (!fileIndex.has(basename)) {
    fileIndex.set(basename, []);
  }
  fileIndex.get(basename).push(fp);
}

function resolveLink(target, sourceDir) {
  const targetWithoutAnchor = target.split('#')[0];
  const anchor = target.includes('#') ? '#' + target.split('#').slice(1).join('#') : '';
  if (!targetWithoutAnchor) return null; // pure anchor

  // Check if it resolves as-is
  const resolved = path.resolve(sourceDir, targetWithoutAnchor);
  const withMd = targetWithoutAnchor.endsWith('.md') ? null : path.resolve(sourceDir, `${targetWithoutAnchor}.md`);
  const asDir = path.resolve(sourceDir, targetWithoutAnchor);
  const asDirFolder = path.join(asDir, '_folder.md');
  const asDirSameName = path.join(asDir, `${path.basename(targetWithoutAnchor)}.md`);

  if (
    fs.existsSync(resolved) ||
    (withMd && fs.existsSync(withMd)) ||
    fs.existsSync(asDirFolder) ||
    fs.existsSync(asDirSameName)
  ) {
    return null; // Already resolves
  }

  // Try to find by basename
  let searchName = path.basename(targetWithoutAnchor).replace(/\.md$/, '');
  const candidates = fileIndex.get(searchName) || [];

  if (candidates.length === 0) return { type: 'no-match', target, anchor };
  if (candidates.length === 1) {
    // Unique match — compute relative path
    const newTarget = path.relative(sourceDir, candidates[0]);
    return { type: 'unique', target, newTarget: newTarget + anchor, candidate: candidates[0] };
  }

  // Multiple matches — pick best by path similarity and same version preference
  const targetParts = targetWithoutAnchor.split('/').filter(Boolean);
  // Determine version context from source file
  const sourceRelative = path.relative(DOCS_ROOT, sourceDir);
  const sourceVersion = sourceRelative.split('/')[0]; // e.g., 'v1.0.0', 'drafts'

  let bestScore = -1;
  let bestCandidate = null;

  for (const candidate of candidates) {
    const candidateRel = path.relative(DOCS_ROOT, candidate);
    const candidateParts = candidateRel.split('/');
    const candidateVersion = candidateParts[0];

    // Score by path segment matches
    let score = 0;
    for (const part of targetParts) {
      if (part !== '..' && part !== '.' && candidateParts.includes(part)) score++;
    }

    // Bonus for same version/section
    if (candidateVersion === sourceVersion) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate && bestScore > 0) {
    const newTarget = path.relative(sourceDir, bestCandidate);
    return { type: 'best-guess', target, newTarget: newTarget + anchor, candidate: bestCandidate, score: bestScore, total: candidates.length };
  }

  return { type: 'ambiguous', target, anchor, candidates: candidates.length };
}

// Process all markdown files
const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
let fixedCount = 0;
let removedCount = 0;
let unfixableCount = 0;
const unfixable = [];

const mdFiles = getAllMarkdownFiles(DOCS_ROOT);

for (const filePath of mdFiles) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const dir = path.dirname(filePath);
  let modified = false;
  const replacements = [];

  let match;
  // Reset regex
  linkRegex.lastIndex = 0;

  while ((match = linkRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const linkText = match[1];
    let target = match[2];

    // Skip external, anchors, mailto, etc.
    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('#') ||
      target.startsWith('mailto:') ||
      target.startsWith('data:') ||
      target.startsWith('tel:')
    ) continue;

    // Skip code/test references
    if (target.includes('/code/') || target.includes('/tests/')) continue;

    const result = resolveLink(target, dir);
    if (!result) continue; // Already resolves

    if (result.type === 'unique' || result.type === 'best-guess') {
      replacements.push({
        original: fullMatch,
        replacement: `[${linkText}](${result.newTarget})`,
        target: result.target,
        newTarget: result.newTarget,
        type: result.type,
      });
    } else {
      if (removeUnresolvable) {
        replacements.push({
          original: fullMatch,
          replacement: linkText, // Just the text, no link
          target: result.target,
          type: 'removed',
        });
      } else {
        unfixable.push({
          file: filePath,
          target: result.target,
          type: result.type,
          candidates: result.candidates,
        });
        unfixableCount++;
      }
    }
  }

  if (replacements.length > 0 && !dryRun) {
    for (const r of replacements) {
      content = content.replace(r.original, r.replacement);
      if (r.type === 'removed') {
        removedCount++;
      } else {
        fixedCount++;
      }
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  } else {
    for (const r of replacements) {
      if (r.type === 'removed') removedCount++;
      else fixedCount++;
    }
  }

  // Report in dry run
  if (dryRun && replacements.length > 0) {
    for (const r of replacements) {
      if (r.type === 'removed') {
        console.log(`  REMOVE: ${filePath}`);
        console.log(`    [${r.target}] → plain text`);
      } else {
        console.log(`  ${r.type === 'best-guess' ? 'GUESS' : 'FIX'}: ${filePath}`);
        console.log(`    ${r.target} → ${r.newTarget}`);
      }
    }
  }
}

console.log('\n--- Summary ---');
console.log(`Auto-fixable (unique match): ${fixedCount}`);
if (removeUnresolvable) console.log(`Removed (no match): ${removedCount}`);
console.log(`Unfixable (no match found): ${unfixableCount}`);
if (dryRun) {
  console.log('\nDry run — no files modified. Use --fix to apply, --remove to strip unfixable links.');
}

if (unfixable.length > 0 && !removeUnresolvable) {
  console.log(`\nUnfixable links (${unfixable.length}):`);
  for (const u of unfixable) {
    console.log(`  ${u.file}: ${u.target}`);
  }
}
