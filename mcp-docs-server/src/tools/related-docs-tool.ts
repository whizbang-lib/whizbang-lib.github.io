import { CodeDocsMap, findDocsBySymbol } from '../utils/code-docs-map.js';
import { SearchIndex } from '../utils/search-index.js';

export interface RelatedDocsParams {
  symbol: string;
}

export interface RelatedDocsResult {
  found: boolean;
  url?: string;
  title?: string;
  category?: string;
  file?: string;
  line?: number;
}

/**
 * Find related documentation for a code symbol
 */
export async function getRelatedDocs(
  params: RelatedDocsParams,
  codeDocsMap: CodeDocsMap,
  searchIndex: SearchIndex
): Promise<RelatedDocsResult> {
  const { symbol } = params;

  const mapping = findDocsBySymbol(codeDocsMap, symbol);

  if (!mapping) {
    return {
      found: false
    };
  }

  // Look up full documentation details from search index
  const searchResults = await searchIndex.search(mapping.docs, 1);
  const doc = searchResults[0];

  return {
    found: true,
    url: mapping.docs,
    title: doc?.title,
    category: doc?.category,
    file: mapping.file,
    line: mapping.line
  };
}
