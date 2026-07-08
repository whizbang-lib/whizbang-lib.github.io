#!/usr/bin/env node

/**
 * Documentation Audit Baseline Generator
 *
 * Generates comprehensive audit reports for the Whizbang documentation site.
 * Run from the repo root: node src/scripts/audit-baseline.mjs
 *
 * Output: audit-reports/*.json
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DOCS_ROOT = 'src/assets/docs/v1.0.0';
const ALL_DOCS_ROOT = 'src/assets/docs';
const CODE_DOCS_MAP_PATH = 'src/assets/code-docs-map.json';
const SEARCH_INDEX_PATH = 'src/assets/enhanced-search-index.json';
const LIBRARY_PATH = path.resolve('..', 'whizbang');
const OUTPUT_DIR = 'audit-reports';

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, 'sessions'), { recursive: true });

// ─── Utilities ───────────────────────────────────────────────────────────────

function findMarkdownFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content };
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return { frontmatter: {}, body: content };

  const fmText = content.substring(3, endIdx).trim();
  const body = content.substring(endIdx + 3).trim();
  const frontmatter = {};
  let currentKey = null;
  let currentValue = '';
  let inMultiline = false;
  let inList = false;
  let listItems = [];

  const lines = fmText.split('\n');

  function flushCurrent() {
    if (currentKey) {
      if (inList) {
        frontmatter[currentKey] = listItems.join(', ');
        inList = false;
        listItems = [];
      } else if (inMultiline) {
        frontmatter[currentKey] = currentValue.trim();
        inMultiline = false;
        currentValue = '';
      }
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Handle YAML list items (  - value)
    if (inList && trimmed.startsWith('- ')) {
      listItems.push(trimmed.substring(2).replace(/^['"]|['"]$/g, '').trim());
      continue;
    }

    // Handle multiline values (e.g., description: >-)
    if (inMultiline) {
      if (/^\S/.test(line) && line.includes(':')) {
        flushCurrent();
        // Fall through to parse as new key
      } else {
        currentValue += ' ' + trimmed;
        continue;
      }
    }

    // If we were in a list but this line isn't a list item, flush
    if (inList && !trimmed.startsWith('- ')) {
      flushCurrent();
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      currentKey = line.substring(0, colonIdx).trim();
      const rawValue = line.substring(colonIdx + 1).trim();

      if (rawValue === '>-' || rawValue === '>' || rawValue === '|') {
        inMultiline = true;
        currentValue = '';
      } else if (rawValue === '') {
        // Could be start of a YAML list on next lines
        inList = true;
        listItems = [];
      } else if (rawValue.startsWith('[')) {
        // Inline array [a, b, c]
        frontmatter[currentKey] = rawValue.replace(/[[\]'"]/g, '').trim();
      } else {
        frontmatter[currentKey] = rawValue.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  flushCurrent();

  return { frontmatter, body };
}

function relPath(filePath) {
  return path.relative('.', filePath).replace(/\\/g, '/');
}

// ─── Report 1: Frontmatter Gaps ─────────────────────────────────────────────

function generateFrontmatterGaps() {
  console.log('📋 Generating frontmatter-gaps.json ...');
  const expectedFields = ['title', 'version', 'category', 'order', 'description', 'tags', 'codeReferences', 'slug'];
  const mdFiles = findMarkdownFiles(DOCS_ROOT);
  const results = [];

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    const rel = relPath(file);
    const missing = expectedFields.filter(f => !frontmatter[f] || frontmatter[f] === '');
    const shortDescription = frontmatter.description && frontmatter.description.length < 30;

    if (missing.length > 0 || shortDescription) {
      results.push({
        file: rel,
        presentFields: expectedFields.filter(f => frontmatter[f] && frontmatter[f] !== ''),
        missingFields: missing,
        shortDescription: shortDescription ? frontmatter.description : null,
        frontmatter
      });
    }
  }

  const summary = {
    totalPages: mdFiles.length,
    pagesWithGaps: results.length,
    fieldCoverage: {},
    pages: results
  };

  for (const field of expectedFields) {
    const count = mdFiles.length - results.filter(r => r.missingFields.includes(field)).length;
    summary.fieldCoverage[field] = { present: count, missing: mdFiles.length - count, pct: Math.round(count / mdFiles.length * 100) };
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'frontmatter-gaps.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.pagesWithGaps}/${summary.totalPages} pages have frontmatter gaps`);
  return summary;
}

// ─── Report 2: Code Samples Inventory ───────────────────────────────────────

function generateCodeSamplesInventory() {
  console.log('💻 Generating code-samples-inventory.json ...');
  const mdFiles = findMarkdownFiles(DOCS_ROOT);
  const allSamples = [];
  const expectedMeta = ['title', 'description', 'category', 'difficulty', 'tags', 'framework', 'testFile', 'testMethod'];

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const rel = relPath(file);

    // Match fenced code blocks: ```lang or ```lang{...}
    const codeBlockRegex = /```(\w+)(\{[^}]*\})?\s*\n([\s\S]*?)```/g;
    let match;
    let blockIndex = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1];
      const metaRaw = match[2] || '';
      const codeContent = match[3];
      const hasMetadata = metaRaw.length > 0;

      // Parse metadata if present
      const meta = {};
      if (hasMetadata) {
        // Format: {key: "value", key2: "value2"} or {key: value}
        const metaStr = metaRaw.slice(1, -1); // remove { }
        const pairs = metaStr.match(/(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,}]*))/g) || [];
        for (const pair of pairs) {
          const [k, ...vParts] = pair.split(/:\s*/);
          const v = vParts.join(':').replace(/^['"]|['"]$/g, '').trim();
          meta[k.trim()] = v;
        }
      }

      const missingMeta = hasMetadata
        ? expectedMeta.filter(f => !meta[f])
        : expectedMeta; // If no metadata at all, everything is missing

      allSamples.push({
        file: rel,
        blockIndex: blockIndex++,
        language,
        hasMetadata,
        presentMeta: Object.keys(meta),
        missingMeta,
        lineCount: codeContent.split('\n').length,
        preview: codeContent.substring(0, 100).trim()
      });
    }
  }

  const summary = {
    totalSamples: allSamples.length,
    withMetadata: allSamples.filter(s => s.hasMetadata).length,
    withoutMetadata: allSamples.filter(s => !s.hasMetadata).length,
    byLanguage: {},
    metaFieldCoverage: {},
    samples: allSamples
  };

  // Language breakdown
  for (const s of allSamples) {
    summary.byLanguage[s.language] = (summary.byLanguage[s.language] || 0) + 1;
  }

  // Meta field coverage (across samples that DO have metadata)
  const withMeta = allSamples.filter(s => s.hasMetadata);
  for (const field of expectedMeta) {
    const present = withMeta.filter(s => s.presentMeta.includes(field)).length;
    summary.metaFieldCoverage[field] = {
      present,
      missing: withMeta.length - present,
      pct: withMeta.length > 0 ? Math.round(present / withMeta.length * 100) : 0
    };
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'code-samples-inventory.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.totalSamples} code samples found (${summary.withMetadata} with metadata, ${summary.withoutMetadata} without)`);
  return summary;
}

