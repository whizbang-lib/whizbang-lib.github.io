import { CodeTestsMapData, findCodeForTest } from '../utils/code-tests-map.js';

export interface GetCodeForTestParams {
  testKey: string; // Format: "TestClassName.TestMethodName"
}

export interface GetCodeForTestResult {
  found: boolean;
  testKey?: string;
  code?: Array<{
    sourceFile: string;
    sourceLine?: number;
    sourceSymbol: string;
    sourceType?: string;
    linkSource?: string;
  }>;
  codeCount?: number;
}

/**
 * Find code tested by a given test method
 */
export function getCodeForTest(
  params: GetCodeForTestParams,
  codeTestsMap: CodeTestsMapData
): GetCodeForTestResult {
  const { testKey } = params;

  const code = findCodeForTest(codeTestsMap, testKey);

  if (code.length === 0) {
    return {
      found: false
    };
  }

  return {
    found: true,
    testKey,
    code: code.map(c => ({
      sourceFile: c.sourceFile,
      sourceLine: c.sourceLine,
      sourceSymbol: c.sourceSymbol,
      sourceType: c.sourceType,
      linkSource: c.linkSource
    })),
    codeCount: code.length
  };
}
