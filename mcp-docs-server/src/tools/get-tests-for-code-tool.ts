import { CodeTestsMapData, findTestsForCode } from '../utils/code-tests-map.js';

export interface GetTestsForCodeParams {
  symbol: string;
}

export interface GetTestsForCodeResult {
  found: boolean;
  symbol?: string;
  tests?: Array<{
    testFile: string;
    testMethod: string;
    testLine?: number;
    testClass?: string;
    linkSource: string;
  }>;
  testCount?: number;
}

/**
 * Find tests for a given code symbol
 */
export function getTestsForCode(
  params: GetTestsForCodeParams,
  codeTestsMap: CodeTestsMapData
): GetTestsForCodeResult {
  const { symbol } = params;

  const tests = findTestsForCode(codeTestsMap, symbol);

  if (tests.length === 0) {
    return {
      found: false
    };
  }

  return {
    found: true,
    symbol,
    tests: tests.map(t => ({
      testFile: t.testFile,
      testMethod: t.testMethod,
      testLine: t.testLine,
      testClass: t.testClass,
      linkSource: t.linkSource
    })),
    testCount: tests.length
  };
}