// ─── Report 3: Undocumented Public Types ────────────────────────────────────

function generateUndocumentedPublicTypes() {
  console.log('🔍 Generating undocumented-public-types.json ...');

  // Load code-docs-map
  let codeDocsMap = {};
  if (fs.existsSync(CODE_DOCS_MAP_PATH)) {
    codeDocsMap = JSON.parse(fs.readFileSync(CODE_DOCS_MAP_PATH, 'utf-8'));
  }

  const documentedSymbols = new Set(Object.keys(codeDocsMap));

  // Scan library source for public types
  const srcDir = path.join(LIBRARY_PATH, 'src');
  if (!fs.existsSync(srcDir)) {
    console.log('   ⚠️  Library src/ not found, skipping');
    return null;
  }

  const csFiles = findCSharpFiles(srcDir);
  const publicTypes = [];
  const typeRegex = /^\s*public\s+(?:partial\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:static\s+)?(?:readonly\s+)?(class|interface|struct|record|enum)\s+(\w+)/gm;

  for (const file of csFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    typeRegex.lastIndex = 0;

    while ((match = typeRegex.exec(content)) !== null) {
      const typeKind = match[1];
      const typeName = match[2];
      const relFile = path.relative(LIBRARY_PATH, file).replace(/\\/g, '/');

      // Skip generated files, test files, and internal implementations
      if (relFile.includes('.g.cs') || relFile.includes('.Tests') || relFile.includes('obj/')) continue;

      const hasDocs = documentedSymbols.has(typeName);
      publicTypes.push({
        symbol: typeName,
        kind: typeKind,
        file: relFile,
        hasDocs,
        docsPath: hasDocs ? codeDocsMap[typeName]?.docs : null
      });
    }
  }

  const undocumented = publicTypes.filter(t => !t.hasDocs);

  const summary = {
    totalPublicTypes: publicTypes.length,
    documented: publicTypes.length - undocumented.length,
    undocumented: undocumented.length,
    coveragePct: Math.round((publicTypes.length - undocumented.length) / publicTypes.length * 100),
    byKind: {},
    undocumentedTypes: undocumented
  };

  for (const t of undocumented) {
    summary.byKind[t.kind] = (summary.byKind[t.kind] || 0) + 1;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'undocumented-public-types.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.undocumented}/${summary.totalPublicTypes} public types lack <docs> tags (${summary.coveragePct}% coverage)`);
  return summary;
}

function findCSharpFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['bin', 'obj', 'node_modules', '.git'].includes(entry.name)) continue;
      files.push(...findCSharpFiles(full));
    } else if (entry.name.endsWith('.cs')) {
      files.push(full);
    }
  }
  return files;
}

