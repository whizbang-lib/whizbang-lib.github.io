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

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
// Node >=22 ships glob in fs/promises — avoids an undeclared 'glob' package dependency.
import { glob as fsGlob } from 'fs/promises';
async function glob(pattern, opts = {}) {
  const out = [];
  for await (const entry of fsGlob(pattern, { exclude: opts.ignore ?? [] })) out.push(entry);
  return out;
}

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

    const testsPath = testsMatch[1]; // Format: "TestProject/TestFile.cs:TestMethodName" or "TestProject/TestFile.cs"

    // Parse test path. A method-level tag names one test; a file-level tag names a whole test class,
    // which links every [Test] method in that file (the class under test often has no name-convention
    // twin, e.g. a scenario class like "WorkCoordinatorGatePrecedenceTests").
    const parts = testsPath.split(':');
    let targets;
    if (parts.length === 2) {
      targets = [{ testFile: parts[0], testMethod: parts[1] }];
    } else if (parts.length === 1 && testsPath.endsWith('.cs')) {
      targets = testMethodsInFile(testsPath);
      if (targets.length === 0) {
        console.warn(`Warning: <tests> tag at ${filePath}:${i + 1} names ${testsPath}, which has no [Test] methods or does not exist`);
        continue;
      }
    } else {
      console.warn(`Warning: Invalid <tests> tag format at ${filePath}:${i + 1}. Expected "TestFile.cs:TestMethod" or "TestFile.cs"`);
      continue;
    }

    // Find the symbol name on the first code line after the tag. The rest of the doc comment (a
    // member may carry many tags) and any attributes between the tag and the declaration are skipped;
    // a five-line window used to miss members with more than a handful of tags.
    let sourceSymbol = null;
    let sourceType = null;
    for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
      const nextLine = lines[j];
      const trimmed = nextLine.trim();
      if (trimmed.length === 0 || trimmed.startsWith('///') || trimmed.startsWith('[') || trimmed.startsWith('#pragma')) {
        continue;
      }

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

      // The first code line decides; an unrelated later declaration must not be attributed.
      break;
    }

    if (!sourceSymbol) {
      console.warn(`Warning: Found <tests> tag at ${filePath}:${i + 1} but couldn't extract symbol name`);
      continue;
    }

    for (const target of targets) {
      mappings.push({
        sourceFile: relative(LIBRARY_PATH, filePath).replace(/\\/g, '/'),
        sourceLine: i + 1,
        sourceSymbol,
        sourceType,
        testFile: target.testFile,
        testMethod: target.testMethod,
        linkSource: 'XmlTag'
      });
    }
  }

  return mappings;
}

/**
 * Every [Test] method in a test file named by a file-level <tests> tag, as {testFile, testMethod}.
 * An empty list when the file is missing (the warning is the caller's).
 */
