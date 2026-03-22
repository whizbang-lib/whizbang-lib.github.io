#!/usr/bin/env node

/**
 * add-code-frontmatter.mjs
 *
 * Adds missing frontmatter metadata to code blocks in markdown documentation files.
 * Infers title, description, category, difficulty, and tags from surrounding context.
 *
 * Usage:
 *   node src/scripts/add-code-frontmatter.mjs               # Execute (modify files)
 *   node src/scripts/add-code-frontmatter.mjs --dry-run      # Preview without modifying
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_DIR = path.resolve(__dirname, '../assets/docs/v1.0.0');
const DRY_RUN = process.argv.includes('--dry-run');

// Languages that trigger the "Missing Front-Matter" warning in the parser
const FRONTMATTER_LANGUAGES = new Set([
  'csharp', 'cs', 'json', 'xml', 'yaml', 'yml', 'bash', 'sh', 'sql',
  'typescript', 'ts', 'javascript', 'js', 'powershell', 'ps1',
  'html', 'css', 'scss', 'python', 'py', 'java', 'go', 'rust', 'php'
]);

// Map path segments to categories
const PATH_CATEGORY_MAP = {
  'configuration': 'Configuration',
  'getting-started': 'Configuration',
  'extensibility': 'Extensibility',
  'extending': 'Extensibility',
  'source-generators': 'Internals',
  'internals': 'Internals',
  'diagnostics': 'Troubleshooting',
  'observability': 'Troubleshooting',
  'testing': 'Best-Practices',
  'deployment': 'Configuration',
  'infrastructure': 'Configuration',
  'workers': 'Implementation',
  'tutorial': 'Example',
  'examples': 'Example',
  'learn': 'Example',
  'apis': 'API',
  'rest': 'API',
  'graphql': 'API',
  'mutations': 'API',
  'signalr': 'API',
  'security': 'Best-Practices',
  'dispatcher': 'Architecture',
  'receptors': 'Architecture',
  'perspectives': 'Architecture',
  'lenses': 'Architecture',
  'lifecycle': 'Architecture',
  'events': 'Architecture',
  'messages': 'Architecture',
  'persistence': 'Implementation',
  'identity': 'Implementation',
  'data': 'Implementation',
  'messaging': 'Architecture',
  'transports': 'Configuration',
  'migration-guide': 'Reference',
  'fundamentals': 'Usage',
  'operations': 'Configuration',
  'attributes': 'Reference',
  'features': 'Extensibility',
  'aggregates': 'Architecture',
};

/**
 * Infer category from the file path segments.
 */
function inferCategory(filePath) {
  const rel = path.relative(DOCS_DIR, filePath).replace(/\\/g, '/');
  const segments = rel.split('/');
  // Walk from deepest to shallowest to find the most specific match
  for (let i = segments.length - 2; i >= 0; i--) {
    const seg = segments[i].toLowerCase();
    if (PATH_CATEGORY_MAP[seg]) return PATH_CATEGORY_MAP[seg];
  }
  return 'Usage';
}

/**
 * Infer tags from path segments and heading text.
 */
