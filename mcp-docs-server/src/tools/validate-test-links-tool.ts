import { CodeTestsMapData, validateTestLinks } from '../utils/code-tests-map.js';

export interface ValidateTestLinksParams {
  // No parameters needed for now
}

export interface ValidateTestLinksResult {
  valid: number;
  totalLinks: number;
  validationRate: string;
  details: Array<{
    symbol: string;
    testMethod: string;
    status: 'valid' | 'warning';
    message?: string;
  }>;
}

/**
 * Validate all code-test links
 */
export function validateTestLinksFunc(
  _params: ValidateTestLinksParams,
  codeTestsMap: CodeTestsMapData
): ValidateTestLinksResult {
  const validation = validateTestLinks(codeTestsMap);

  return {
    valid: validation.valid,
    totalLinks: validation.totalLinks,
    validationRate: `${((validation.valid / validation.totalLinks) * 100).toFixed(1)}%`,
    details: validation.details
  };
}
