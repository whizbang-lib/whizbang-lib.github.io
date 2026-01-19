#!/usr/bin/env node

/**
 * Generates a code-to-docs mapping by scanning the Whizbang library source code
 * for <docs> tags in XML documentation comments.
 *
 * Output: src/assets/code-docs-map.json
 *
 * Format:
 * {
 *   "IDispatcher": {
 *     "file": "src/Whizbang.Core/IDispatcher.cs",
 *     "line": 14,
 *     "symbol": "IDispatcher",
 *     "docs": "core-concepts/dispatcher"
 *   },
 *   ...
 * }
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurable via environment variable, defaults to sibling directory
const LIBRARY_PATH = process.env.WHIZBANG_LIB_PATH || resolve(__dirname, '../../../whizbang');
const OUTPUT_PATH = resolve(__dirname, '../assets/code-docs-map.json');

/**
 * Scans a C# file for <docs> tags and extracts code-docs mapping
 */
function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const mappings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for <docs> tag
    const docsMatch = line.match(/<docs>(.*?)<\/docs>/);
    if (!docsMatch) continue;

    const docsUrl = docsMatch[1];

    // Find the symbol name on the next line(s)
    let symbolName = null;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const nextLine = lines[j];

      // Match interface/class/struct/record/enum declarations
      const symbolMatch = nextLine.match(/(?:public|internal|private|protected)?\s*(?:interface|class|struct|record|enum)\s+(\w+)/);
      if (symbolMatch) {
        symbolName = symbolMatch[1];
        break;
      }

      // Match property/method declarations (fallback)
      const memberMatch = nextLine.match(/(?:public|internal|private|protected)?\s*\w+\s+(\w+)\s*[({]/);
      if (memberMatch) {
        symbolName = memberMatch[1];
        break;
      }
    }

    if (!symbolName) {
      console.warn(`Warning: Found <docs> tag at ${filePath}:${i + 1} but couldn't extract symbol name`);
      continue;
    }

    mappings.push({
      file: relative(LIBRARY_PATH, filePath).replace(/\\/g, '/'),
      line: i + 1,
      symbol: symbolName,
      docs: docsUrl
    });
  }

  return mappings;
}

/**
 * Main execution
 */
async function main() {
  console.log('Scanning Whizbang library for <docs> tags...');
  console.log(`Library path: ${LIBRARY_PATH}`);

  // Find all C# source files (excluding Generated, obj, bin)
  const pattern = join(LIBRARY_PATH, 'src/**/*.cs');
  const files = await glob(pattern, {
    ignore: [
      '**/obj/**',
      '**/bin/**',
      '**/Generated/**',
      '**/*.g.cs',
      '**/*.designer.cs'
    ]
  });

  console.log(`Found ${files.length} C# files to scan`);

  // Scan all files
  const allMappings = [];
  for (const file of files) {
    const mappings = scanFile(file);
    allMappings.push(...mappings);
  }

  console.log(`Extracted ${allMappings.length} code-docs mappings`);

  // Convert to dictionary keyed by symbol name
  const mappingDict = {};
  for (const mapping of allMappings) {
    if (mappingDict[mapping.symbol]) {
      console.warn(`Warning: Duplicate symbol "${mapping.symbol}" found. Using first occurrence.`);
      continue;
    }
    mappingDict[mapping.symbol] = mapping;
  }

  // Write output
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(mappingDict, null, 2),
    'utf-8'
  );

  console.log(`\nCode-docs map written to: ${OUTPUT_PATH}`);
  console.log(`Total mappings: ${Object.keys(mappingDict).length}`);

  // Summary
  const docUrls = [...new Set(allMappings.map(m => m.docs))];
  console.log(`\nUnique documentation URLs: ${docUrls.length}`);
  console.log('Documentation URLs:');
  docUrls.sort().forEach(url => console.log(`  - ${url}`));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
