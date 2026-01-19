#!/usr/bin/env node

/**
 * Comprehensive Test Tag Placement Fix Script
 *
 * This script systematically:
 * 1. Removes all existing <tests> tags from library files
 * 2. Re-adds them in the correct location (after </summary>, before class/interface)
 * 3. Validates each placement
 *
 * Usage:
 *   node src/scripts/fix-test-tag-placement.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const REPO_ROOT = path.resolve(__dirname, '../..');
const LIBRARY_ROOT = '/Users/philcarbone/src/whizbang';
const CODE_TESTS_MAP_PATH = path.join(REPO_ROOT, 'src/assets/code-tests-map.json');

/**
 * Load code-tests mapping file
 */
async function loadCodeTestsMap() {
  const content = await fs.readFile(CODE_TESTS_MAP_PATH, 'utf-8');
  return JSON.parse(content);
}

/**
 * Remove all existing <tests> tags from a file
 */
function removeExistingTestTags(content) {
  const lines = content.split('\n');
  const filtered = lines.filter(line => !line.includes('<tests>'));
  return filtered.join('\n');
}

/**
 * Find the correct insertion point for test tags
 * Should be:
 * 1. After closing </summary> tag
 * 2. Before any attributes ([Generator], [Attribute], etc.)
 * 3. Before class/interface declaration
 */
function findCorrectInsertionPoint(lines, symbolName) {
  // First, find the class/interface declaration
  const declPattern = new RegExp(
    `^\\s*(?:\\[\\w+.*?\\]\\s*)*(?:public|internal|protected)?\\s*(?:sealed|abstract|static|partial)?\\s*(?:class|interface|record|enum|struct)\\s+${symbolName}\\b`,
    'i'
  );

  let declarationLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (declPattern.test(lines[i])) {
      declarationLine = i;
      break;
    }
  }

  if (declarationLine === -1) {
    return null; // Couldn't find declaration
  }

  // Now scan backwards from declaration to find insertion point
  let insertionLine = declarationLine;
  let indentation = '///';

  // Scan backwards to find the end of XML documentation
  for (let i = declarationLine - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Found closing </summary> tag - insert after this
    if (line === '</summary>') {
      insertionLine = i + 1;
      const match = lines[i].match(/^(\\s*\/\/\/)/);
      if (match) {
        indentation = match[1];
      }
      break;
    }

    // Skip attributes and empty lines
    if (line.startsWith('[') || line === '') {
      continue;
    }

    // If we hit non-XML, non-attribute content, stop
    if (!line.startsWith('///') && !line.startsWith('[')) {
      break;
    }
  }

  return { line: insertionLine, indentation, declarationLine };
}

/**
 * Process a single source file: remove old tags, add new ones correctly
 */
async function fixTestTagsInFile(filePath, symbolName, tests) {
  console.log(`\\n📝 Processing: ${path.relative(LIBRARY_ROOT, filePath)}`);
  console.log(`   Symbol: ${symbolName}, Tests: ${tests.length}`);

  // Read file
  let content = await fs.readFile(filePath, 'utf-8');

  // Step 1: Remove all existing <tests> tags
  const originalLines = content.split('\\n').length;
  content = removeExistingTestTags(content);
  const afterRemoval = content.split('\\n').length;
  const removedCount = originalLines - afterRemoval;

  if (removedCount > 0) {
    console.log(`   🗑️  Removed ${removedCount} old test tag(s)`);
  }

  const lines = content.split('\\n');

  // Step 2: Find correct insertion point
  const insertion = findCorrectInsertionPoint(lines, symbolName);

  if (!insertion) {
    console.log(`   ⚠️  Warning - Could not find declaration for ${symbolName}`);
    return { modified: false, error: 'NoDeclaration' };
  }

  console.log(`   📍 Found declaration at line ${insertion.declarationLine + 1}`);
  console.log(`   ✅ Inserting ${tests.length} test tags at line ${insertion.line + 1}`);

  // Step 3: Build test tags
  const testTags = tests.map(test => {
    const testReference = `${test.testFile}:${test.testMethod}`;
    return `${insertion.indentation} <tests>${testReference}</tests>`;
  });

  // Step 4: Insert tags at correct location
  lines.splice(insertion.line, 0, ...testTags);

  // Step 5: Write back
  const newContent = lines.join('\\n');
  await fs.writeFile(filePath, newContent, 'utf-8');

  return {
    modified: true,
    tagsAdded: testTags.length,
    tagsRemoved: removedCount
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting comprehensive test tag placement fix...\\n');

  // Load mapping
  console.log('📂 Loading code-tests-map.json...');
  const mapping = await loadCodeTestsMap();

  const { codeToTests, testsToCode, metadata } = mapping;

  console.log(`✅ Loaded mapping: ${metadata.codeSymbols} symbols, ${metadata.testMethods} tests\\n`);

  // Build symbol-to-sourceFile lookup from testsToCode
  console.log('📋 Building symbol-to-sourceFile lookup...');
  const symbolToSourceFile = {};
  for (const testKey of Object.keys(testsToCode)) {
    const codeEntries = testsToCode[testKey];
    for (const entry of codeEntries) {
      if (!symbolToSourceFile[entry.sourceSymbol]) {
        symbolToSourceFile[entry.sourceSymbol] = entry.sourceFile;
      }
    }
  }
  console.log(`✅ Found source files for ${Object.keys(symbolToSourceFile).length} symbols\\n`);

  // Statistics
  let filesProcessed = 0;
  let tagsAdded = 0;
  let tagsRemoved = 0;
  let errors = 0;

  // Process each symbol
  const symbols = Object.keys(codeToTests);

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const tests = codeToTests[symbol];

    if (!tests || tests.length === 0) {
      continue;
    }

    // Get source file from lookup
    const sourceFile = symbolToSourceFile[symbol];
    if (!sourceFile) {
      console.log(`\\n⚠️  Warning - No source file found for symbol: ${symbol}`);
      errors++;
      continue;
    }

    const filePath = path.join(LIBRARY_ROOT, sourceFile);

    try {
      // Check if file exists
      await fs.access(filePath);

      // Fix tags
      const result = await fixTestTagsInFile(filePath, symbol, tests);

      if (result.modified) {
        filesProcessed++;
        tagsAdded += result.tagsAdded || 0;
        tagsRemoved += result.tagsRemoved || 0;
      } else {
        errors++;
      }

    } catch (error) {
      console.log(`   ❌ Error processing ${symbol}: ${error.message}`);
      errors++;
    }
  }

  // Summary
  console.log('\\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Files processed: ${filesProcessed}`);
  console.log(`   Tags removed (old): ${tagsRemoved}`);
  console.log(`   Tags added (new): ${tagsAdded}`);
  console.log(`   Errors: ${errors}`);
  console.log('='.repeat(60));

  if (filesProcessed > 0) {
    console.log('\\n✅ Test tag placement fixed successfully!');
    console.log('\\n📋 Next steps:');
    console.log('   1. Run: cd /Users/philcarbone/src/whizbang && dotnet format');
    console.log('   2. Run: cd /Users/philcarbone/src/whizbang-lib.github.io && node src/scripts/generate-code-tests-map.mjs');
    console.log('   3. Verify linkSource shows "XmlTag" for all tags');
  } else {
    console.log('\\n⚠️  No files were processed.');
  }
}

// Run
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