// ─── Report 4: Broken Code-Docs Links ──────────────────────────────────────

function generateBrokenCodeDocsLinks() {
  console.log('🔗 Generating broken-code-docs-links.json ...');

  if (!fs.existsSync(CODE_DOCS_MAP_PATH)) {
    console.log('   ⚠️  code-docs-map.json not found, skipping');
    return null;
  }

  const codeDocsMap = JSON.parse(fs.readFileSync(CODE_DOCS_MAP_PATH, 'utf-8'));
  const broken = [];
  const valid = [];

  for (const [symbol, entry] of Object.entries(codeDocsMap)) {
    const rawDocsPath = entry.docs;
    // Strip anchor fragments (e.g., "messaging/transports/rabbitmq#connection-retry" -> "messaging/transports/rabbitmq")
    const docsPath = rawDocsPath.split('#')[0];
    // Try multiple resolution strategies
    const candidates = [
      path.join(ALL_DOCS_ROOT, `${docsPath}.md`),
      path.join(DOCS_ROOT, `${docsPath}.md`),
      path.join(ALL_DOCS_ROOT, docsPath, '_folder.md'),
      path.join(DOCS_ROOT, docsPath, '_folder.md'),
      path.join(ALL_DOCS_ROOT, docsPath, `${path.basename(docsPath)}.md`),
      path.join(DOCS_ROOT, docsPath, `${path.basename(docsPath)}.md`)
    ];

    const found = candidates.some(c => fs.existsSync(c));
    if (!found) {
      broken.push({ symbol, docsPath: rawDocsPath, resolvedPath: docsPath, sourceFile: entry.file, line: entry.line, triedPaths: candidates.map(c => relPath(c)) });
    } else {
      valid.push({ symbol, docsPath: rawDocsPath });
    }
  }

  const summary = {
    totalLinks: Object.keys(codeDocsMap).length,
    valid: valid.length,
    broken: broken.length,
    brokenLinks: broken
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'broken-code-docs-links.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.broken}/${summary.totalLinks} code-docs links are broken`);
  return summary;
}

// ─── Report 5: Mermaid Inventory ────────────────────────────────────────────

function generateMermaidInventory() {
  console.log('📊 Generating mermaid-inventory.json ...');
  const mdFiles = findMarkdownFiles(DOCS_ROOT);
  const diagrams = [];

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const rel = relPath(file);

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('```mermaid')) {
        // Collect diagram content
        const diagramLines = [];
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith('```')) {
          diagramLines.push(lines[j]);
          j++;
        }

        const firstLine = diagramLines[0]?.trim() || '';
        const diagramType = firstLine.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitgraph|journey|mindmap|timeline|sankey|xy-chart|block-beta)/)?.[1] || 'unknown';

        diagrams.push({
          file: rel,
          line: i + 1,
          diagramType,
          firstLine,
          lineCount: diagramLines.length,
          preview: diagramLines.slice(0, 3).join('\n')
        });
      }
    }
  }

  const summary = {
    totalDiagrams: diagrams.length,
    byType: {},
    byFile: {},
    diagrams
  };

  for (const d of diagrams) {
    summary.byType[d.diagramType] = (summary.byType[d.diagramType] || 0) + 1;
    summary.byFile[d.file] = (summary.byFile[d.file] || 0) + 1;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'mermaid-inventory.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.totalDiagrams} mermaid diagrams across ${Object.keys(summary.byFile).length} files`);
  return summary;
}

