import { CodeDocsMap, findCodeByDocs } from '../utils/code-docs-map.js';

export interface CodeLocationParams {
  concept: string;
}

export interface CodeLocationResult {
  found: boolean;
  file?: string;
  line?: number;
  symbol?: string;
  docs?: string;
}

/**
 * Find code location by documentation concept/URL
 */
export function getCodeLocation(
  params: CodeLocationParams,
  codeDocsMap: CodeDocsMap
): CodeLocationResult {
  const { concept } = params;

  const mapping = findCodeByDocs(codeDocsMap, concept);

  if (!mapping) {
    return {
      found: false
    };
  }

  return {
    found: true,
    file: mapping.file,
    line: mapping.line,
    symbol: mapping.symbol,
    docs: mapping.docs
  };
}
