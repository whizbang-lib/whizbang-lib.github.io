#!/usr/bin/env node

/**
 * Fix auto-generated code sample metadata across documentation.
 *
 * Fixes:
 * 1. Descriptions that just say "Demonstrates X" where X is the title
 * 2. Tags that are meaningless word-splits of the title
 * 3. Callout syntax (:::) leaked into descriptions
 * 4. Markdown formatting artifacts in tags/descriptions
 *
 * Run: node src/scripts/fix-code-sample-metadata.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DOCS_ROOT = 'src/assets/docs/v1.0.0';
const DRY_RUN = process.argv.includes('--dry-run');

let totalFixed = 0;
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

// Detect if a description is auto-generated junk
function isJunkDescription(desc, title) {
  if (!desc) return false;
  const lower = desc.toLowerCase().trim();
  const titleLower = (title || '').toLowerCase().trim();

  // "Demonstrates X" pattern
  if (lower.startsWith('demonstrates ')) return true;
  // Description is just the title repeated
  if (lower === titleLower) return true;
  // Callout syntax leaked in
  if (lower.startsWith(':::')) return true;
  // Table/markdown syntax leaked in
  if (lower.startsWith('|') || lower.startsWith('**why')) return true;
  // Very short / meaningless
  if (lower.length < 10 && !lower.includes('example')) return true;

  return false;
}

// Detect if tags are auto-generated junk (word splits of title)
function isJunkTags(tags, title) {
  if (!tags || !Array.isArray(tags)) return false;
  if (tags.length === 0) return false;

  const titleWords = (title || '').split(/[\s\-_]+/).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // If most tags are just single words from the title, it's junk
  const titleWordMatches = tags.filter(t => titleWords.includes(t.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return titleWordMatches.length >= tags.length * 0.6;
}

// Generate better tags from title and context
function generateBetterTags(title, language, filePath) {
  const tags = new Set();

  // Add section-based tag
  const section = filePath.split('v1.0.0/')[1]?.split('/')[0];
  if (section) tags.add(capitalize(section));

  // Add subsection
  const parts = filePath.split('v1.0.0/')[1]?.split('/');
  if (parts && parts.length > 2) {
    const subsection = parts[1].replace(/-/g, ' ');
    tags.add(capitalize(subsection));
  }

  // Add language
  if (language && language !== 'text') tags.add(language.toUpperCase() === 'CSHARP' ? 'C#' : capitalize(language));

  // Extract meaningful words from title (skip common filler)
  const fillerWords = new Set(['the', 'a', 'an', 'and', 'or', 'is', 'in', 'to', 'for', 'of', 'with', 'by', 'on', 'at', 'from', 'demonstrates', 'example', 'usage', 'basic', 'simple']);
  const titleWords = (title || '').split(/[\s\-_()]+/).filter(w => w.length > 2 && !fillerWords.has(w.toLowerCase()));
  for (const word of titleWords.slice(0, 3)) {
    if (word.match(/^[A-Z]/)) tags.add(word); // Keep PascalCase words
  }

  return [...tags].slice(0, 5);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let modified = content;
  let fileFixCount = 0;

  // Match code blocks with metadata: ```lang{...}
  const codeBlockRegex = /```(\w+)\{([^}]*)\}/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1];
    const metaStr = match[2];
    const fullMatch = match[0];

    // Parse metadata
    const titleMatch = metaStr.match(/title\s*=\s*"([^"]*)"/);
    const descMatch = metaStr.match(/description\s*=\s*"([^"]*)"/);
    const tagsMatch = metaStr.match(/tags\s*=\s*\[([^\]]*)\]/);

    const title = titleMatch?.[1] || '';
    const desc = descMatch?.[1] || '';
    const tagsStr = tagsMatch?.[1] || '';
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim().replace(/^"|"$/g, '')) : [];

    let newMetaStr = metaStr;
    let changed = false;

    // Fix junk descriptions
    if (descMatch && isJunkDescription(desc, title)) {
      // Generate a better description from title
      const betterDesc = title
        .replace(/^\`/, '').replace(/\`$/, '')  // Remove backticks
        .replace(/\s*\([\d]+\)$/, '')  // Remove "(2)" suffixes
        .replace(/⭐.*$/, '')  // Remove star annotations
        .replace(/\*\*/g, '');  // Remove bold

      const newDesc = betterDesc.length > 10 ? betterDesc : title;
      newMetaStr = newMetaStr.replace(`description="${desc}"`, `description="${newDesc}"`);
      changed = true;
    }

    // Fix junk tags
    if (tagsMatch && isJunkTags(tags, title)) {
      const betterTags = generateBetterTags(title, language, filePath);
      const newTagsStr = betterTags.map(t => `"${t}"`).join(', ');
      newMetaStr = newMetaStr.replace(`tags=[${tagsStr}]`, `tags=[${newTagsStr}]`);
      changed = true;
    }

    if (changed) {
      modified = modified.replace(fullMatch, '```' + language + '{' + newMetaStr + '}');
      fileFixCount++;
    }
  }

  if (fileFixCount > 0) {
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, modified);
    }
    totalFixed += fileFixCount;
    totalFiles++;
    const rel = path.relative('.', filePath);
    console.log(`  ${rel}: ${fileFixCount} samples fixed`);
  }
}

// Main
console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Fixing code sample metadata...\n`);

const files = findMarkdownFiles(DOCS_ROOT);
for (const file of files) {
  processFile(file);
}

console.log(`\n${DRY_RUN ? '[DRY RUN] Would fix' : 'Fixed'} ${totalFixed} samples across ${totalFiles} files`);
