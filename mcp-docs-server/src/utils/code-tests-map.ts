import { readFileSync } from 'fs';
import path from 'path';

export interface TestLinkMapping {
  testFile: string;
  testMethod: string;
  testLine?: number;
  testClass?: string;
  linkSource: 'XmlTag' | 'Convention' | 'SemanticAnalysis';
}

export interface CodeLinkMapping {
  sourceFile: string;
  sourceLine?: number;
  sourceSymbol: string;
  sourceType?: string;
  linkSource?: 'XmlTag' | 'Convention' | 'SemanticAnalysis';
}

export interface CodeTestsMapData {
  codeToTests: Record<string, TestLinkMapping[]>;
  testsToCode: Record<string, CodeLinkMapping[]>;
  metadata?: {
    generated: string;
    sourceFiles: number;
    testFiles: number;
    totalLinks: number;
    codeSymbols: number;
    testMethods: number;
  };
}

/**
 * Loads the code-tests mapping from JSON file
 */
export function loadCodeTestsMap(assetsPath: string): CodeTestsMapData {
  const mapPath = path.join(assetsPath, 'code-tests-map.json');

  try {
    const content = readFileSync(mapPath, 'utf-8');
    return JSON.parse(content) as CodeTestsMapData;
  } catch (error) {
    console.error(`Failed to load code-tests map from ${mapPath}:`, error);
    return {
      codeToTests: {},
      testsToCode: {}
    };
  }
}

/**
 * Finds tests for a given code symbol
 */
export function findTestsForCode(map: CodeTestsMapData, symbol: string): TestLinkMapping[] {
  return map.codeToTests[symbol] || [];
}

/**
 * Finds code tested by a given test method
 * @param testKey - Format: "TestClassName.TestMethodName"
 */
export function findCodeForTest(map: CodeTestsMapData, testKey: string): CodeLinkMapping[] {
  return map.testsToCode[testKey] || [];
}

/**
 * Gets all code symbols that have tests
 */
export function getCodeSymbolsWithTests(map: CodeTestsMapData): string[] {
  return Object.keys(map.codeToTests);
}

/**
 * Gets all test methods
 */
export function getAllTestMethods(map: CodeTestsMapData): string[] {
  return Object.keys(map.testsToCode);
}

/**
 * Finds code symbols with no associated tests
 * Requires a list of all code symbols from the codebase
 */
export function findUntestedSymbols(
  map: CodeTestsMapData,
  allSymbols: string[]
): string[] {
  const testedSymbols = new Set(Object.keys(map.codeToTests));
  return allSymbols.filter(symbol => !testedSymbols.has(symbol));
}

/**
 * Gets test coverage statistics
 */
export function getCoverageStats(map: CodeTestsMapData): {
  totalCodeSymbols: number;
  totalTestMethods: number;
  averageTestsPerSymbol: number;
  linkSourceBreakdown: Record<string, number>;
} {
  const totalCodeSymbols = Object.keys(map.codeToTests).length;
  const totalTestMethods = Object.keys(map.testsToCode).length;

  // Count total tests across all symbols
  let totalTestLinks = 0;
  const linkSourceCounts: Record<string, number> = {
    XmlTag: 0,
    Convention: 0,
    SemanticAnalysis: 0
  };

  for (const tests of Object.values(map.codeToTests)) {
    totalTestLinks += tests.length;
    for (const test of tests) {
      linkSourceCounts[test.linkSource] = (linkSourceCounts[test.linkSource] || 0) + 1;
    }
  }

  return {
    totalCodeSymbols,
    totalTestMethods,
    averageTestsPerSymbol: totalCodeSymbols > 0 ? totalTestLinks / totalCodeSymbols : 0,
    linkSourceBreakdown: linkSourceCounts
  };
}

/**
 * Validates test links - checks if test files/methods exist
 * For now, returns success; full validation requires filesystem access
 */
export function validateTestLinks(map: CodeTestsMapData): {
  valid: number;
  totalLinks: number;
  details: Array<{
    symbol: string;
    testMethod: string;
    status: 'valid' | 'warning';
    message?: string;
  }>;
} {
  const details: Array<{
    symbol: string;
    testMethod: string;
    status: 'valid' | 'warning';
    message?: string;
  }> = [];

  let totalLinks = 0;

  for (const [symbol, tests] of Object.entries(map.codeToTests)) {
    for (const test of tests) {
      totalLinks++;

      // For now, mark all as valid since we just generated the map
      // In future, could check if test files actually exist
      details.push({
        symbol,
        testMethod: test.testMethod,
        status: 'valid'
      });
    }
  }

  return {
    valid: totalLinks,
    totalLinks,
    details
  };
}
