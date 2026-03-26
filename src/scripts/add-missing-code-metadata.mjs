#!/usr/bin/env node

/**
 * Add metadata to code samples that have NONE.
 *
 * Targets code blocks like ```csharp\n that lack the {title="..." ...} metadata.
 * Only adds metadata to csharp, sql, graphql, json, yaml, xml blocks (not bash/mermaid/text).
 *
 * Run: node src/scripts/add-missing-code-metadata.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DOCS_ROOT = 'src/assets/docs/v1.0.0';
const DRY_RUN = process.argv.includes('--dry-run');

// Languages that benefit from metadata
const TARGET_LANGS = new Set(['csharp', 'sql', 'graphql', 'json', 'yaml', 'xml', 'typescript']);

let totalAdded = 0;
let totalFiles = 0;

function findMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function getSection(filePath) {
  const parts = filePath.split('v1.0.0/')[1]?.split('/');
  if (!parts) return 'General';
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

function getSubsection(filePath) {
  const parts = filePath.split('v1.0.0/')[1]?.split('/');
  if (!parts || parts.length < 2) return '';
  return parts[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function generateTitle(codePreview, language, precedingLine) {
  // Try to extract from preceding markdown heading or bold text
  if (precedingLine) {
    const headingMatch = precedingLine.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) return headingMatch[1].replace(/[`*]/g, '').trim();

    const boldMatch = precedingLine.match(/\*\*(.+?)\*\*/);
    if (boldMatch) return boldMatch[1].trim();
  }

  // Generate from first meaningful line of code
  const firstLine = codePreview.split('\n').find(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('--'));
  if (!firstLine) return `${language.toUpperCase()} Example`;

  // Extract class/method/type name
  const classMatch = firstLine.match(/(?:class|interface|record|struct|enum)\s+(\w+)/);
  if (classMatch) return classMatch[1];

  const methodMatch = firstLine.match(/(?:public|private|protected|async)\s+\S+\s+(\w+)/);
  if (methodMatch) return methodMatch[1];

  // Truncate first line
  const cleaned = firstLine.trim().replace(/[{;]/g, '').trim();
  return cleaned.length > 60 ? cleaned.substring(0, 57) + '...' : cleaned;
}

function getDifficulty(codePreview) {
  if (codePreview.includes('interface ') || codePreview.includes('abstract ')) return 'ADVANCED';
  if (codePreview.includes('async ') || codePreview.includes('CancellationToken')) return 'INTERMEDIATE';
  return 'BEGINNER';
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const section = getSection(filePath);
  const subsection = getSubsection(filePath);
  let modified = false;
  let fileCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match bare code fence: ```lang (without {metadata})
    const match = line.match(/^```(\w+)\s*$/);
    if (!match) continue;

    const lang = match[1];
    if (!TARGET_LANGS.has(lang)) continue;

    // Collect code preview (next 5 lines)
    const preview = lines.slice(i + 1, i + 6).join('\n');
    const precedingLine = i > 0 ? lines[i - 1] : '';

    const title = generateTitle(preview, lang, precedingLine);
    const difficulty = getDifficulty(preview);
    const langTag = lang === 'csharp' ? 'C#' : lang.toUpperCase();
    const tags = [section, subsection, langTag].filter(Boolean).map(t => `"${t}"`).join(', ');

    const metadata = `{title="${title}" description="${title}" category="${section}" difficulty="${difficulty}" tags=[${tags}]}`;
    lines[i] = '```' + lang + metadata;
    modified = true;
    fileCount++;
  }

  if (modified) {
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, lines.join('\n'));
    }
    totalAdded += fileCount;
    totalFiles++;
    console.log(`  ${path.relative('.', filePath).split('v1.0.0/')[1]}: ${fileCount} samples`);
  }
}

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Adding metadata to bare code samples...\n`);

const files = findMarkdownFiles(DOCS_ROOT);
for (const file of files) processFile(file);

console.log(`\n${DRY_RUN ? 'Would add' : 'Added'} metadata to ${totalAdded} samples across ${totalFiles} files`);
