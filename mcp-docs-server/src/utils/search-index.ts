import fs from 'fs/promises';
import path from 'path';
import MiniSearch from 'minisearch';
import Fuse from 'fuse.js';

/**
 * Search document structure from search-index.json
 */
export interface SearchChunk {
  id: string;
  text: string;
  startIndex: number;
  preview: string;
}

export interface SearchDocument {
  type: 'document';
  slug: string;
  title: string;
  category: string;
  url: string;
  chunks: SearchChunk[];
}

/**
 * Search result with relevance score
 */
export interface SearchResult {
  slug: string;
  title: string;
  category: string;
  url: string;
  preview: string;
  score: number;
  matchedChunk?: string;
}

/**
 * Utility for loading and searching documentation indices
 */
export class SearchIndex {
  private searchIndex: SearchDocument[] | null = null;
  private enhancedSearchIndex: SearchDocument[] | null = null;
  private miniSearch: MiniSearch | null = null;
  private fuse: Fuse<SearchDocument> | null = null;

  constructor(private indexPath: string) {}

  /**
   * Load the basic search index
   */
  async loadSearchIndex(): Promise<SearchDocument[]> {
    if (this.searchIndex) {
      return this.searchIndex;
    }

    try {
      const indexFile = path.join(this.indexPath, 'search-index.json');
      const content = await fs.readFile(indexFile, 'utf-8');
      this.searchIndex = JSON.parse(content);
      return this.searchIndex!;
    } catch (error) {
      console.error('Failed to load search-index.json:', error);
      return [];
    }
  }

  /**
   * Load the enhanced search index (with AI-generated metadata)
   */
  async loadEnhancedSearchIndex(): Promise<SearchDocument[]> {
    if (this.enhancedSearchIndex) {
      return this.enhancedSearchIndex;
    }

    try {
      const indexFile = path.join(this.indexPath, 'enhanced-search-index.json');
      const content = await fs.readFile(indexFile, 'utf-8');
      this.enhancedSearchIndex = JSON.parse(content);
      return this.enhancedSearchIndex!;
    } catch (error) {
      // Fallback to basic search index
      console.log('Enhanced search index not found, using basic index');
      return this.loadSearchIndex();
    }
  }

  /**
   * Initialize MiniSearch for full-text search
   */
  async initMiniSearch(): Promise<MiniSearch> {
    if (this.miniSearch) {
      return this.miniSearch;
    }

    const documents = await this.loadSearchIndex();

    // Flatten chunks into searchable documents
    const searchDocs = documents.flatMap((doc) =>
      doc.chunks.map((chunk) => ({
        id: chunk.id,
        slug: doc.slug,
        title: doc.title,
        category: doc.category,
        text: chunk.text,
        preview: chunk.preview
      }))
    );

    this.miniSearch = new MiniSearch({
      fields: ['title', 'text', 'category'],
      storeFields: ['slug', 'title', 'category', 'preview'],
      searchOptions: {
        boost: { title: 2, category: 1.5 },
        fuzzy: 0.2,
        prefix: true
      }
    });

    this.miniSearch.addAll(searchDocs);
    return this.miniSearch;
  }

  /**
   * Initialize Fuse.js for semantic/fuzzy search
   */
  async initFuse(): Promise<Fuse<SearchDocument>> {
    if (this.fuse) {
      return this.fuse;
    }

    const documents = await this.loadEnhancedSearchIndex();

    this.fuse = new Fuse(documents, {
      keys: [
        { name: 'title', weight: 2 },
        { name: 'category', weight: 1.5 },
        { name: 'chunks.text', weight: 1 }
      ],
      threshold: 0.4,
      includeScore: true,
      useExtendedSearch: true
    });

    return this.fuse;
  }

  /**
   * Search using MiniSearch (keyword-based)
   */
  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    const miniSearch = await this.initMiniSearch();
    const results = miniSearch.search(query).slice(0, limit);

    return results.map((result) => ({
      slug: result.slug as string,
      title: result.title as string,
      category: result.category as string,
      url: `/docs/${result.slug}`,
      preview: result.preview as string,
      score: result.score,
      matchedChunk: result.preview as string
    }));
  }

  /**
   * Semantic search using Fuse.js
   */
  async semanticSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
    const fuse = await this.initFuse();
    const results = fuse.search(query, { limit });

    return results.map((result) => ({
      slug: result.item.slug,
      title: result.item.title,
      category: result.item.category,
      url: result.item.url,
      preview: result.item.chunks[0]?.preview || '',
      score: 1 - (result.score || 0), // Invert score (lower is better in Fuse)
      matchedChunk: result.item.chunks[0]?.preview || ''
    }));
  }

  /**
   * Filter documents by category
   */
  async searchByCategory(category: string): Promise<SearchDocument[]> {
    const documents = await this.loadSearchIndex();
    return documents.filter((doc) =>
      doc.category.toLowerCase().includes(category.toLowerCase())
    );
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const documents = await this.loadSearchIndex();
    const categories = new Set(documents.map((doc) => doc.category));
    return Array.from(categories).sort();
  }
}