function inferTags(filePath, heading) {
  const tags = new Set();
  const rel = path.relative(DOCS_DIR, filePath).replace(/\\/g, '/');
  const segments = rel.split('/');

  // Add meaningful path segments as tags
  for (const seg of segments) {
    if (seg === 'v1.0.0' || seg.endsWith('.md') || seg.startsWith('_')) continue;
    // Convert kebab-case to Title Case
    const tag = seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
    if (tag.length > 1) tags.add(tag);
  }

  // Extract keywords from heading
  if (heading) {
    const headingWords = heading
      .replace(/[`#{}()\[\]]/g, '')
      .split(/[\s,/]+/)
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'how', 'use', 'via', 'from', 'into', 'what', 'are'].includes(w.toLowerCase()));

    for (const w of headingWords.slice(0, 3)) {
      tags.add(w.charAt(0).toUpperCase() + w.slice(1));
    }
  }

  // Limit to 4 tags
  return [...tags].slice(0, 4);
}

/**
 * Infer difficulty from code content and line count.
 */
function inferDifficulty(code, heading) {
  const lines = code.split('\n').filter(l => l.trim()).length;
  const headingLower = (heading || '').toLowerCase();

  // Advanced signals
  if (lines > 30 ||
      headingLower.includes('generator') ||
      headingLower.includes('internal') ||
      headingLower.includes('advanced') ||
      headingLower.includes('custom') && lines > 15 ||
      /abstract\s+class|protected\s+override|ISourceGenerator|IncrementalGenerator/i.test(code)) {
    return 'ADVANCED';
  }

  // Beginner signals
  if (lines <= 8 ||
      headingLower.includes('basic') ||
      headingLower.includes('getting started') ||
      headingLower.includes('overview') ||
      headingLower.includes('quick') ||
      /AddWhizbang|services\.Add|builder\.Services|appsettings/i.test(code) && lines <= 12) {
    return 'BEGINNER';
  }

  return 'INTERMEDIATE';
}

/**
 * Truncate a string to maxLen, breaking at word boundary.
 */
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  const trimmed = str.substring(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? trimmed.substring(0, lastSpace) : trimmed).replace(/[.,;:!?\s]+$/, '');
}

/**
 * Escape double quotes in a string for frontmatter values.
 */
function escapeQuotes(str) {
  return str.replace(/"/g, "'");
}

/**
 * Generate a title from heading text and optional dedup context.
 */
function generateTitle(heading, blockIndex, totalBlocksUnderHeading, codeSnippet) {
  let title = heading || 'Code Example';

  // Remove markdown heading markers, anchors, and leading step numbers
  title = title.replace(/^#+\s*/, '').replace(/\s*\{#[^}]+\}/, '').replace(/^\d+\.\s*/, '').trim();

  // If multiple blocks under same heading, differentiate
  if (totalBlocksUnderHeading > 1 && blockIndex > 0) {
    // Try to extract a class/interface/method name from code
    const nameMatch = codeSnippet.match(/(?:class|interface|record|enum|struct)\s+(\w+)/);
    if (nameMatch) {
      title = `${title} - ${nameMatch[1]}`;
    } else {
      title = `${title} (${blockIndex + 1})`;
    }
  }

  return truncate(title, 60);
}

/**
 * Generate a description from the preceding paragraph text.
 */
function generateDescription(precedingText, heading, language) {
  if (precedingText) {
    // Take first sentence
    const firstSentence = precedingText.match(/^[^.!?\n]+[.!?]?/);
    if (firstSentence) {
      let desc = firstSentence[0].trim();
      // Remove markdown formatting
      desc = desc.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      if (desc.length > 10) {
        return truncate(desc, 120);
      }
    }
  }

  // Fallback: use heading with more context
  if (heading) {
    const cleanHeading = heading.replace(/^#+\s*/, '').replace(/\s*\{#[^}]+\}/, '').replace(/^\d+\.\s*/, '').trim();
    return truncate(`Demonstrates ${cleanHeading.charAt(0).toLowerCase() + cleanHeading.slice(1)}`, 120);
  }

  return `Example ${language} code snippet`;
}

/**
 * Process a single markdown file.
 * Returns { modified: boolean, blocksAdded: number, samples: string[] }
 */
function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const result = [];
  let blocksAdded = 0;
  const samples = [];

  const category = inferCategory(filePath);

  let currentHeading = '';
  let precedingParagraph = '';
  let paragraphBuffer = '';
  let headingBlockCounts = {}; // track how many code blocks per heading
  let headingBlockIndex = {};  // current index per heading

  // First pass: count blocks per heading to handle dedup
  let tempHeading = '';
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      tempHeading = line;
      if (!headingBlockCounts[tempHeading]) headingBlockCounts[tempHeading] = 0;
    }
    const fenceMatch = line.match(/^```(\w+)$/);
    if (fenceMatch && FRONTMATTER_LANGUAGES.has(fenceMatch[1].toLowerCase())) {
      headingBlockCounts[tempHeading] = (headingBlockCounts[tempHeading] || 0) + 1;
    }
  }

  // Second pass: process and add frontmatter
  let inCodeBlock = false;
  let codeBlockLines = [];
  let codeBlockLang = '';
  let codeBlockStartIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track headings
    if (!inCodeBlock && /^#{1,4}\s+/.test(line)) {
      currentHeading = line;
      precedingParagraph = '';
      paragraphBuffer = '';
      if (!headingBlockIndex[currentHeading]) headingBlockIndex[currentHeading] = 0;
      result.push(line);
      continue;
    }

    // Track paragraphs (non-empty, non-heading, non-fence, non-list-marker lines)
    if (!inCodeBlock && line.trim() && !line.startsWith('```') && !/^#{1,4}\s+/.test(line)) {
      if (paragraphBuffer) {
        paragraphBuffer += ' ' + line.trim();
      } else {
        paragraphBuffer = line.trim();
      }
    } else if (!inCodeBlock && !line.trim()) {
      if (paragraphBuffer) {
        precedingParagraph = paragraphBuffer;
      }
      paragraphBuffer = '';
    }

    // Check for code fence opening
    if (!inCodeBlock) {
      // Already has frontmatter — skip (```lang{ pattern)
      if (/^```\w+\{/.test(line)) {
        inCodeBlock = true;
        result.push(line);
        continue;
      }

      const fenceMatch = line.match(/^```(\w+)$/);
      if (fenceMatch) {
        const lang = fenceMatch[1];
        if (FRONTMATTER_LANGUAGES.has(lang.toLowerCase())) {
          // Collect the code block content to inform difficulty
          inCodeBlock = true;
          codeBlockLang = lang;
          codeBlockStartIdx = result.length;
          codeBlockLines = [];
          // Use the paragraph buffer if it hasn't been committed yet
          const descParagraph = paragraphBuffer || precedingParagraph;
          // Store context for when we hit the closing fence
          result.push({ __pendingFrontmatter: true, lang, heading: currentHeading, paragraph: descParagraph, category });
          continue;
        } else {
          inCodeBlock = true;
          result.push(line);
          continue;
        }
      }

      result.push(line);
      continue;
    }

    // Inside a code block
    if (line.startsWith('```') && !line.match(/^```\w/)) {
      // Closing fence
      inCodeBlock = false;

      // Check if we have a pending frontmatter entry
      const pending = result[codeBlockStartIdx];
      if (pending && pending.__pendingFrontmatter) {
        const code = codeBlockLines.join('\n');
        const lang = pending.lang;
        const heading = pending.heading;
        const paragraph = pending.paragraph;

        const blockIdx = headingBlockIndex[heading] || 0;
        const totalBlocks = headingBlockCounts[heading] || 1;
        headingBlockIndex[heading] = blockIdx + 1;

        const title = escapeQuotes(generateTitle(heading, blockIdx, totalBlocks, code));
        const description = escapeQuotes(generateDescription(paragraph, heading, lang));
        const difficulty = inferDifficulty(code, heading);
        const tags = inferTags(filePath, heading.replace(/^#+\s*/, ''));
        const tagsStr = tags.map(t => `"${escapeQuotes(t)}"`).join(', ');

        const frontmatter = `\`\`\`${lang}{title="${title}" description="${description}" category="${pending.category}" difficulty="${difficulty}" tags=[${tagsStr}]}`;

        result[codeBlockStartIdx] = frontmatter;
        blocksAdded++;

        if (samples.length < 3) {
          samples.push(frontmatter);
        }
      }

      result.push(line);
      codeBlockLines = [];
      continue;
    }

    // Accumulate code block content
    if (result[codeBlockStartIdx] && result[codeBlockStartIdx].__pendingFrontmatter) {
      codeBlockLines.push(line);
    }
    result.push(line);
  }

  const newContent = result.map(l => typeof l === 'string' ? l : '').join('\n');

  if (blocksAdded > 0 && !DRY_RUN) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
  }

  return { modified: blocksAdded > 0, blocksAdded, samples };
}

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`\n📝 Code Block Frontmatter Generator`);
console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN (no files modified)' : '✏️  EXECUTE (modifying files)'}`);
console.log(`   Docs: ${DOCS_DIR}\n`);

const files = findMarkdownFiles(DOCS_DIR);
console.log(`   Found ${files.length} markdown files\n`);

let totalBlocks = 0;
let totalFiles = 0;
const allSamples = [];

for (const file of files) {
  const { modified, blocksAdded, samples } = processFile(file);
  if (blocksAdded > 0) {
    totalBlocks += blocksAdded;
    totalFiles++;
    const rel = path.relative(DOCS_DIR, file);
    console.log(`   ${DRY_RUN ? 'Would add' : 'Added'} ${blocksAdded} frontmatter(s) → ${rel}`);
    allSamples.push(...samples.map(s => ({ file: rel, sample: s })));
  }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`   ${DRY_RUN ? 'Would modify' : 'Modified'}: ${totalFiles} files`);
console.log(`   ${DRY_RUN ? 'Would add' : 'Added'}: ${totalBlocks} frontmatter blocks`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

if (DRY_RUN && allSamples.length > 0) {
  console.log(`📋 Sample frontmatter (first ${Math.min(allSamples.length, 20)}):\n`);
  for (const { file, sample } of allSamples.slice(0, 20)) {
    console.log(`   ${file}:`);
    console.log(`   ${sample}\n`);
  }
}
