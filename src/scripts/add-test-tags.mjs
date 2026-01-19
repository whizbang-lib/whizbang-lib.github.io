#!/usr/bin/env node

/**
 * Automated Test Tag Addition Script
 *
 * Reads code-tests-map.json and adds <tests> XML tags to all library source files
 * that have associated test methods.
 *
 * Usage:
 *   node src/scripts/add-test-tags.mjs
 *
 * Process:
 * 1. Load code-tests-map.json
 * 2. For each code symbol with tests:
 *    - Find the source file
 *    - Locate the class/interface/enum declaration
 *    - Find insertion point (after <summary> and <docs> tags)
 *    - Insert all <tests> tags (one per test method)
 * 3. Write modified files back
 * 4. Report summary
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
 * Find insertion point for <tests> tags in source code
 * Returns { line: number, indentation: string } or null if not found
 */
function findInsertionPoint(lines, symbolName) {
  // Look for class/interface/record/enum declaration
  const symbolPattern = new RegExp(
    `^(\\s*)(?:public|internal|protected)?\\s*(?:sealed|abstract|static|partial)?\\s*(?:class|interface|record|enum|struct)\\s+${symbolName}\\b`,
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (symbolPattern.test(line)) {
      // Found declaration line
      // Look backwards to find the end of XML docs (after /// <summary>, /// <docs>, etc.)
      let insertLine = i;
      let indentation = '///';

      // Scan backwards to find last XML doc comment before declaration
      for (let j = i - 1; j >= 0; j--) {
        const prevLine = lines[j].trim();

        if (prevLine.startsWith('///')) {
          // This is an XML doc line
          insertLine = j + 1; // Insert after this line

          // Extract indentation
          const match = lines[j].match(/^(\s*\/\/\/)/);
          if (match) {
            indentation = match[1];
          }
        } else if (prevLine === '' || prevLine.startsWith('[')) {
          // Empty line or attribute - keep going
          continue;
        } else {
          // Non-XML line - stop here
          break;
        }
      }

      return { line: insertLine, indentation };
    }
  }

  return null;
}

/**
 * Check if source file already has <tests> tags for this symbol
 */
function hasExistingTestTags(lines, symbolName) {
  // Look for any /// <tests> tags near the symbol declaration
  const symbolPattern = new RegExp(
    `^\\s*(?:public|internal|protected)?\\s*(?:sealed|abstract|static|partial)?\\s*(?:class|interface|record|enum|struct)\\s+${symbolName}\\b`,
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    if (symbolPattern.test(lines[i])) {
      // Found declaration - check preceding lines for <tests> tags
      for (let j = i - 1; j >= 0 && j >= i - 20; j--) {
        if (lines[j].includes('<tests>')) {
          return true;
        }
        // Stop at non-XML comment line
        if (!lines[j].trim().startsWith('///') && lines[j].trim() !== '' && !lines[j].trim().startsWith('[')) {
          break;
        }
      }
      return false;
    }
  }

  return false;
}

/**
 * Add test tags to a source file
 */
async function addTestTagsToFile(filePath, symbolName, tests) {
  console.log(`\n📝 Processing: ${path.relative(LIBRARY_ROOT, filePath)}`);
  console.log(`   Symbol: ${symbolName}, Tests: ${tests.length}`);

  // Read file
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check if already has tags
  if (hasExistingTestTags(lines, symbolName)) {
    console.log(`   ⏭️  Skipping - already has <tests> tags`);
    return { modified: false };
  }

  // Find insertion point
  const insertion = findInsertionPoint(lines, symbolName);

  if (!insertion) {
    console.log(`   ⚠️  Warning - Could not find declaration for ${symbolName}`);
    return { modified: false };
  }

  // Build test tags
  const testTags = tests.map(test => {
    const testReference = `${test.testFile}:${test.testMethod}`;
    return `${insertion.indentation} <tests>${testReference}</tests>`;
  });

  console.log(`   ✅ Adding ${testTags.length} test tags at line ${insertion.line + 1}`);

  // Insert tags
  lines.splice(insertion.line, 0, ...testTags);

  // Write back
  const newContent = lines.join('\n');
  await fs.writeFile(filePath, newContent, 'utf-8');

  return { modified: true, tagsAdded: testTags.length };
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting automated test tag addition...\n');

  // Load mapping
  console.log('📂 Loading code-tests-map.json...');
  const mapping = await loadCodeTestsMap();

  const { codeToTests, testsToCode, metadata } = mapping;

  console.log(`✅ Loaded mapping: ${metadata.codeSymbols} symbols, ${metadata.testMethods} tests\n`);

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
  console.log(`✅ Found source files for ${Object.keys(symbolToSourceFile).length} symbols\n`);

  // Statistics
  let filesModified = 0;
  let tagsAdded = 0;
  let filesSkipped = 0;
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
      console.log(`\n⚠️  Warning - No source file found for symbol: ${symbol}`);
      errors++;
      continue;
    }

    const filePath = path.join(LIBRARY_ROOT, sourceFile);

    try {
      // Check if file exists
      await fs.access(filePath);

      // Add tags
      const result = await addTestTagsToFile(filePath, symbol, tests);

      if (result.modified) {
        filesModified++;
        tagsAdded += result.tagsAdded || 0;
      } else {
        filesSkipped++;
      }

    } catch (error) {
      console.log(`   ❌ Error processing ${symbol}: ${error.message}`);
      errors++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Files modified: ${filesModified}`);
  console.log(`   Files skipped: ${filesSkipped}`);
  console.log(`   Total tags added: ${tagsAdded}`);
  console.log(`   Errors: ${errors}`);
  console.log('='.repeat(60));

  if (filesModified > 0) {
    console.log('\n✅ Test tags added successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Run: cd /Users/philcarbone/src/whizbang && dotnet format');
    console.log('   2. Verify changes look correct');
    console.log('   3. Run: cd /Users/philcarbone/src/whizbang-lib.github.io && node src/scripts/generate-code-tests-map.mjs');
    console.log('   4. Check that linkSource shows "XmlTag" for added tags');
  } else {
    console.log('\n⚠️  No files were modified. All symbols may already have tags.');
  }
}

// Run
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
