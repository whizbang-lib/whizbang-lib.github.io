import { CodeDocsMap, validateLinks as validateLinksUtil } from '../utils/code-docs-map.js';
import { SearchIndex } from '../utils/search-index.js';

export interface ValidateLinksResult {
  valid: number;
  broken: number;
  details: Array<{
    symbol: string;
    docs: string;
    status: 'valid' | 'broken';
  }>;
}

/**
 * Validate all code-docs links
 */
export async function validateDocLinks(
  codeDocsMap: CodeDocsMap,
  searchIndex: SearchIndex
): Promise<ValidateLinksResult> {
  // Get all valid documentation URLs from search index
  const allDocs = await searchIndex.loadSearchIndex();
  const validUrls = new Set<string>();

  for (const doc of allDocs) {
    // Add both with and without .md extension
    validUrls.add(doc.slug);
    validUrls.add(doc.slug.replace(/\.md$/, ''));

    // Also add URL path format (category/slug)
    const urlPath = `${doc.category.toLowerCase().replace(/\s+/g, '-')}/${doc.slug}`;
    validUrls.add(urlPath);
    validUrls.add(urlPath.replace(/\.md$/, ''));
  }

  return validateLinksUtil(codeDocsMap, validUrls);
}
