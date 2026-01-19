import { SearchIndex, SearchResult } from '../utils/search-index.js';

export interface SearchToolParams {
  query: string;
  limit?: number;
  category?: string;
  semantic?: boolean;
}

/**
 * Search documentation using keyword or semantic search
 */
export async function searchDocs(
  params: SearchToolParams,
  searchIndex: SearchIndex
): Promise<SearchResult[]> {
  const { query, limit = 10, category, semantic = false } = params;

  // Perform search
  let results: SearchResult[];
  if (semantic) {
    results = await searchIndex.semanticSearch(query, limit);
  } else {
    results = await searchIndex.search(query, limit);
  }

  // Filter by category if specified
  if (category) {
    results = results.filter((result) =>
      result.category.toLowerCase().includes(category.toLowerCase())
    );
  }

  return results;
}

/**
 * List all documentation grouped by category
 */
export async function listDocsByCategory(
  searchIndex: SearchIndex,
  category?: string
): Promise<Record<string, SearchResult[]>> {
  const documents = category
    ? await searchIndex.searchByCategory(category)
    : await searchIndex.loadSearchIndex();

  // Group by category
  const grouped: Record<string, SearchResult[]> = {};

  for (const doc of documents) {
    if (!grouped[doc.category]) {
      grouped[doc.category] = [];
    }

    grouped[doc.category].push({
      slug: doc.slug,
      title: doc.title,
      category: doc.category,
      url: doc.url,
      preview: doc.chunks[0]?.preview || '',
      score: 1.0
    });
  }

  return grouped;
}

/**
 * Get all available categories
 */
export async function getCategories(searchIndex: SearchIndex): Promise<string[]> {
  return searchIndex.getCategories();
}
