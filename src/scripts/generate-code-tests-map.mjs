#!/usr/bin/env node

/**
 * Generates a bidirectional code-to-tests mapping by scanning both:
 * 1. Library source code for <tests> tags in XML documentation comments
 * 2. Test projects for naming conventions and semantic analysis
 *
 * Output: src/assets/code-tests-map.json
 *
 * Format:
 * {
 *   "codeToTests": {
 *     "IDispatcher": [{
 *       "testFile": "tests/Whizbang.Core.Tests/DispatcherTests.cs",
 *       "testLine": 42,
 *       "testMethod": "Dispatcher_Send_RoutesToCorrectReceptorAsync",
 *       "testClass": "DispatcherTests",
 *       "linkSource": "Convention"
 *     }]
 *   },
 *   "testsToCode": {
 *     "DispatcherTests.Dispatcher_Send_RoutesToCorrectReceptorAsync": [{
 *       "sourceFile": "src/Whizbang.Core/IDispatcher.cs",
 *       "sourceLine": 14,
 *       "sourceSymbol": "IDispatcher",
 *       "sourceType": "Interface"
 *     }]
 *   }
 * }
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, relative, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurable via environment variable, defaults to sibling directory
const LIBRARY_PATH = process.env.WHIZBANG_LIB_PATH || resolve(__dirname, '../../../whizbang');
const OUTPUT_PATH = resolve(__dirname, '../assets/code-tests-map.json');

/**
 * Scans a C# source file for <tests> tags and extracts manual code-tests mappings
 */
function scanSourceFileForTestTags(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const mappings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for <tests> tag
    const testsMatch = line.match(/<tests>(.*?)<\/tests>/);
    if (!testsMatch) continue;

    const testsPath = testsMatch[1]; // Format: "TestProject/TestFile.cs:TestMethodName"

    // Parse test path
    const parts = testsPath.split(':');
    if (parts.length !== 2) {
      console.warn(`Warning: Invalid <tests> tag format at ${filePath}:${i + 1}. Expected "TestFile.cs:TestMethod"`);
      continue;
    }

    const [testFilePath, testMethodName] = parts;

    // Find the symbol name on the next line(s)
    let sourceSymbol = null;
    let sourceType = null;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const nextLine = lines[j];

      // Match interface/class/struct/record/enum declarations
      const typeMatch = nextLine.match(/(?:public|internal|private|protected)?\s*(interface|class|struct|record|enum)\s+(\w+)/);
      if (typeMatch) {
        sourceType = typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1); // Capitalize
        sourceSymbol = typeMatch[2];
        break;
      }

      // Match method declarations
      const methodMatch = nextLine.match(/(?:public|internal|private|protected)?\s*(?:async\s+)?(?:Task|void|[\w<>]+)\s+(\w+)\s*[(<]/);
      if (methodMatch) {
        sourceType = 'Method';
        sourceSymbol = methodMatch[1];
        break;
      }

      // Match property declarations
      const propertyMatch = nextLine.match(/(?:public|internal|private|protected)?\s*(\w+)\s+(\w+)\s*\{/);
      if (propertyMatch) {
        sourceType = 'Property';
        sourceSymbol = propertyMatch[2];
        break;
      }
    }

    if (!sourceSymbol) {
      console.warn(`Warning: Found <tests> tag at ${filePath}:${i + 1} but couldn't extract symbol name`);
      continue;
    }

    mappings.push({
      sourceFile: relative(LIBRARY_PATH, filePath).replace(/\\/g, '/'),
      sourceLine: i + 1,
      sourceSymbol,
      sourceType,
      testFile: testFilePath,
      testMethod: testMethodName,
      linkSource: 'XmlTag'
    });
  }

  return mappings;
}

/**
 * Scans a test file to discover what code it tests via naming conventions
 */