function testMethodsInFile(testFilePath) {
  const fullPath = resolve(LIBRARY_PATH, testFilePath);
  if (!existsSync(fullPath)) {
    return [];
  }
  const content = readFileSync(fullPath, 'utf-8');
  const regex = /\[Test\][\s\S]*?(?:public\s+)?(?:async\s+)?Task\s+(\w+)\s*\(/g;
  const targets = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    targets.push({ testFile: testFilePath, testMethod: match[1] });
  }
  return targets;
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
 * Link health: a <tests> target can exist and still verify nothing. Three shapes are flagged, each with the
 * live example that motivated it (issue 742):
 *   - dormantContract: the target's declaring class is abstract and no class in the test tree inherits it, so
 *     its tests never execute (a contract class whose live copies were hand-copied instead of inherited).
 *   - selfContained: the target's file references no type declared under src/, so it exercises only its own
 *     doubles (a file that tested a fake declared at the bottom of the same file).
 *   - assertionFree: the target method's body contains no assertion, so it pins nothing.
 * Every finding names the source tag that points at it, so the fix is one edit away from the report.
 */
function assessLinkHealth(sourceTagMappings, testFiles, sourceFiles) {
  const findings = [];
  const testFileByRelative = new Map(testFiles.map(f => [relative(LIBRARY_PATH, f).replace(/\\/g, '/'), f]));
  const testContents = new Map();
  const contentOf = (relPath) => {
    if (!testContents.has(relPath)) {
      const full = testFileByRelative.get(relPath) ?? resolve(LIBRARY_PATH, relPath);
      testContents.set(relPath, existsSync(full) ? _codeOnly(readFileSync(full, 'utf-8')) : null);
    }
    return testContents.get(relPath);
  };
  // Every concrete type (class, struct, record, enum) and every static method declared under src/, for the
  // self-contained check. Interfaces are left out on purpose: a file that only implements a src interface with
  // its own fake is exactly the shape being flagged.
  const sourceTypeNames = new Set();
  const sourceStaticMethods = new Set();
  for (const file of sourceFiles) {
    const content = _codeOnly(readFileSync(file, 'utf-8'));
    for (const m of content.matchAll(/(?:^|\s)(?:public|internal)\s+(?:static\s+|abstract\s+|sealed\s+|partial\s+|readonly\s+|ref\s+)*(?:class|struct|enum|record(?:\s+struct|\s+class)?)\s+(\w+)/g)) {
      sourceTypeNames.add(m[1]);
    }
    for (const m of content.matchAll(/\bpublic\s+static\s+[\w<>\[\],.?\s]+?\s(\w+)\s*(?:<[^>]*>)?\s*\(/g)) {
      sourceStaticMethods.add(m[1]);
    }
  }
  // Every base a test-tree class inherits, for the dormant-contract check (string literals already stripped,
  // so a generator test's embedded source does not count).
  const inheritedBases = new Set();
  for (const file of testFiles) {
    const content = _codeOnly(readFileSync(file, 'utf-8'));
    for (const m of content.matchAll(/\bclass\s+\w+\s*(?:<[^>]*>)?\s*:\s*([\w.]+)/g)) {
      inheritedBases.add(m[1].split('.').pop());
    }
  }
  const seen = new Set();
  for (const mapping of sourceTagMappings) {
    const key = `${mapping.testFile}:${mapping.testMethod}`;
    const content = contentOf(mapping.testFile);
    if (content === null) continue;   // the existence warning is reported where the tag is parsed
    const tag = `${mapping.sourceFile}:${mapping.sourceLine}`;
    // dormant contract: the declaring class of the method is abstract and nobody inherits it
    const classDecl = _declaringClass(content, mapping.testMethod);
    if (classDecl && classDecl.isAbstract && !inheritedBases.has(classDecl.name) && !seen.has(`dormant:${key}`)) {
      seen.add(`dormant:${key}`);
      findings.push({ kind: 'dormantContract', testFile: mapping.testFile, testMethod: mapping.testMethod, sourceTag: tag,
        message: `${classDecl.name} is abstract and nothing inherits it, so ${mapping.testMethod} never runs` });
    }
    // self-contained: outside its own nested doubles, the file names no concrete src type and calls no src static method
    if (!seen.has(`self:${mapping.testFile}`)) {
      seen.add(`self:${mapping.testFile}`);
      const outsideDoubles = _withoutNestedClasses(content);
      const identifiers = new Set(outsideDoubles.match(/\b[A-Z]\w+\b/g) ?? []);
      const called = new Set([...outsideDoubles.matchAll(/\.(\w+)\s*(?:<[^>]*>)?\s*\(/g)].map(m => m[1]));
      // A <code-under-test> tag naming a file under src/ is the author's explicit claim (a SQL migration test
      // drives production functions through raw SQL and names no C# type at all).
      const declaresCodeUnderTest = /<code-under-test>\s*src\//.test(readFileSync(testFileByRelative.get(mapping.testFile) ?? resolve(LIBRARY_PATH, mapping.testFile), 'utf-8'));
      const touches = declaresCodeUnderTest || [...identifiers].some(id => sourceTypeNames.has(id)) || [...called].some(id => sourceStaticMethods.has(id));
      if (!touches) {
        findings.push({ kind: 'selfContained', testFile: mapping.testFile, testMethod: mapping.testMethod, sourceTag: tag,
          message: `${mapping.testFile} names no concrete type from src/ outside its own nested classes, so it verifies only its own doubles (a default interface member is the one shape this cannot tell apart; check by hand)` });
      }
    }
    // assertion-free: the method body pins nothing
    const body = _methodBody(content, mapping.testMethod);
    if (body !== null && !/\bAssert\s*\.|\.Throws|\.ThrowsAsync|\bShould\w*\(|Assert\w*\(/.test(body) && !seen.has(`assert:${key}`)) {
      seen.add(`assert:${key}`);
      findings.push({ kind: 'assertionFree', testFile: mapping.testFile, testMethod: mapping.testMethod, sourceTag: tag,
        message: `${mapping.testMethod} contains no assertion` });
    }
  }
  return findings;
}

/** The file with comments and string literals removed, so embedded C# source and prose never count as code. */
function _codeOnly(content) {
  return content
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/@"(?:[^"]|"")*"/g, '""')
    .replace(/\$?"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The code with every nested (private) class body removed: the test's own doubles are not the code under test. */
function _withoutNestedClasses(code) {
  let out = code;
  const nested = /\n\s+(?:private|internal)\s+(?:sealed\s+|static\s+|abstract\s+)*(?:class|record)\s+\w+[^{\n]*\{/g;
  let m;
  while ((m = nested.exec(out)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}' && --depth === 0) { close = i; break; }
    }
    if (close < 0) break;
    out = out.slice(0, m.index) + out.slice(close + 1);
    nested.lastIndex = m.index;
  }
  return out;
}

/** The class that declares a test method: its name and whether it is abstract. */
function _declaringClass(content, methodName) {
  const at = content.search(new RegExp(`\\bTask\\s+${methodName}\\s*\\(`));
  if (at < 0) return null;
  const before = content.slice(0, at);
  const decls = [...before.matchAll(/(?:public|internal|private|protected)?\s*((?:static\s+|abstract\s+|sealed\s+|partial\s+)*)class\s+(\w+)/g)];
  if (decls.length === 0) return null;
  const last = decls[decls.length - 1];
  return { name: last[2], isAbstract: /\babstract\b/.test(last[1]) };
}

/** The braces-delimited body of a test method, or null when it cannot be found. */
function _methodBody(content, methodName) {
  const at = content.search(new RegExp(`\\bTask\\s+${methodName}\\s*\\(`));
  if (at < 0) return null;
  const open = content.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}' && --depth === 0) return content.slice(open + 1, i);
  }
  return null;
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
    // path.join emits backslashes on Windows, which glob would otherwise treat as escape characters
    windowsPathsNoEscape: true,
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
    windowsPathsNoEscape: true,
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

  // Step 3b: link health (issue 742): a target that exists but verifies nothing is reported, never silently counted.
  const linkHealth = assessLinkHealth(sourceTagMappings, testFiles, sourceFiles);
  for (const finding of linkHealth) {
    console.warn(`Link health [${finding.kind}] ${finding.sourceTag} -> ${finding.testFile}:${finding.testMethod}: ${finding.message}`);
  }

  const mapping = {
    codeToTests,
    testsToCode,
    linkHealth,
    metadata: {
      generated: new Date().toISOString(),
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      totalLinks: Object.keys(codeToTests).length + Object.keys(testsToCode).length,
      codeSymbols: Object.keys(codeToTests).length,
      testMethods: Object.keys(testsToCode).length,
      linkHealthFindings: linkHealth.length
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
  console.log(`Link health findings: ${linkHealth.length}` + (linkHealth.length ? ' (see warnings above; the map carries them under linkHealth)' : ''));
  if (process.argv.includes('--strict') && linkHealth.length > 0) {
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
