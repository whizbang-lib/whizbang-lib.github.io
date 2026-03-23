#!/usr/bin/env node

/**
 * Link Validation Script
 *
 * Validates:
 * 1. Nav tree slugs → all slugs in docs-nav-tree.json resolve to actual .md files
 * 2. Markdown internal links → all [text](path.md) links in docs resolve to actual files
 * 3. Docs index → all entries in docs-index.json resolve to actual .md files
 *
 * Exit code 0 = all links valid, 1 = broken links found
 *
 * Usage: node src/scripts/validate-links.mjs [--fix-suggestions]
 */

import fs from 'fs';
import path from 'path';

const DOCS_ROOT = 'src/assets/docs';
const NAV_TREE_PATH = 'src/assets/docs-nav-tree.json';
const DOCS_INDEX_PATH = 'src/assets/docs-index.json';

const errors = [];
const warnings = [];
let checkedCount = 0;

// ── 1. Validate nav tree slugs ──────────────────────────────────────────────

function validateNavTree() {
  if (!fs.existsSync(NAV_TREE_PATH)) {
    warnings.push(`Nav tree not found: ${NAV_TREE_PATH} (run prebuild first)`);
    return;
  }

  const navTree = JSON.parse(fs.readFileSync(NAV_TREE_PATH, 'utf-8'));

  function walkTree(nodes, context) {
    for (const node of nodes) {
      if (node.pages) {
        for (const page of node.pages) {
          checkedCount++;
          const filePath = path.join(DOCS_ROOT, `${page.slug}.md`);
          // Also check for directory with _folder.md or same-name .md inside
          const slugBasename = path.basename(page.slug);
          const dirPath = path.join(DOCS_ROOT, page.slug);
          const folderMd = path.join(dirPath, '_folder.md');
          const sameNameMd = path.join(dirPath, `${slugBasename}.md`);

          if (
            !fs.existsSync(filePath) &&
            !fs.existsSync(folderMd) &&
            !fs.existsSync(sameNameMd)
          ) {
            errors.push({
              type: 'nav-tree',
              slug: page.slug,
              expected: filePath,
              context: `Nav section: ${context}`,
            });
          }
        }
      }
      if (node.children) {
        walkTree(node.children, `${context} > ${node.title || node.name}`);
      }
    }
  }

  for (const [version, nodes] of Object.entries(navTree)) {
    walkTree(nodes, version);
  }
}

// ── 2. Validate docs index ──────────────────────────────────────────────────

function validateDocsIndex() {
  if (!fs.existsSync(DOCS_INDEX_PATH)) {
    warnings.push(`Docs index not found: ${DOCS_INDEX_PATH} (run prebuild first)`);
    return;
  }

  const docsIndex = JSON.parse(fs.readFileSync(DOCS_INDEX_PATH, 'utf-8'));

  for (const entry of docsIndex) {
    if (entry.path) {
      checkedCount++;
      const filePath = path.join(DOCS_ROOT, `${entry.path}.md`);
      if (!fs.existsSync(filePath)) {
        errors.push({
          type: 'docs-index',
          slug: entry.path,
          expected: filePath,
          context: `Title: ${entry.title || 'unknown'}`,
        });
      }
    }
  }
}

// ── 3. Validate markdown internal links ─────────────────────────────────────

function getAllMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function validateMarkdownLinks() {
  const mdFiles = getAllMarkdownFiles(DOCS_ROOT);

  // Match markdown links: [text](target)
  // Exclude: external URLs (http/https), anchors (#), images, mailto
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const dir = path.dirname(filePath);
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const linkText = match[1];
      let target = match[2];

      // Skip external links, anchors, mailto, images
      if (
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('#') ||
        target.startsWith('mailto:') ||
        target.startsWith('data:') ||
        target.startsWith('tel:')
      ) {
        continue;
      }

      // Strip anchor from target
      const targetWithoutAnchor = target.split('#')[0];
      if (!targetWithoutAnchor) continue; // pure anchor link like (#section)

      checkedCount++;

      // Resolve relative to the file's directory
      const resolvedPath = path.resolve(dir, targetWithoutAnchor);

      // Also try with .md extension, or as a directory with _folder.md / same-name .md
      const withMd = targetWithoutAnchor.endsWith('.md')
        ? null
        : path.resolve(dir, `${targetWithoutAnchor}.md`);
      const asDir = path.resolve(dir, targetWithoutAnchor);
      const asDirFolder = path.join(asDir, '_folder.md');
      const asDirSameName = path.join(asDir, `${path.basename(targetWithoutAnchor)}.md`);

      const exists =
        fs.existsSync(resolvedPath) ||
        (withMd && fs.existsSync(withMd)) ||
        fs.existsSync(asDirFolder) ||
        fs.existsSync(asDirSameName);

      if (!exists) {
        // Get line number
        const lines = content.substring(0, match.index).split('\n');
        const lineNum = lines.length;

        errors.push({
          type: 'markdown-link',
          source: `${filePath}:${lineNum}`,
          target: target,
          resolved: resolvedPath,
          linkText: linkText,
        });
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log('Validating documentation links...\n');

validateNavTree();
validateDocsIndex();
validateMarkdownLinks();

// Report
if (warnings.length > 0) {
  console.log(`⚠️  Warnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`   ${w}`);
  }
  console.log('');
}

if (errors.length > 0) {
  console.log(`❌ Broken links found: ${errors.length}\n`);

  // Group by type
  const navErrors = errors.filter((e) => e.type === 'nav-tree');
  const indexErrors = errors.filter((e) => e.type === 'docs-index');
  const linkErrors = errors.filter((e) => e.type === 'markdown-link');

  if (navErrors.length > 0) {
    console.log(`  Nav Tree (${navErrors.length}):`);
    for (const e of navErrors) {
      console.log(`    ${e.slug}`);
      console.log(`      Expected: ${e.expected}`);
      console.log(`      ${e.context}`);
    }
    console.log('');
  }

  if (indexErrors.length > 0) {
    console.log(`  Docs Index (${indexErrors.length}):`);
    for (const e of indexErrors) {
      console.log(`    ${e.slug}`);
      console.log(`      Expected: ${e.expected}`);
      console.log(`      ${e.context}`);
    }
    console.log('');
  }

  if (linkErrors.length > 0) {
    console.log(`  Markdown Links (${linkErrors.length}):`);
    for (const e of linkErrors) {
      console.log(`    ${e.source}`);
      console.log(`      [${e.linkText}](${e.target})`);
    }
    console.log('');
  }

  console.log(`Checked ${checkedCount} links total.`);
  process.exit(1);
} else {
  console.log(`✅ All ${checkedCount} links are valid.`);
  process.exit(0);
}
