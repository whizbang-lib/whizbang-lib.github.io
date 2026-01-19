import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of, from } from 'rxjs';
import { map, shareReplay, tap, catchError, switchMap } from 'rxjs/operators';
import MiniSearch from 'minisearch';
import { AIEnhancementService, AIEnhancementState } from './ai-enhancement.service';
import { VersionService } from './version.service';

export interface SearchChunk {
  id: string;
  text: string;
  startIndex: number;
  preview: string;
  wordCount?: number;
  importance?: number;
  keywords?: string[];
  // AI-enhanced metadata
  embedding?: number[];
  semanticKeywords?: string[];
  contentType?: string;
  difficulty?: string;
  hasCode?: boolean;
  language?: string;
  concepts?: string[];
}

export interface SearchDocument {
  type: 'document';
  slug: string;
  title: string;
  category: string;
  url: string;
  chunks: SearchChunk[];
  keywords?: string[];
  description?: string;
  order?: number;
  lastModified?: string;
}

export interface EnhancedSearchResult {
  document: SearchDocument;
  chunk: SearchChunk;
  score: number;
  match: any;
  highlightedPreview: string;
  terms: string[];
  // AI-enhanced scoring
  semanticScore: number;
  keywordScore: number;
  finalScore: number;
  isSemanticMatch: boolean;
}

interface SearchableItem {
  id: string;
  title: string;
  category: string;
  content: string;
  slug: string;
  url: string;
  chunkId: string;
  preview: string;
  fullText: string;
}

@Injectable({
  providedIn: 'root'
})
export class EnhancedSearchService {
  private searchIndex$: Observable<SearchDocument[]>;
  private miniSearchIndex: MiniSearch<SearchableItem> | null = null;
  private documentsMap: Map<string, SearchDocument> = new Map();
  private chunksMap: Map<string, SearchChunk> = new Map();
  private currentQuery$ = new BehaviorSubject<string>('');
  private highlightedTerms$ = new BehaviorSubject<string[]>([]);
  private isIndexReady$ = new BehaviorSubject<boolean>(false);
  private chunkEmbeddings: { [chunkId: string]: number[] } = {};

  private versionService = inject(VersionService);
  private router = inject(Router);

  constructor(
    private http: HttpClient,
    private aiEnhancementService: AIEnhancementService
  ) {
    // Try to load enhanced index first, fallback to standard index
    this.searchIndex$ = this.http.get<SearchDocument[]>('assets/enhanced-search-index.json')
      .pipe(
        tap(index => this.buildMiniSearchIndex(index)),
        tap(index => this.cacheSearchIndex(index)),
        shareReplay(1),
        catchError(() => {
          console.log('Enhanced index not found, falling back to standard index');
          return this.http.get<SearchDocument[]>('assets/search-index.json')
            .pipe(
              tap(index => this.buildMiniSearchIndex(index)),
              tap(index => this.cacheSearchIndex(index))
            );
        })
      );
    this.loadCachedIndex();
  }

