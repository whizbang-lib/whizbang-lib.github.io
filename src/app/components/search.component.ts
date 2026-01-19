import { Component, ElementRef, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { Popover } from 'primeng/popover';
import { SearchService, SearchResult } from '../services/search.service';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

@Component({
  selector: 'wb-search',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, ButtonModule, PopoverModule],
  template: `
    <div class="search-container">
      <div class="p-inputgroup">
        <input 
          #searchInput
          type="text" 
          pInputText 
          placeholder="Search documentation..." 
          [(ngModel)]="searchQuery"
          (input)="onSearchInput()"
          (keydown.enter)="onEnterKey()"
          (focus)="onFocus()"
          class="search-input"
        />
        <button 
          pButton 
          type="button" 
          icon="pi pi-search"
          (click)="onSearchClick()"
          [disabled]="!searchQuery.trim()"
        ></button>
        <button 
          *ngIf="searchQuery.trim()"
          pButton 
          type="button" 
          icon="pi pi-times"
          (click)="clearSearch()"
          class="p-button-text"
        ></button>
      </div>

      <p-popover
        #searchOverlay
        styleClass="search-overlay"
        appendTo="body"
      >
        <div class="search-results-container" *ngIf="searchResults.length > 0">
          <div class="search-results-header">
            <span class="search-results-count">{{searchResults.length}} result{{searchResults.length !== 1 ? 's' : ''}}</span>
          </div>
          
          <div class="search-results-body">
            <div 
              *ngFor="let result of searchResults; trackBy: trackByResult" 
              class="search-result-item"
              (click)="navigateToResult(result)"
            >
              <div class="search-result-title">{{result.document.title}}</div>
              <div class="search-result-category">{{result.document.category}}</div>
              <div class="search-result-preview" [innerHTML]="result.highlightedPreview"></div>
            </div>
          </div>
        </div>

        <div class="search-no-results" *ngIf="searchQuery.trim() && searchResults.length === 0 && !isSearching">
          <div class="text-center p-4">
            <i class="pi pi-search text-4xl text-400 mb-3"></i>
            <p class="text-600">No results found for "{{searchQuery}}"</p>
            <p class="text-500 text-sm">Try different keywords or check spelling</p>
          </div>
        </div>

        <div class="search-loading" *ngIf="isSearching">
          <div class="text-center p-4">
            <i class="pi pi-spin pi-spinner text-2xl text-400"></i>
            <p class="text-600 mt-2">Searching...</p>
          </div>
        </div>
      </p-popover>
    </div>
  `,
  styles: [`
    .search-container {
      position: relative;
    }

    .search-input {
      min-width: 300px;
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
      font-weight: 500;
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
      font-size: 0.875rem;
      color: var(--text-color-secondary);
      font-weight: 500;
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
      
      .search-input {
        min-width: 250px;
      }
    }

    .search-result-item {
      padding: 1rem;
      border-bottom: 1px solid var(--surface-border);
      cursor: pointer;
      transition: background-color 0.2s, box-shadow 0.2s;
    }

    .search-result-item:hover {
      background: var(--surface-hover);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .search-result-item:last-child {
      border-bottom: none;
    }

    .search-result-title {
      font-weight: 600;
      color: var(--primary-color);
      margin-bottom: 0.25rem;
    }

    .search-result-category {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }

    .search-result-preview {
      font-size: 0.875rem;
      line-height: 1.4;
      color: var(--text-color);
    }

    .search-result-preview :host ::ng-deep mark {
      background: var(--yellow-100);
      color: var(--yellow-900);
      padding: 0.125rem 0.25rem;
      border-radius: 2px;
      font-weight: 500;
    }

    :host ::ng-deep mark.search-highlight {
      background: var(--yellow-200);
      color: var(--yellow-900);
      padding: 0.125rem 0.25rem;
      border-radius: 2px;
      font-weight: 500;
    }

    /* Improved overlay positioning */
    :host ::ng-deep .search-overlay .p-popover-flipped {
      margin-top: 10px;
    }

    :host ::ng-deep .search-overlay.p-popover {
      transform-origin: top center;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: scale(0.95) translateY(-10px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
  `]
})
export class SearchComponent implements OnInit, OnDestroy {
  @ViewChild('searchOverlay') searchOverlay!: Popover;
  @ViewChild('searchInput') searchInput!: ElementRef;

  searchQuery = '';
  searchResults: SearchResult[] = [];
  isSearching = false;

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  constructor(
    private searchService: SearchService,
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

    // Load current search state
    this.searchService.getCurrentQuery().pipe(
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.searchQuery = query;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput() {
    this.searchSubject.next(this.searchQuery);
  }

  onSearchClick() {
    if (this.searchQuery.trim()) {
      this.performSearch(this.searchQuery);
    }
  }

  onEnterKey() {
    if (this.searchResults.length > 0) {
      this.navigateToResult(this.searchResults[0]);
    }
  }

  onFocus() {
    if (this.searchQuery.trim() && this.searchResults.length > 0) {
      // Use a small delay to ensure proper positioning
      setTimeout(() => {
        this.searchOverlay.show(null, this.searchInput.nativeElement);
      }, 10);
    }
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
    this.searchService.clearSearch();
    this.searchOverlay.hide();
  }

  navigateToResult(result: SearchResult) {
    console.log('=== Search Navigation Debug ===');
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
        console.log('✅ Search navigation successful!');
      } else {
        console.warn('❌ Navigation failed');
      }
    }).catch(error => {
      console.error('Navigation error:', error);
    });
    
    console.log('=== End Search Navigation Debug ===');
  }

  trackByResult(index: number, result: SearchResult): string {
    return result.chunk?.id || `${result.document.url}-${index}`;
  }

  private performSearch(query: string) {
    if (!query.trim()) {
      this.searchResults = [];
      this.searchOverlay.hide();
      return;
    }

    this.isSearching = true;
    this.searchService.search(query).subscribe({
      next: (results) => {
        this.searchResults = results;
        this.isSearching = false;
        
        // Use a small delay to ensure proper positioning after results change
        setTimeout(() => {
          this.searchOverlay.show(null, this.searchInput.nativeElement);
        }, 50);
      },
      error: (error) => {
        console.error('Search error:', error);
        this.isSearching = false;
        this.searchResults = [];
      }
    });
  }
}
