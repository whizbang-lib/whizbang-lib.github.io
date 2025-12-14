import { CodeTestsMapData, getCoverageStats } from '../utils/code-tests-map.js';

export interface GetCoverageStatsParams {
  // No parameters needed
}

export interface GetCoverageStatsResult {
  totalCodeSymbols: number;
  totalTestMethods: number;
  averageTestsPerSymbol: number;
  linkSourceBreakdown: Record<string, number>;
  metadata?: {
    generated: string;
    sourceFiles: number;
    testFiles: number;
  };
}

/**
 * Get test coverage statistics
 */
export function getCoverageStatsFunc(
  _params: GetCoverageStatsParams,
  codeTestsMap: CodeTestsMapData
): GetCoverageStatsResult {
  const stats = getCoverageStats(codeTestsMap);

  return {
    ...stats,
    metadata: codeTestsMap.metadata ? {
      generated: codeTestsMap.metadata.generated,
      sourceFiles: codeTestsMap.metadata.sourceFiles,
      testFiles: codeTestsMap.metadata.testFiles
    } : undefined
  };
}
