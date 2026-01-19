import { Component, ElementRef, ViewChild, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { PopoverModule } from 'primeng/popover';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { CheckboxModule } from 'primeng/checkbox';
import { Popover } from 'primeng/popover';
import { EnhancedSearchService, EnhancedSearchResult } from '../services/enhanced-search.service';
import { VersionService } from '../services/version.service';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, switchMap } from 'rxjs';

@Component({
  selector: 'wb-enhanced-search',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, ButtonModule, IconFieldModule, InputIconModule, PopoverModule, AutoCompleteModule, CheckboxModule],
  template: `
    <div class="search-container">
      <p-iconField iconPosition="left" class="search-field">
        <p-inputIcon 
          styleClass="pi pi-search cursor-pointer"
          (click)="onSearchClick()"
        ></p-inputIcon>
        <input 
          #searchInput
          type="text" 
          pInputText 
          placeholder="Search documentation..." 
          [(ngModel)]="searchQuery"
          (input)="onSearchInput()"
          (keydown.enter)="onEnterKey()"
          (keydown.arrowdown)="onArrowDown()"
          (keydown.arrowup)="onArrowUp()"
          (keydown.escape)="clearSearch()"
          (focus)="onFocus()"
          class="search-input"
          autocomplete="off"
        />
        <p-inputIcon 
          *ngIf="searchQuery.trim()"
          styleClass="pi pi-times cursor-pointer clear-icon"
          (click)="clearSearch()"
        ></p-inputIcon>
      </p-iconField>

      <p-popover
        #searchOverlay
        styleClass="search-overlay"
      >
        <!-- Auto-suggestions -->
        <div class="search-suggestions" *ngIf="suggestions.length > 0 && !searchResults.length && searchQuery.length > 0 && searchQuery.length < 3">
          <div class="search-suggestions-header">
            <span class="text-sm text-500">Suggestions</span>
          </div>
          <div 
            *ngFor="let suggestion of suggestions; let i = index" 
            class="search-suggestion-item"
            [class.selected]="i === selectedSuggestionIndex"
            (click)="applySuggestion(suggestion)"
          >
            <i class="pi pi-search text-400 mr-2"></i>
            <span>{{suggestion}}</span>
          </div>
        </div>

        <!-- Search results -->
        <div class="search-results-container" *ngIf="searchResults.length > 0">
          <div class="search-results-header">
            <div class="search-results-info">
              <span class="search-results-count">
                {{searchResults.length}} result{{searchResults.length !== 1 ? 's' : ''}}
                <span class="text-400 text-sm ml-2" *ngIf="searchTime">({{searchTime}}ms)</span>
              </span>
              <span class="search-version-info" *ngIf="!searchAllVersions">
                in {{versionService.currentVersion()}}
              </span>
            </div>
            <div class="search-options">
              <p-checkbox 
                [(ngModel)]="searchAllVersions" 
                [binary]="true" 
                (onChange)="onVersionFilterChange()"
                inputId="search-all-versions"
              ></p-checkbox>
              <label for="search-all-versions" class="search-option-label">All versions</label>
            </div>
          </div>
          
          <div class="search-results-body">
            <div 
              *ngFor="let result of searchResults; let i = index; trackBy: trackByResult" 
              class="search-result-item"
              [class.selected]="i === selectedResultIndex"
              (click)="navigateToResult(result)"
            >
              <div class="search-result-header">
                <div class="search-result-title">{{result.document.title}}</div>
                <div class="search-result-category">{{result.document.category}}</div>
                <div class="search-result-score" *ngIf="showScores">
                  {{result.score | number:'1.2-2'}}
                </div>
              </div>
              <div class="search-result-preview" [innerHTML]="result.highlightedPreview"></div>
              <div class="search-result-terms" *ngIf="result.terms?.length">
                <span *ngFor="let term of result.terms" class="search-term-tag">{{term}}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- No results -->
        <div class="search-no-results" *ngIf="searchQuery.trim() && searchResults.length === 0 && !isSearching && !suggestions.length">
          <div class="text-center p-4">
            <i class="pi pi-search text-4xl text-400 mb-3"></i>
            <p class="text-600">No results found for "{{searchQuery}}"</p>
            <p class="text-500 text-sm">Try different keywords, check spelling, or use fewer terms</p>
            <div class="mt-3">
              <button 
                pButton 
                type="button" 
                label="Try fuzzy search" 
                class="p-button-sm p-button-text"
                (click)="tryFuzzySearch()"
                *ngIf="!usedFuzzySearch"
              ></button>
            </div>
          </div>
        </div>

        <!-- Loading -->
        <div class="search-loading" *ngIf="isSearching">
          <div class="text-center p-4">
            <i class="pi pi-spin pi-spinner text-2xl text-400"></i>
            <p class="text-600 mt-2">Searching...</p>
          </div>
        </div>

        <!-- Index not ready -->
        <div class="search-not-ready" *ngIf="!isIndexReady && !isSearching">
          <div class="text-center p-4">
            <i class="pi pi-clock text-2xl text-400"></i>
            <p class="text-600 mt-2">Preparing search index...</p>
          </div>
        </div>
      </p-popover>
    </div>
  `,
  styles: [`
    .search-container {
      position: relative;
    }

    .search-field {
      min-width: 300px;
    }

    .search-input {
      width: 100%;
    }

    :host ::ng-deep .search-field .p-inputtext {
      padding-left: 2.5rem;
    }

    :host ::ng-deep .search-field .clear-icon {
      right: 0.75rem;
      left: auto;
      color: var(--text-color-secondary);
      transition: color 0.2s;
    }

    :host ::ng-deep .search-field .clear-icon:hover {
      color: var(--text-color);
    }

    :host ::ng-deep .search-overlay {
      width: 500px;
      max-width: 90vw;
      max-height: 80vh;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
      border-radius: 8px;
    }

    :host ::ng-deep .search-overlay .p-popover-content {
      padding: 0;
      max-height: 80vh;
      overflow: hidden;
    }

    .search-results-container {
      display: flex;
      flex-direction: column;
      max-height: 80vh;
      min-height: 120px;
      width: 100%;
    }

    .search-results-header {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--surface-border);
      background: var(--surface-50);
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }

    .search-results-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .search-version-info {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      font-style: italic;
    }

    .search-options {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .search-option-label {
      font-size: 0.875rem;
      color: var(--text-color);
      cursor: pointer;
      user-select: none;
    }

    .search-results-body {
      overflow-y: auto;
      max-height: calc(80vh - 50px);
      min-height: 0;
      scrollbar-width: thin;
      scrollbar-color: var(--surface-300) var(--surface-100);
      flex: 1;
    }

    .search-results-body::-webkit-scrollbar {
      width: 6px;
    }

    .search-results-body::-webkit-scrollbar-track {
      background: var(--surface-100);
    }

    .search-results-body::-webkit-scrollbar-thumb {
      background: var(--surface-300);
      border-radius: 3px;
    }

    .search-results-body::-webkit-scrollbar-thumb:hover {
      background: var(--surface-400);
    }

    .search-results-count {
      font-weight: 600;
      color: var(--text-color);
    }

    .search-result-item {
      padding: 1rem;
      border-bottom: 1px solid var(--surface-border);
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .search-result-item:hover,
    .search-result-item.selected {
      background: var(--surface-100);
    }

    .search-result-item:last-child {
      border-bottom: none;
    }

    .search-result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .search-result-title {
      font-weight: 600;
      color: var(--text-color);
      font-size: 0.95rem;
    }

    .search-result-category {
      font-size: 0.8rem;
      color: var(--text-color-secondary);
      background: var(--surface-200);
      padding: 0.25rem 0.5rem;
      border-radius: 12px;
    }

    .search-result-score {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      font-family: monospace;
    }

    .search-result-preview {
      color: var(--text-color-secondary);
      font-size: 0.9rem;
      line-height: 1.4;
      margin-bottom: 0.5rem;
    }

    .search-result-terms {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
    }

    .search-term-tag {
      background: var(--primary-100);
      color: var(--primary-700);
      padding: 0.125rem 0.375rem;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .search-suggestions {
      max-height: 200px;
      overflow-y: auto;
    }

    .search-suggestions-header {
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--surface-border);
      background: var(--surface-50);
    }

    .search-suggestion-item {
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
    }

    .search-suggestion-item:hover,
    .search-suggestion-item.selected {
      background: var(--surface-100);
    }

    .search-no-results {
      padding: 2rem 1rem;
    }

    .search-loading {
      padding: 2rem 1rem;
    }

    .search-not-ready {
      padding: 2rem 1rem;
    }

    :host ::ng-deep mark.search-highlight {
      background: var(--yellow-200);
      color: var(--yellow-900);
      padding: 0.125rem 0.25rem;
      border-radius: 2px;
      font-weight: 600;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      :host ::ng-deep .search-overlay {
        width: 95vw;
        max-height: 60vh;
      }
      
      .search-results-container {
        max-height: 60vh;
      }
      
      .search-results-body {
        max-height: calc(60vh - 50px);
      }
      
      .search-field {
        min-width: 250px;
      }
      
      .search-suggestions {
        max-height: 150px;
      }
    }

    @media (max-width: 480px) {
      :host ::ng-deep .search-overlay {
        width: 98vw;
        max-height: 50vh;
      }
      
      .search-results-container {
        max-height: 50vh;
      }
      
      .search-results-body {
        max-height: calc(50vh - 50px);
      }
      
      .search-field {
        min-width: 200px;
      }
      
      .search-result-item {
        padding: 0.75rem;
      }
      
      .search-result-title {
        font-size: 0.9rem;
      }
      
      .search-result-preview {
        font-size: 0.85rem;
      }
    }
  `]
})
export class EnhancedSearchComponent implements OnInit, OnDestroy {
  @ViewChild('searchOverlay') searchOverlay!: Popover;
  @ViewChild('searchInput') searchInput!: ElementRef;