function scanTestFileForConventions(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const mappings = [];

  // Extract test class name from file
  const testClassMatch = content.match(/(?:public\s+)?class\s+(\w+Tests?)/);
  if (!testClassMatch) {
    return mappings; // Not a test class
  }

  const testClassName = testClassMatch[1];

  // Derive the class under test from the test class name
  // e.g., "DispatcherTests" -> "Dispatcher"
  const classUnderTest = testClassName.replace(/Tests?$/, '');

  // Find all test methods
  const testMethodRegex = /\[Test\][\s\S]*?(?:public\s+)?(?:async\s+)?Task\s+(\w+)\s*\(/g;
  let match;
  while ((match = testMethodRegex.exec(content)) !== null) {
    const testMethodName = match[1];

    // Find line number of this test method
    const upToMatch = content.substring(0, match.index);
    const testLine = upToMatch.split('\n').length;

    mappings.push({
      testFile: relative(LIBRARY_PATH, filePath).replace(/\\/g, '/'),
      testLine,
      testMethod: testMethodName,
      testClass: testClassName,
      classUnderTest,
      linkSource: 'Convention'
    });
  }

  return mappings;
}

/**
 * Builds bidirectional mapping from code-to-tests and tests-to-code
 */
function buildBidirectionalMapping(sourceTagMappings, testConventionMappings, sourceFiles) {
  const codeToTests = {};
  const testsToCode = {};

  // Process XML tag mappings (explicit links)
  for (const mapping of sourceTagMappings) {
    // Add to code-to-tests
    if (!codeToTests[mapping.sourceSymbol]) {
      codeToTests[mapping.sourceSymbol] = [];
    }
    codeToTests[mapping.sourceSymbol].push({
      testFile: mapping.testFile,
      testMethod: mapping.testMethod,
      linkSource: mapping.linkSource
    });

    // Add to tests-to-code
    const testKey = `${basename(mapping.testFile, '.cs')}.${mapping.testMethod}`;
    if (!testsToCode[testKey]) {
      testsToCode[testKey] = [];
    }
    testsToCode[testKey].push({
      sourceFile: mapping.sourceFile,
      sourceLine: mapping.sourceLine,
      sourceSymbol: mapping.sourceSymbol,
      sourceType: mapping.sourceType,
      linkSource: mapping.linkSource
    });
  }

  // Process convention-based mappings
  for (const mapping of testConventionMappings) {
    // Try to find the source file for the class under test
    const potentialFiles = sourceFiles.filter(f => {
      const fileName = basename(f, '.cs');
      return fileName === mapping.classUnderTest ||
             fileName === `I${mapping.classUnderTest}` || // Interface
             fileName.includes(mapping.classUnderTest);
    });

    if (potentialFiles.length === 0) {
      // No matching source file found - this is okay for convention-based linking
      continue;
    }

    // Use the first matching file (could be improved with semantic analysis)
    const sourceFile = potentialFiles[0];

    // Add to code-to-tests
    if (!codeToTests[mapping.classUnderTest]) {
      codeToTests[mapping.classUnderTest] = [];
    }

    // Avoid duplicates
    const exists = codeToTests[mapping.classUnderTest].some(t =>
      t.testFile === mapping.testFile && t.testMethod === mapping.testMethod
    );

    if (!exists) {
      codeToTests[mapping.classUnderTest].push({
        testFile: mapping.testFile,
        testMethod: mapping.testMethod,
        testLine: mapping.testLine,
        testClass: mapping.testClass,
        linkSource: mapping.linkSource
      });
    }

    // Add to tests-to-code
    const testKey = `${mapping.testClass}.${mapping.testMethod}`;
    if (!testsToCode[testKey]) {
      testsToCode[testKey] = [];
    }

    // Avoid duplicates
    const existsReverse = testsToCode[testKey].some(c =>
      c.sourceFile === relative(LIBRARY_PATH, sourceFile).replace(/\\/g, '/')
    );

    if (!existsReverse) {
      testsToCode[testKey].push({
        sourceFile: relative(LIBRARY_PATH, sourceFile).replace(/\\/g, '/'),
        sourceSymbol: mapping.classUnderTest,
        sourceType: 'Class', // Convention-based, assume class
        linkSource: mapping.linkSource
      });
    }
  }

  return { codeToTests, testsToCode };
}

/**
 * Main execution
 */
async function main() {
  console.log('Generating code-tests mapping for Whizbang library...');
  console.log(`Library path: ${LIBRARY_PATH}\n`);

  // Step 1: Find all C# source files (excluding Generated, obj, bin, tests)
  console.log('Step 1: Scanning source files for <tests> tags...');
  const sourcePattern = join(LIBRARY_PATH, 'src/**/*.cs');
  const sourceFiles = await glob(sourcePattern, {
    ignore: [
      '**/obj/**',
      '**/bin/**',
      '**/Generated/**',
      '**/*.g.cs',
      '**/*.designer.cs'
    ]
  });
  console.log(`Found ${sourceFiles.length} source files`);

  // Extract mappings from <tests> tags
  const sourceTagMappings = [];
  for (const file of sourceFiles) {
    const mappings = scanSourceFileForTestTags(file);
    sourceTagMappings.push(...mappings);
  }
  console.log(`Extracted ${sourceTagMappings.length} <tests> tag mappings\n`);

  // Step 2: Find all test files
  console.log('Step 2: Scanning test files for naming conventions...');
  const testPattern = join(LIBRARY_PATH, 'tests/**/*.cs');
  const testFiles = await glob(testPattern, {
    ignore: [
      '**/obj/**',
      '**/bin/**',
      '**/*.g.cs',
      '**/*.designer.cs'
    ]
  });
  console.log(`Found ${testFiles.length} test files`);

  // Extract mappings from test file naming conventions
  const testConventionMappings = [];
  for (const file of testFiles) {
    const mappings = scanTestFileForConventions(file);
    testConventionMappings.push(...mappings);
  }
  console.log(`Extracted ${testConventionMappings.length} convention-based test mappings\n`);

  // Step 3: Build bidirectional mapping
  console.log('Step 3: Building bidirectional mapping...');
  const { codeToTests, testsToCode } = buildBidirectionalMapping(
    sourceTagMappings,
    testConventionMappings,
    sourceFiles
  );

  const mapping = {
    codeToTests,
    testsToCode,
    metadata: {
      generated: new Date().toISOString(),
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      totalLinks: Object.keys(codeToTests).length + Object.keys(testsToCode).length,
      codeSymbols: Object.keys(codeToTests).length,
      testMethods: Object.keys(testsToCode).length
    }
  };

  // Step 4: Write output
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(mapping, null, 2),
    'utf-8'
  );

  console.log(`\nCode-tests map written to: ${OUTPUT_PATH}`);
  console.log(`Total code symbols with tests: ${Object.keys(codeToTests).length}`);
  console.log(`Total test methods: ${Object.keys(testsToCode).length}`);

  // Summary by link source
  const xmlTagCount = sourceTagMappings.length;
  const conventionCount = testConventionMappings.length;
  console.log(`\nLink sources:`);
  console.log(`  - XML tags:    ${xmlTagCount}`);
  console.log(`  - Conventions: ${conventionCount}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