// ─── Report 6: Callout Inventory ────────────────────────────────────────────

function generateCalloutInventory() {
  console.log('📢 Generating callout-inventory.json ...');
  const mdFiles = findMarkdownFiles(DOCS_ROOT);
  const callouts = [];

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const rel = relPath(file);

    let inCallout = false;
    let calloutStart = -1;
    let calloutType = '';

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.match(/^:::(\w+)/)) {
        if (inCallout) {
          // Previous callout was not closed before a new one started
          callouts.push({
            file: rel,
            line: calloutStart + 1,
            type: calloutType,
            closed: false,
            issue: 'New callout started before previous was closed'
          });
        }
        inCallout = true;
        calloutStart = i;
        calloutType = trimmed.match(/^:::(\w+)/)[1];

        // Check for inline modifier like {type="breaking"}
        const modMatch = trimmed.match(/\{type="(\w+)"\}/);
        if (modMatch) {
          calloutType += `{${modMatch[1]}}`;
        }
      } else if (trimmed === ':::' && inCallout) {
        callouts.push({
          file: rel,
          line: calloutStart + 1,
          type: calloutType,
          closed: true,
          lineCount: i - calloutStart + 1
        });
        inCallout = false;
      }
    }

    // Unclosed at end of file
    if (inCallout) {
      callouts.push({
        file: rel,
        line: calloutStart + 1,
        type: calloutType,
        closed: false,
        issue: 'Unclosed at end of file'
      });
    }
  }

  const unclosed = callouts.filter(c => !c.closed);
  const summary = {
    totalCallouts: callouts.length,
    unclosed: unclosed.length,
    byType: {},
    unclosedCallouts: unclosed,
    callouts
  };

  for (const c of callouts) {
    summary.byType[c.type] = (summary.byType[c.type] || 0) + 1;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'callout-inventory.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.totalCallouts} callouts found, ${summary.unclosed} unclosed`);
  return summary;
}

// ─── Report 7: Search Index Quality ─────────────────────────────────────────