  private buildMiniSearchIndex(documents: SearchDocument[]): void {
    // Clear existing maps
    this.documentsMap.clear();
    this.chunksMap.clear();

    // Create MiniSearch instance
    this.miniSearchIndex = new MiniSearch({
      fields: ['title', 'category', 'content', 'slug'],
      storeFields: ['title', 'category', 'url', 'slug', 'chunkId', 'preview', 'fullText'],
      searchOptions: {
        boost: { title: 3, category: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'AND' as const
      },
      processTerm: (term) => {
        if (term.length < 2) return null;
        return term.toLowerCase();
      }
    });

    // Prepare documents for indexing and create lookup maps
    const searchableItems: SearchableItem[] = [];
    
    documents.forEach(document => {
      this.documentsMap.set(document.slug, document);
      
      document.chunks.forEach(chunk => {
        this.chunksMap.set(chunk.id, chunk);
        
        // Store embeddings for AI-enhanced search
        if (chunk.embedding && Array.isArray(chunk.embedding)) {
          this.chunkEmbeddings[chunk.id] = chunk.embedding;
        }
        
        searchableItems.push({
          id: chunk.id,
          title: document.title,
          category: document.category,
          content: chunk.text,
          slug: document.slug,
          url: document.url,
          chunkId: chunk.id,
          preview: chunk.preview,
          fullText: chunk.text
        });
      });
    });

    // Add documents to the index
    this.miniSearchIndex.addAll(searchableItems);
    this.isIndexReady$.next(true);
    
    console.log(`Enhanced search index built with ${searchableItems.length} searchable chunks`);
  }

  search(query: string, options?: {
    fuzzy?: number;
    prefix?: boolean;
    boost?: Record<string, number>;
    limit?: number;
    filterByCurrentVersion?: boolean;
  }): Observable<EnhancedSearchResult[]> {
    if (!query.trim()) {
      this.currentQuery$.next('');
      this.highlightedTerms$.next([]);
      return of([]);
    }

    this.currentQuery$.next(query);
    
    if (!this.miniSearchIndex) {
      console.warn('Search index not ready');
      return of([]);
    }

    // Check if AI enhancement is ready for hybrid search
    const isAIReady = this.aiEnhancementService.isAIReady();
    
    if (isAIReady && Object.keys(this.chunkEmbeddings).length > 0) {
      return this.performHybridSearch(query, options).pipe(
        map(results => this.filterResultsByVersion(results, options))
      );
    } else {
      return this.performTraditionalSearch(query, options).pipe(
        map(results => this.filterResultsByVersion(results, options))
      );
    }
  }

  // Traditional keyword-only search (fallback)
  private performTraditionalSearch(query: string, options?: any): Observable<EnhancedSearchResult[]> {
    const searchOptions = {
      fuzzy: options?.fuzzy ?? 0.2,
      prefix: options?.prefix ?? true,
      boost: options?.boost ?? { title: 3, category: 2, content: 1 },
      combineWith: 'AND' as const,
      ...options
    };

    try {
      const results = this.miniSearchIndex!.search(query, searchOptions);
      const searchTerms = this.extractSearchTerms(query);
      this.highlightedTerms$.next(searchTerms);

      const enhancedResults: EnhancedSearchResult[] = results
        .slice(0, options?.limit ?? 20)
        .map(result => {
          const chunkId = result['chunkId'] as string;
          const slug = result['slug'] as string;
          const chunk = this.chunksMap.get(chunkId);
          const document = this.documentsMap.get(slug);

          if (!document || !chunk) {
            return null;
          }

          return {
            document,
            chunk,
            score: result.score,
            match: result,
            highlightedPreview: this.highlightText(result['preview'] as string || chunk.preview, searchTerms),
            terms: searchTerms,
            keywordScore: result.score,
            semanticScore: 0,
            finalScore: result.score,
            isSemanticMatch: false
          };
        })
        .filter((result): result is EnhancedSearchResult => result !== null);

      return of(enhancedResults);
    } catch (error) {
      console.error('Traditional search error:', error);
      return of([]);
    }
  }

  // Hybrid search combining semantic and keyword matching
  private performHybridSearch(query: string, options?: any): Observable<EnhancedSearchResult[]> {
    return from(this.aiEnhancementService.generateQueryEmbedding(query)).pipe(
      switchMap(queryEmbedding => {
        // Perform traditional keyword search
        const keywordResults = this.performTraditionalSearchSync(query, options);
        
        // Perform semantic search if we have embeddings
        let semanticResults: any[] = [];
        if (queryEmbedding && queryEmbedding.length > 0) {
          semanticResults = this.aiEnhancementService.calculateSemanticSimilarity(
            queryEmbedding, 
            this.chunkEmbeddings
          );
        }

        // Combine and rank results
        const hybridResults = this.combineSearchResults(keywordResults, semanticResults, query);
        
        return of(hybridResults.slice(0, options?.limit ?? 20));
      }),
      catchError(error => {
        console.warn('Hybrid search failed, falling back to traditional search:', error);
        return this.performTraditionalSearch(query, options);
      })
    );
  }

  // Synchronous version of traditional search for hybrid combination
  private performTraditionalSearchSync(query: string, options?: any): any[] {
    const searchOptions = {
      fuzzy: options?.fuzzy ?? 0.2,
      prefix: options?.prefix ?? true,
      boost: options?.boost ?? { title: 3, category: 2, content: 1 },
      combineWith: 'AND' as const,
      ...options
    };

    try {
      return this.miniSearchIndex!.search(query, searchOptions);
    } catch (error) {
      console.error('Keyword search error:', error);
      return [];
    }
  }

  // Combine keyword and semantic search results with hybrid scoring
  private combineSearchResults(keywordResults: any[], semanticResults: any[], query: string): EnhancedSearchResult[] {
    const searchTerms = this.extractSearchTerms(query);
    this.highlightedTerms$.next(searchTerms);

    // Create maps for easy lookup
    const keywordMap = new Map(keywordResults.map(r => [r.chunkId, r]));
    const semanticMap = new Map(semanticResults.map(r => [r.chunkId, r]));

    // Get all unique chunk IDs
    const allChunkIds = new Set([
      ...keywordResults.map(r => r.chunkId),
      ...semanticResults.map(r => r.chunkId)
    ]);

    const hybridResults: EnhancedSearchResult[] = [];

    for (const chunkId of allChunkIds) {
      const chunk = this.chunksMap.get(chunkId);
      if (!chunk) continue;

      const slug = chunk.id.split('-chunk-')[0];
      const document = this.documentsMap.get(slug);
      if (!document) continue;

      const keywordResult = keywordMap.get(chunkId);
      const semanticResult = semanticMap.get(chunkId);

      // Calculate scores
      const keywordScore = keywordResult ? keywordResult.score : 0;
      const semanticScore = semanticResult ? semanticResult.similarity * 100 : 0; // Scale to match keyword scores

      // Hybrid scoring: 40% keyword + 60% semantic (adjustable)
      const keywordWeight = 0.4;
      const semanticWeight = 0.6;
      const finalScore = (keywordScore * keywordWeight) + (semanticScore * semanticWeight);

      // Apply semantic boost if available
      let boostedScore = finalScore;
      if (semanticResult) {
        boostedScore = finalScore * semanticResult.boost;
      }

      const result: EnhancedSearchResult = {
        document,
        chunk,
        score: boostedScore,
        match: keywordResult || { score: 0 },
        highlightedPreview: this.highlightText(chunk.preview, searchTerms),
        terms: searchTerms,
        keywordScore: keywordScore,
        semanticScore: semanticScore,
        finalScore: boostedScore,
        isSemanticMatch: !!semanticResult && !keywordResult
      };

      hybridResults.push(result);
    }

    // Sort by final score (highest first)
    return hybridResults.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
  }

  // Auto-suggest functionality
  autoSuggest(query: string, limit: number = 5): Observable<string[]> {
    if (!query.trim() || !this.miniSearchIndex) {
      return of([]);
    }

    try {
      const suggestions = this.miniSearchIndex.autoSuggest(query, { 
        fuzzy: 0.2,
        prefix: true
      });
      
      // Convert suggestions to strings
      const suggestionStrings = suggestions
        .slice(0, limit)
        .map(suggestion => typeof suggestion === 'string' ? suggestion : suggestion.suggestion || '')
        .filter(s => s.length > 0);
        
      return of(suggestionStrings);
    } catch (error) {
      console.error('Auto-suggest error:', error);
      return of([]);
    }
  }

  // Get current query
  getCurrentQuery(): Observable<string> {
    return this.currentQuery$.asObservable();
  }

  // Get highlighted terms
  getHighlightedTerms(): Observable<string[]> {
    return this.highlightedTerms$.asObservable();
  }

  // Check if index is ready
  isIndexReady(): Observable<boolean> {
    return this.isIndexReady$.asObservable();
  }

  // Clear search
  clearSearch(): void {
    this.currentQuery$.next('');
    this.highlightedTerms$.next([]);
  }

  // Add document to index (for real-time updates)
  addDocument(document: SearchDocument): void {
    if (!this.miniSearchIndex) return;

    this.documentsMap.set(document.slug, document);
    
    document.chunks.forEach(chunk => {
      this.chunksMap.set(chunk.id, chunk);
      
      this.miniSearchIndex!.add({
        id: chunk.id,
        title: document.title,
        category: document.category,
        content: chunk.text,
        slug: document.slug,
        url: document.url,
        chunkId: chunk.id,
        preview: chunk.preview,
        fullText: chunk.text
      });
    });
  }

  // Remove document from index
  removeDocument(documentSlug: string): void {
    if (!this.miniSearchIndex) return;

    const document = this.documentsMap.get(documentSlug);
    if (document) {
      document.chunks.forEach(chunk => {
        try {
          this.miniSearchIndex!.remove({
            id: chunk.id,
            title: document.title,
            category: document.category,
            content: chunk.text,
            slug: document.slug,
            url: document.url,
            chunkId: chunk.id,
            preview: chunk.preview,
            fullText: chunk.text
          });
          this.chunksMap.delete(chunk.id);
        } catch (error) {
          console.warn('Error removing chunk from index:', chunk.id);
        }
      });
      this.documentsMap.delete(documentSlug);
    }
  }

  private extractSearchTerms(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 1)
      .map(term => term.replace(/[^a-z0-9]/g, ''));
  }