  searchQuery = '';
  searchResults: EnhancedSearchResult[] = [];
  suggestions: string[] = [];
  isSearching = false;
  isIndexReady = false;
  selectedResultIndex = -1;
  selectedSuggestionIndex = -1;
  showScores = false; // Set to true for debugging
  searchTime: number | null = null;
  usedFuzzySearch = false;
  searchAllVersions = false;

  readonly versionService = inject(VersionService);

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();
  private suggestionSubject = new Subject<string>();

  constructor(
    private searchService: EnhancedSearchService,
    private router: Router
  ) {}

  ngOnInit() {
    // Set up debounced search
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.performSearch(query);
    });

    // Set up auto-suggestions
    this.suggestionSubject.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap(query => {
        if (query.length > 0 && query.length < 3) {
          return this.searchService.autoSuggest(query);
        }
        return [];
      }),
      takeUntil(this.destroy$)
    ).subscribe(suggestions => {
      this.suggestions = suggestions;
    });

    // Monitor index readiness
    this.searchService.isIndexReady().pipe(
      takeUntil(this.destroy$)
    ).subscribe(ready => {
      this.isIndexReady = ready;
      console.log('Enhanced search index ready:', ready);
    });

    // Load current search state
    this.searchService.getCurrentQuery().pipe(
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.searchQuery = query;
    });

    // Initialize the search index
    this.searchService.initializeIndex().subscribe({
      next: () => console.log('Enhanced search service initialized'),
      error: (error: any) => console.error('Enhanced search initialization error:', error)
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput() {
    this.searchSubject.next(this.searchQuery);
    this.suggestionSubject.next(this.searchQuery);
    this.selectedResultIndex = -1;
    this.selectedSuggestionIndex = -1;
    this.usedFuzzySearch = false;
  }

  onSearchClick() {
    if (this.searchQuery.trim()) {
      this.performSearch(this.searchQuery);
    }
  }

  onEnterKey() {
    if (this.suggestions.length > 0 && this.selectedSuggestionIndex >= 0) {
      this.applySuggestion(this.suggestions[this.selectedSuggestionIndex]);
    } else if (this.searchResults.length > 0) {
      const index = Math.max(0, this.selectedResultIndex);
      this.navigateToResult(this.searchResults[index]);
    }
  }

  onArrowDown() {
    if (this.suggestions.length > 0) {
      this.selectedSuggestionIndex = Math.min(this.selectedSuggestionIndex + 1, this.suggestions.length - 1);
    } else if (this.searchResults.length > 0) {
      this.selectedResultIndex = Math.min(this.selectedResultIndex + 1, this.searchResults.length - 1);
    }
  }

  onArrowUp() {
    if (this.suggestions.length > 0) {
      this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
    } else if (this.searchResults.length > 0) {
      this.selectedResultIndex = Math.max(this.selectedResultIndex - 1, -1);
    }
  }

  onFocus() {
    if (this.searchQuery.trim() && this.searchResults.length > 0) {
      this.searchOverlay.show(null, this.searchInput.nativeElement);
    }
  }

  applySuggestion(suggestion: string) {
    this.searchQuery = suggestion;
    this.suggestions = [];
    this.performSearch(suggestion);
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
    this.suggestions = [];
    this.selectedResultIndex = -1;
    this.selectedSuggestionIndex = -1;
    this.searchService.clearSearch();
    this.searchOverlay.hide();
    this.usedFuzzySearch = false;
  }

  tryFuzzySearch() {
    this.usedFuzzySearch = true;
    this.performSearch(this.searchQuery, { fuzzy: 0.4 });
  }

  onVersionFilterChange() {
    if (this.searchQuery.trim()) {
      this.performSearch(this.searchQuery);
    }
  }

  navigateToResult(result: EnhancedSearchResult) {
    console.log('=== Enhanced Search Navigation Debug ===');
    console.log('Original URL:', result.document.url);
    console.log('Document title:', result.document.title);
    console.log('Document category:', result.document.category);
    
    this.searchOverlay.hide();
    
    // Split URL into segments to avoid %2F encoding
    const urlParts = result.document.url.split('/').filter(part => part);
    console.log('URL parts:', urlParts);
    
    this.router.navigate(urlParts).then(success => {
      console.log('Navigation result:', success);
      if (success) {
        console.log('✅ Enhanced search navigation successful!');
      } else {
        console.warn('❌ Navigation failed');
      }
    }).catch(error => {
      console.error('Navigation error:', error);
    });
    
    console.log('=== End Enhanced Search Navigation Debug ===');
  }

  trackByResult(index: number, result: EnhancedSearchResult): string {
    return result.chunk.id;
  }

  private performSearch(query: string, options?: { fuzzy?: number }) {
    if (!query.trim()) {
      this.searchResults = [];
      this.suggestions = [];
      this.searchOverlay.hide();
      return;
    }

    console.log('Performing enhanced search for:', query);
    this.isSearching = true;
    const startTime = performance.now();

    const searchOptions = {
      ...options,
      filterByCurrentVersion: !this.searchAllVersions
    };

    const searchObservable = this.searchAllVersions 
      ? this.searchService.searchAllVersions(query, options)
      : this.searchService.search(query, searchOptions);

    searchObservable.subscribe({
      next: (results) => {
        console.log('Enhanced search results:', results);
        this.searchResults = results;
        this.isSearching = false;
        this.searchTime = Math.round(performance.now() - startTime);
        this.selectedResultIndex = -1;
        
        // Always show overlay when we have results, like the original search
        if (results.length > 0) {
          this.searchOverlay.show(null, this.searchInput.nativeElement);
        } else {
          this.searchOverlay.show(null, this.searchInput.nativeElement);
        }
      },
      error: (error) => {
        console.error('Enhanced search error:', error);
        this.isSearching = false;
        this.searchResults = [];
        this.searchTime = null;
      }
    });
  }
}