function generateSearchIndexQuality() {
  console.log('🔎 Generating search-index-quality.json ...');

  if (!fs.existsSync(SEARCH_INDEX_PATH)) {
    console.log('   ⚠️  Enhanced search index not found. Run build-search-index.sh first.');
    return null;
  }

  const searchIndex = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, 'utf-8'));
  const issues = [];

  // Patterns that indicate raw markdown leaking into search content
  const leakPatterns = [
    { pattern: /#{1,6}\s/, name: 'markdown-header', desc: 'Raw markdown header (#)' },
    { pattern: /\*\*[^*]+\*\*/, name: 'bold-syntax', desc: 'Raw bold syntax (**)' },
    { pattern: /```/, name: 'code-fence', desc: 'Raw code fence (```)' },
    { pattern: /:::/, name: 'callout-syntax', desc: 'Raw callout syntax (:::)' },
    { pattern: /\|[^|]+\|[^|]+\|/, name: 'table-syntax', desc: 'Raw table syntax (|)' },
    { pattern: /<wb-/, name: 'component-tag', desc: 'Angular component tag (<wb-)' },
    { pattern: /\{[^}]*title:/, name: 'code-metadata', desc: 'Code block metadata ({title:)' },
    { pattern: /\[([^\]]+)\]\(([^\)]+)\)/, name: 'link-syntax', desc: 'Raw link syntax [text](url)' },
    { pattern: /!\[/, name: 'image-syntax', desc: 'Raw image syntax (![)' }
  ];

  // Check all documents in the search index
  const docs = Array.isArray(searchIndex) ? searchIndex : (searchIndex.documents || searchIndex);

  for (const doc of docs) {
    const chunks = doc.chunks || [];
    for (const chunk of chunks) {
      const text = chunk.text || chunk.preview || '';
      const chunkIssues = [];

      for (const { pattern, name, desc } of leakPatterns) {
        if (pattern.test(text)) {
          chunkIssues.push({ pattern: name, desc });
        }
      }

      if (chunkIssues.length > 0) {
        issues.push({
          document: doc.slug || doc.title || doc.url,
          chunkId: chunk.id,
          preview: text.substring(0, 200),
          leaks: chunkIssues
        });
      }
    }
  }

  // Aggregate by pattern
  const patternCounts = {};
  for (const issue of issues) {
    for (const leak of issue.leaks) {
      patternCounts[leak.pattern] = (patternCounts[leak.pattern] || 0) + 1;
    }
  }

  const summary = {
    totalDocuments: docs.length,
    totalChunksWithIssues: issues.length,
    issuesByPattern: patternCounts,
    sampleIssues: issues.slice(0, 50) // First 50 for review
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'search-index-quality.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.totalChunksWithIssues} chunks have potential raw markdown leaks`);
  return summary;
}

// ─── Report 8: Stale Docs Candidates ────────────────────────────────────────

