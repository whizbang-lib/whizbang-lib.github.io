import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, shareReplay, tap, catchError } from 'rxjs/operators';
import MiniSearch from 'minisearch';

// Import original interfaces for compatibility
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

export interface SearchResult {
  document: SearchDocument;
  chunk: SearchChunk;
  matchScore: number;
  highlightedPreview: string;
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
}

@Injectable({
  providedIn: 'root'
})
export class CompatibleEnhancedSearchService {
  private searchIndex$: Observable<SearchDocument[]>;
  private miniSearchIndex: MiniSearch<SearchableItem> | null = null;
  private documentsMap: Map<string, SearchDocument> = new Map();
  private chunksMap: Map<string, SearchChunk> = new Map();
  private currentQuery$ = new BehaviorSubject<string>('');
  private highlightedTerms$ = new BehaviorSubject<string[]>([]);

  constructor(private http: HttpClient) {
    // Try enhanced index first, then fallback to original
    this.searchIndex$ = this.http.get<SearchDocument[]>('assets/enhanced-search-index.json')
      .pipe(
        map(enhancedIndex => this.convertEnhancedToOriginalFormat(enhancedIndex)),
        tap(index => this.buildMiniSearchIndex(index)),
        tap(index => this.cacheSearchIndex(index)),
        shareReplay(1),
        catchError(() => {
          console.log('Enhanced index not found, using original');
          return this.http.get<SearchDocument[]>('assets/search-index.json')
            .pipe(
              tap(index => this.buildMiniSearchIndex(index)),
              tap(index => this.cacheSearchIndex(index))
            );
        })
      );
    this.loadCachedIndex();
  }

  private convertEnhancedToOriginalFormat(enhancedIndex: any[]): SearchDocument[] {
    return enhancedIndex.map(doc => ({
      type: 'document' as const,
      slug: doc.slug,
      title: doc.title,
      category: doc.category,
      url: doc.url,
      chunks: doc.chunks.map((chunk: any) => ({
        id: chunk.id,
        text: chunk.text,
        startIndex: chunk.startIndex || 0,
        preview: chunk.preview
      }))
    }));
  }

  private buildMiniSearchIndex(documents: SearchDocument[]): void {
    this.documentsMap.clear();
    this.chunksMap.clear();

    this.miniSearchIndex = new MiniSearch({
      fields: ['title', 'category', 'content'],
      storeFields: ['title', 'category', 'url', 'slug', 'chunkId', 'preview'],
      searchOptions: {
        boost: { title: 3, category: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'AND' as const
      }
    });

    const searchableItems: SearchableItem[] = [];
    
    documents.forEach(document => {
      this.documentsMap.set(document.slug, document);
      
      document.chunks.forEach(chunk => {
        this.chunksMap.set(chunk.id, chunk);
        
        searchableItems.push({
          id: chunk.id,
          title: document.title,
          category: document.category,
          content: chunk.text,
          slug: document.slug,
          url: document.url,
          chunkId: chunk.id,
          preview: chunk.preview
        });
      });
    });

    this.miniSearchIndex.addAll(searchableItems);
    console.log(`Compatible enhanced search index built with ${searchableItems.length} chunks`);
  }

  search(query: string): Observable<SearchResult[]> {
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

    try {
      console.log('Searching with compatible enhanced search:', query);
      const results = this.miniSearchIndex.search(query, {
        fuzzy: 0.2,
        prefix: true,
        boost: { title: 3, category: 2, content: 1 }
      });

      const searchTerms = this.extractSearchTerms(query);
      this.highlightedTerms$.next(searchTerms);

      const searchResults: SearchResult[] = results
        .slice(0, 20)
        .map(result => {
          const chunkId = result['chunkId'] as string;
          const slug = result['slug'] as string;
          const chunk = this.chunksMap.get(chunkId);
          const document = this.documentsMap.get(slug);

          if (!document || !chunk) {
            console.warn(`Could not find document/chunk for: ${chunkId}`);
            return null;
          }

          return {
            document,
            chunk,
            matchScore: result.score,
            highlightedPreview: this.highlightText(result['preview'] as string || chunk.preview, searchTerms)
          };
        })
        .filter((result): result is SearchResult => result !== null);

      console.log('Compatible enhanced search results:', searchResults);
      return of(searchResults);
    } catch (error) {
      console.error('Compatible enhanced search error:', error);
      return of([]);
    }
  }

  private extractSearchTerms(query: string): string[] {
    return query.toLowerCase()
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

  getCurrentQuery(): Observable<string> {
    return this.currentQuery$.asObservable();
  }

  getHighlightedTerms(): Observable<string[]> {
    return this.highlightedTerms$.asObservable();
  }

  clearSearch(): void {
    this.currentQuery$.next('');
    this.highlightedTerms$.next([]);
  }

  private cacheSearchIndex(index: SearchDocument[]): void {
    try {
      localStorage.setItem('whizbang-search-index', JSON.stringify(index));
      localStorage.setItem('whizbang-search-index-timestamp', Date.now().toString());
    } catch (error) {
      console.warn('Failed to cache search index:', error);
    }
  }

  private loadCachedIndex(): void {
    try {
      const cached = localStorage.getItem('whizbang-search-index');
      const timestamp = localStorage.getItem('whizbang-search-index-timestamp');
      
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        const maxAge = 24 * 60 * 60 * 1000;
        
        if (age < maxAge) {
          const index = JSON.parse(cached);
          this.buildMiniSearchIndex(index);
          console.log('Using cached compatible enhanced search index');
        }
      }
    } catch (error) {
      console.warn('Failed to load cached search index:', error);
    }
  }
}