  private highlightText(text: string, searchTerms: string[]): string {
    let highlighted = text;
    
    for (const term of searchTerms) {
      const regex = new RegExp(`(${term})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark class="search-highlight">$1</mark>');
    }
    
    return highlighted;
  }

  // Initialize the search index explicitly
  initializeIndex(): Observable<SearchDocument[]> {
    return this.searchIndex$;
  }

  private cacheSearchIndex(index: SearchDocument[]): void {
    try {
      localStorage.setItem('whizbang-enhanced-search-index', JSON.stringify(index));
      localStorage.setItem('whizbang-enhanced-search-index-timestamp', Date.now().toString());
    } catch (error) {
      console.warn('Failed to cache enhanced search index:', error);
    }
  }

  private loadCachedIndex(): void {
    try {
      const cached = localStorage.getItem('whizbang-enhanced-search-index');
      const timestamp = localStorage.getItem('whizbang-enhanced-search-index-timestamp');
      
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (age < maxAge) {
          const index = JSON.parse(cached);
          this.buildMiniSearchIndex(index);
          console.log('Using cached enhanced search index');
        }
      }
    } catch (error) {
      console.warn('Failed to load cached enhanced search index:', error);
    }
  }

  /**
   * Filter search results by current version
   */
  private filterResultsByVersion(results: EnhancedSearchResult[], options?: any): EnhancedSearchResult[] {
    // If filtering is explicitly disabled, return all results
    if (options?.filterByCurrentVersion === false) {
      return results;
    }

    const currentUrl = this.router.url;
    
    // If not in docs section, return all results
    if (!currentUrl.startsWith('/docs')) {
      return results;
    }
    
    // Extract the doc path after /docs/
    const docPath = currentUrl.replace('/docs/', '').split('/')[0];
    
    let targetDocs: any[] = [];
    let contextType = '';
    
    // If we're at the docs root, use current version
    if (!docPath) {
      const currentVersion = this.versionService.currentVersion();
      targetDocs = this.versionService.getCurrentVersionDocs();
      contextType = `version: ${currentVersion}`;
    } else {
      // Check if this is a state route (proposals, drafts, etc.)
      const availableStates = this.versionService.availableStates();
      const matchingState = availableStates.find(s => s.state === docPath);
      
      if (matchingState) {
        // Filter by state
        targetDocs = this.versionService.getDocsForVersionOrState(docPath);
        contextType = `state: ${docPath}`;
      } else {
        // Check if this is a version route
        const availableVersions = this.versionService.availableVersions();
        const matchingVersion = availableVersions.find(v => v.version === docPath);
        
        if (matchingVersion) {
          // Filter by specific version
          targetDocs = this.versionService.getDocsForVersionOrState(docPath);
          contextType = `version: ${docPath}`;
        } else {
          // This might be a sub-path within a version, use current version
          const currentVersion = this.versionService.currentVersion();
          targetDocs = this.versionService.getCurrentVersionDocs();
          contextType = `version: ${currentVersion} (fallback)`;
        }
      }
    }
    
    // Create set of target document slugs
    const targetSlugs = new Set(targetDocs.map(doc => doc.slug));
    
    // Filter results to only include documents from the target context
    const filteredResults = results.filter(result => {
      return targetSlugs.has(result.document.slug);
    });

    console.log(`Version-filtered search: ${results.length} -> ${filteredResults.length} results (${contextType})`);
    
    return filteredResults;
  }

  /**
   * Search all versions (bypass version filtering)
   */
  searchAllVersions(query: string, options?: {
    fuzzy?: number;
    prefix?: boolean;
    boost?: Record<string, number>;
    limit?: number;
  }): Observable<EnhancedSearchResult[]> {
    return this.search(query, { ...options, filterByCurrentVersion: false });
  }
}