function generateStaleDocs() {
  console.log('📅 Generating stale-docs-candidates.json ...');

  if (!fs.existsSync(LIBRARY_PATH)) {
    console.log('   ⚠️  Library repo not found, skipping');
    return null;
  }

  if (!fs.existsSync(CODE_DOCS_MAP_PATH)) {
    console.log('   ⚠️  code-docs-map.json not found, skipping');
    return null;
  }

  const codeDocsMap = JSON.parse(fs.readFileSync(CODE_DOCS_MAP_PATH, 'utf-8'));

  // Build reverse map: source file -> [symbols with docs]
  const fileToSymbols = {};
  for (const [symbol, entry] of Object.entries(codeDocsMap)) {
    const file = entry.file;
    if (!fileToSymbols[file]) fileToSymbols[file] = [];
    fileToSymbols[file].push({ symbol, docs: entry.docs });
  }

  // Get recently changed files from library
  let changedFiles;
  try {
    const gitOutput = execSync(
      'git log --since="6 months ago" --name-only --pretty=format: -- src/',
      { cwd: LIBRARY_PATH, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    changedFiles = [...new Set(gitOutput.split('\n').filter(f => f.trim() && f.endsWith('.cs')))];
  } catch (e) {
    console.log(`   ⚠️  Git log failed: ${e.message}`);
    return null;
  }

  // Cross-reference
  const staleCandidates = [];
  for (const changedFile of changedFiles) {
    const symbols = fileToSymbols[changedFile];
    if (symbols) {
      staleCandidates.push({
        changedFile,
        symbols: symbols.map(s => s.symbol),
        affectedDocs: [...new Set(symbols.map(s => s.docs))]
      });
    }
  }

  // Deduplicate by affected docs
  const docsAffected = {};
  for (const candidate of staleCandidates) {
    for (const doc of candidate.affectedDocs) {
      if (!docsAffected[doc]) docsAffected[doc] = { changedFiles: [], symbols: [] };
      docsAffected[doc].changedFiles.push(candidate.changedFile);
      docsAffected[doc].symbols.push(...candidate.symbols);
    }
  }

  // Deduplicate symbols
  for (const doc of Object.values(docsAffected)) {
    doc.symbols = [...new Set(doc.symbols)];
    doc.changedFiles = [...new Set(doc.changedFiles)];
  }

  const summary = {
    recentlyChangedSourceFiles: changedFiles.length,
    potentiallyStaleDocPages: Object.keys(docsAffected).length,
    staleCandidates: Object.entries(docsAffected)
      .map(([doc, info]) => ({ docsPath: doc, changedFileCount: info.changedFiles.length, symbols: info.symbols, changedFiles: info.changedFiles }))
      .sort((a, b) => b.changedFileCount - a.changedFileCount)
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'stale-docs-candidates.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.potentiallyStaleDocPages} doc pages may be stale (${summary.recentlyChangedSourceFiles} source files changed in 6mo)`);
  return summary;
}

// ─── Report 9: Cross-Link Map ───────────────────────────────────────────────

function generateCrossLinkMap() {
  console.log('🔗 Generating cross-link-map.json ...');
  const mdFiles = findMarkdownFiles(DOCS_ROOT);
  const links = [];

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const rel = relPath(file);

    // Find all markdown links [text](path) — skip external URLs and images
    const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const linkText = match[1];
      const target = match[2];

      // Skip external links, anchors-only, and mailto
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#') || target.startsWith('mailto:')) continue;

      // Resolve relative to the file's directory
      const fileDir = path.dirname(file);
      const resolved = path.resolve(fileDir, target.split('#')[0]); // Strip anchor
      const resolvedRel = relPath(resolved);

      // Check if target exists
      const exists = fs.existsSync(resolved) ||
        fs.existsSync(resolved + '.md') ||
        fs.existsSync(path.join(resolved, '_folder.md')) ||
        fs.existsSync(path.join(resolved, path.basename(resolved) + '.md'));

      links.push({
        source: rel,
        target: target,
        resolvedPath: resolvedRel,
        linkText,
        valid: exists
      });
    }
  }

  const broken = links.filter(l => !l.valid);
  const summary = {
    totalInternalLinks: links.length,
    valid: links.length - broken.length,
    broken: broken.length,
    brokenLinks: broken,
    linksBySource: {}
  };

  for (const link of links) {
    if (!summary.linksBySource[link.source]) summary.linksBySource[link.source] = { valid: 0, broken: 0 };
    if (link.valid) summary.linksBySource[link.source].valid++;
    else summary.linksBySource[link.source].broken++;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'cross-link-map.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${summary.broken}/${summary.totalInternalLinks} internal links are broken`);
  return summary;
}

// ─── Report 10: Persona Coverage ────────────────────────────────────────────

function generatePersonaCoverage() {
  console.log('👥 Generating persona-coverage.json ...');

  // Map topic areas between user-dev (fundamentals/) and contributor (extending/) docs
  const fundamentalsDir = path.join(DOCS_ROOT, 'fundamentals');
  const extendingDir = path.join(DOCS_ROOT, 'extending');

  const fundamentalsTopics = fs.existsSync(fundamentalsDir) ? getTopicNames(fundamentalsDir) : [];
  const extendingTopics = fs.existsSync(extendingDir) ? getTopicNames(extendingDir) : [];

  // Also check operations/ and data/ as they serve both personas
  const operationsTopics = getTopicNames(path.join(DOCS_ROOT, 'operations'));
  const dataTopics = getTopicNames(path.join(DOCS_ROOT, 'data'));
  const messagingTopics = getTopicNames(path.join(DOCS_ROOT, 'messaging'));
  const apisTopics = getTopicNames(path.join(DOCS_ROOT, 'apis'));

  // Build a cross-reference: which fundamentals topics have extending counterparts?
  const crossRef = [];
  for (const topic of fundamentalsTopics) {
    const hasExtending = extendingTopics.some(e =>
      e.toLowerCase().includes(topic.toLowerCase()) ||
      topic.toLowerCase().includes(e.toLowerCase())
    );
    crossRef.push({
      topic,
      inFundamentals: true,
      inExtending: hasExtending,
      gap: !hasExtending ? 'Missing contributor docs' : null
    });
  }

  for (const topic of extendingTopics) {
    const hasFundamental = fundamentalsTopics.some(f =>
      f.toLowerCase().includes(topic.toLowerCase()) ||
      topic.toLowerCase().includes(f.toLowerCase())
    );
    if (!hasFundamental) {
      crossRef.push({
        topic,
        inFundamentals: false,
        inExtending: true,
        gap: 'Missing user-developer docs'
      });
    }
  }

  const gaps = crossRef.filter(c => c.gap);

  const summary = {
    fundamentalsTopicCount: fundamentalsTopics.length,
    extendingTopicCount: extendingTopics.length,
    operationsTopicCount: operationsTopics.length,
    dataTopicCount: dataTopics.length,
    messagingTopicCount: messagingTopics.length,
    apisTopicCount: apisTopics.length,
    crossReferenceGaps: gaps.length,
    crossReference: crossRef,
    allTopics: {
      fundamentals: fundamentalsTopics,
      extending: extendingTopics,
      operations: operationsTopics,
      data: dataTopics,
      messaging: messagingTopics,
      apis: apisTopics
    }
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'persona-coverage.json'), JSON.stringify(summary, null, 2));
  console.log(`   ${gaps.length} persona coverage gaps found`);
  return summary;
}

function getTopicNames(dir) {
  if (!fs.existsSync(dir)) return [];
  const topics = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      topics.push(entry.name);
    } else if (entry.name.endsWith('.md') && entry.name !== '_folder.md' && entry.name !== 'README.md') {
      topics.push(entry.name.replace('.md', ''));
    }
  }
  return topics;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Whizbang Documentation Audit Baseline Generator\n');
  console.log(`Docs root: ${DOCS_ROOT}`);
  console.log(`Library:   ${LIBRARY_PATH}`);
  console.log(`Output:    ${OUTPUT_DIR}/\n`);

  const results = {};

  results.frontmatterGaps = generateFrontmatterGaps();
  results.codeSamples = generateCodeSamplesInventory();
  results.undocumentedTypes = generateUndocumentedPublicTypes();
  results.brokenCodeDocsLinks = generateBrokenCodeDocsLinks();
  results.mermaidInventory = generateMermaidInventory();
  results.calloutInventory = generateCalloutInventory();
  results.searchIndexQuality = generateSearchIndexQuality();
  results.staleDocs = generateStaleDocs();
  results.crossLinks = generateCrossLinkMap();
  results.personaCoverage = generatePersonaCoverage();

  // Write summary
  const executiveSummary = {
    generatedAt: new Date().toISOString(),
    docsRoot: DOCS_ROOT,
    libraryPath: LIBRARY_PATH,
    highlights: {
      totalPages: results.frontmatterGaps?.totalPages || 0,
      pagesWithFrontmatterGaps: results.frontmatterGaps?.pagesWithGaps || 0,
      totalCodeSamples: results.codeSamples?.totalSamples || 0,
      codeSamplesWithoutMetadata: results.codeSamples?.withoutMetadata || 0,
      undocumentedPublicTypes: results.undocumentedTypes?.undocumented || 0,
      brokenCodeDocsLinks: results.brokenCodeDocsLinks?.broken || 0,
      totalMermaidDiagrams: results.mermaidInventory?.totalDiagrams || 0,
      unclosedCallouts: results.calloutInventory?.unclosed || 0,
      searchChunksWithMarkdownLeaks: results.searchIndexQuality?.totalChunksWithIssues || 0,
      potentiallyStalePages: results.staleDocs?.potentiallyStaleDocPages || 0,
      brokenInternalLinks: results.crossLinks?.broken || 0,
      personaCoverageGaps: results.personaCoverage?.crossReferenceGaps || 0
    },
    reports: [
      'frontmatter-gaps.json',
      'code-samples-inventory.json',
      'undocumented-public-types.json',
      'broken-code-docs-links.json',
      'mermaid-inventory.json',
      'callout-inventory.json',
      'search-index-quality.json',
      'stale-docs-candidates.json',
      'cross-link-map.json',
      'persona-coverage.json'
    ]
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'audit-summary.json'), JSON.stringify(executiveSummary, null, 2));

  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 AUDIT BASELINE SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  for (const [key, value] of Object.entries(executiveSummary.highlights)) {
    const label = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    console.log(`  ${label}: ${value}`);
  }
  console.log('═══════════════════════════════════════════════════');
  console.log(`\nAll reports written to ${OUTPUT_DIR}/`);
}

main().catch(console.error);
