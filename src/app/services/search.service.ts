import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, shareReplay, tap, catchError } from 'rxjs/operators';
import { VersionService } from './version.service';
import { Router } from '@angular/router';

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

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  private searchIndex$: Observable<SearchDocument[]>;
  private documentsMap: Map<string, SearchDocument> = new Map();
  private chunksMap: Map<string, SearchChunk> = new Map();
  private currentQuery$ = new BehaviorSubject<string>('');
  private highlightedTerms$ = new BehaviorSubject<string[]>([]);

  private versionService = inject(VersionService);
  private router = inject(Router);

  constructor(private http: HttpClient) {
    // Try enhanced index first, then fallback to original
    this.searchIndex$ = this.http.get<SearchDocument[]>('assets/enhanced-search-index.json')
      .pipe(
        map(enhancedIndex => this.convertEnhancedToOriginalFormat(enhancedIndex)),
        tap(index => this.buildSearchIndex(index)),
        tap(index => this.cacheSearchIndex(index)),
        shareReplay(1),
        catchError(() => {
          console.log('Enhanced index not found, using original search-index.json');
          return this.http.get<SearchDocument[]>('assets/search-index.json')
            .pipe(
              tap(index => this.buildSearchIndex(index)),
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

  private buildSearchIndex(documents: SearchDocument[]): void {
    this.documentsMap.clear();
    this.chunksMap.clear();
    
    documents.forEach(document => {
      this.documentsMap.set(document.slug, document);
      
      document.chunks.forEach(chunk => {
        this.chunksMap.set(chunk.id, chunk);
      });
    });

    console.log(`Enhanced search index loaded with ${documents.length} documents`);
  }

  search(query: string): Observable<SearchResult[]> {
    if (!query.trim()) {
      this.currentQuery$.next('');
      this.highlightedTerms$.next([]);
      return of([]);
    }

    this.currentQuery$.next(query);
    
    if (this.documentsMap.size === 0) {
      console.warn('Search index not ready');
      return of([]);
    }

    try {
      console.log('Searching with enhanced algorithm:', query);
      const searchTerms = this.extractSearchTerms(query);
      this.highlightedTerms$.next(searchTerms);

      const searchResults: SearchResult[] = [];
      
      // Filter documents by current version/state context
      const filteredDocuments = this.getDocumentsForCurrentContext();
      
      // Search through filtered documents and chunks
      filteredDocuments.forEach(document => {
        document.chunks.forEach(chunk => {
          const score = this.calculateRelevanceScore(query, document, chunk);
          if (score > 0) {
            searchResults.push({
              document,
              chunk,
              matchScore: score,
              highlightedPreview: this.highlightText(chunk.preview, searchTerms)
            });
          }
        });
      });

      // Sort by relevance score (highest first) and limit results
      const sortedResults = searchResults
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 10);

      console.log('Enhanced search results:', sortedResults);
      return of(sortedResults);
    } catch (error) {
      console.error('Enhanced search error:', error);
      return of([]);
    }
  }

  private calculateRelevanceScore(query: string, document: SearchDocument, chunk: SearchChunk): number {
    const queryLower = query.toLowerCase();
    const searchTerms = this.extractSearchTerms(query);
    let score = 0;

    // Title matching (highest weight)
    const titleLower = document.title.toLowerCase();
    if (titleLower.includes(queryLower)) {
      score += 30;
    }
    searchTerms.forEach(term => {
      if (titleLower.includes(term)) {
        score += 20;
      }
    });

    // Category matching (medium weight)
    const categoryLower = document.category.toLowerCase();
    if (categoryLower.includes(queryLower)) {
      score += 15;
    }
    searchTerms.forEach(term => {
      if (categoryLower.includes(term)) {
        score += 10;
      }
    });

    // Content matching (lower weight but essential)
    const contentLower = chunk.text.toLowerCase();
    if (contentLower.includes(queryLower)) {
      score += 5;
    }
    searchTerms.forEach(term => {
      const termCount = (contentLower.match(new RegExp(term, 'g')) || []).length;
      score += termCount * 2;
    });

    // Preview matching
    const previewLower = chunk.preview.toLowerCase();
    if (previewLower.includes(queryLower)) {
      score += 3;
    }
    searchTerms.forEach(term => {
      if (previewLower.includes(term)) {
        score += 2;
      }
    });

    return score;
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

  private extractSearchTerms(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 2)
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
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (age < maxAge) {
          const index = JSON.parse(cached);
          this.buildSearchIndex(index);
          console.log('Using cached enhanced search index');
        }
      }
    } catch (error) {
      console.warn('Failed to load cached search index:', error);
    }
  }

  /**
   * Filter documents to only show content from current version/state context
   */
  private getDocumentsForCurrentContext(): SearchDocument[] {
    const currentUrl = this.router.url;
    const allDocuments = Array.from(this.documentsMap.values());
    
    // If not in docs section, return all documents
    if (!currentUrl.startsWith('/docs')) {
      return allDocuments;
    }
    
    // Extract the doc path after /docs/
    const docPath = currentUrl.replace('/docs/', '').split('/')[0];
    
    // If we're at the docs root, use current version
    if (!docPath) {
      const currentVersion = this.versionService.currentVersion();
      return this.filterDocumentsByVersion(allDocuments, currentVersion);
    }
    
    // Check if this is a state route (proposals, drafts, etc.)
    const availableStates = this.versionService.availableStates();
    const matchingState = availableStates.find(s => s.state === docPath);
    
    if (matchingState) {
      // Filter by state
      return this.filterDocumentsByState(allDocuments, docPath);
    } else {
      // Check if this is a version route
      const availableVersions = this.versionService.availableVersions();
      const matchingVersion = availableVersions.find(v => v.version === docPath);
      
      if (matchingVersion) {
        // Filter by specific version
        return this.filterDocumentsByVersion(allDocuments, docPath);
      } else {
        // This might be a sub-path within a version, use current version
        const currentVersion = this.versionService.currentVersion();
        return this.filterDocumentsByVersion(allDocuments, currentVersion);
      }
    }
  }

  private filterDocumentsByVersion(documents: SearchDocument[], targetVersion: string): SearchDocument[] {
    return documents.filter(doc => {
      const slugParts = doc.slug.split('/');
      const docVersion = slugParts[0];
      
      // Include documents that belong to the target version
      // Exclude _folder entries (they're handled by Overview pages)
      if (docVersion === targetVersion) {
        const isVersionFolder = doc.slug === `${targetVersion}/_folder`;
        return !isVersionFolder;
      }
      return false;
    });
  }

  private filterDocumentsByState(documents: SearchDocument[], targetState: string): SearchDocument[] {
    return documents.filter(doc => {
      const slugParts = doc.slug.split('/');
      const docState = slugParts[0];
      
      // Include documents that belong to the target state
      // Exclude _folder entries (they're handled by Overview pages)
      if (docState === targetState) {
        const isStateFolder = doc.slug === `${targetState}/_folder`;
        return !isStateFolder;
      }
      return false;
    });
  }
}
