#!/usr/bin/env node

import { readFileSync } from 'fs';

const map = JSON.parse(readFileSync('src/assets/code-tests-map.json', 'utf-8'));

// Get symbols that need tags (convention-only)
const needsTags = [];

for (const [symbol, tests] of Object.entries(map.codeToTests)) {
  const hasXmlTag = tests.some(t => t.linkSource === 'XmlTag');
  if (!hasXmlTag) {
    // Get source file from testsToCode mapping
    const firstTest = tests[0];
    const testKey = `${firstTest.testClass}.${firstTest.testMethod}`;
    const codeEntries = map.testsToCode[testKey] || [];
    const sourceFile = codeEntries.find(c => c.sourceSymbol === symbol)?.sourceFile;

    needsTags.push({
      symbol,
      testCount: tests.length,
      sourceFile: sourceFile || 'UNKNOWN',
      tests: tests.map(t => `${t.testFile}:${t.testMethod}`)
    });
  }
}

// Sort by file for easier processing
needsTags.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));

console.log(`Classes needing test tags: ${needsTags.length}\n`);
console.log('Grouped by file:\n');

let currentFile = '';
needsTags.forEach(item => {
  if (item.sourceFile !== currentFile) {
    currentFile = item.sourceFile;
    console.log(`\n📁 ${currentFile}`);
  }
  console.log(`   ✓ ${item.symbol} (${item.testCount} tests)`);
});

// Also output JSON for programmatic use
console.log('\n\n=== JSON OUTPUT ===\n');
console.log(JSON.stringify(needsTags, null, 2));
