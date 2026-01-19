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
    // Add slug as-is (e.g., "v0.1.0/core-concepts/dispatcher")
    validUrls.add(doc.slug);
    validUrls.add(doc.slug.replace(/\.md$/, ''));

    // Add slug without version prefix (e.g., "core-concepts/dispatcher")
    // This matches what <docs> tags use in source code
    const slugWithoutVersion = doc.slug.replace(/^v[\d.]+\//, '');
    validUrls.add(slugWithoutVersion);
    validUrls.add(slugWithoutVersion.replace(/\.md$/, ''));
  }

  return validateLinksUtil(codeDocsMap, validUrls);
}
