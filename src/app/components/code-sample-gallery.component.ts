import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { MultiSelectModule } from 'primeng/multiselect';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DataViewModule } from 'primeng/dataview';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { BadgeModule } from 'primeng/badge';

import { CodeSampleService } from '../services/code-sample.service';
import { CodeSampleMetadata } from './advanced-code-sample.component';

interface FilterOptions {
  framework?: string;
  difficulty?: string;
  tags?: string[];
  search?: string;
}

@Component({
  selector: 'wb-code-sample-gallery',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    MultiSelectModule,
    TagModule,
    ChipModule,
    ProgressSpinnerModule,
    DataViewModule,
    SkeletonModule,
    TooltipModule,
    BadgeModule
  ],
  template: `
    <div class="code-sample-gallery">
      <!-- Header -->
      <div class="gallery-header">
        <div class="header-content">
          <h2 class="gallery-title">Code Sample Gallery</h2>
          <p class="gallery-description">
            Explore our collection of interactive code examples with live demos and source code.
          </p>
        </div>
        
        <div class="gallery-stats" *ngIf="stats">
          <div class="stat-item">
            <span class="stat-number">{{ stats.totalSamples }}</span>
            <span class="stat-label">Samples</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">{{ Object.keys(stats.frameworkCounts).length }}</span>
            <span class="stat-label">Frameworks</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">{{ Object.keys(stats.tagCounts).length }}</span>
            <span class="stat-label">Tags</span>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="gallery-filters">
        <div class="filter-row">
          <!-- Search -->
          <div class="search-field">
            <span class="p-input-icon-left">
              <i class="pi pi-search"></i>
              <input 
                type="text" 
                pInputText 
                placeholder="Search samples..." 
                [(ngModel)]="searchQuery"
                (input)="onSearchInput()"
                class="search-input"
              />
            </span>
          </div>

          <!-- Framework Filter -->
          <div class="filter-field">
            <p-dropdown
              [options]="frameworkOptions"
              [(ngModel)]="selectedFramework"
              placeholder="All Frameworks"
              [showClear]="true"
              (onChange)="applyFilters()"
              styleClass="framework-dropdown"
            ></p-dropdown>
          </div>

          <!-- Difficulty Filter -->
          <div class="filter-field">
            <p-dropdown
              [options]="difficultyOptions"
              [(ngModel)]="selectedDifficulty"
              placeholder="All Difficulties"
              [showClear]="true"
              (onChange)="applyFilters()"
              styleClass="difficulty-dropdown"
            ></p-dropdown>
          </div>

          <!-- Tags Filter -->
          <div class="filter-field">
            <p-multiSelect
              [options]="tagOptions"
              [(ngModel)]="selectedTags"
              placeholder="Filter by tags"
              [showClear]="true"
              [showHeader]="false"
              (onChange)="applyFilters()"
              styleClass="tags-multiselect"
              [maxSelectedLabels]="2"
              selectedItemsLabel="{0} tags selected"
            ></p-multiSelect>
          </div>

          <!-- Clear Filters -->
          <div class="filter-actions">
            <button 
              pButton 
              type="button" 
              icon="pi pi-filter-slash" 
              label="Clear"
              class="p-button-outlined p-button-sm"
              (click)="clearFilters()"
              [disabled]="!hasActiveFilters()"
              pTooltip="Clear all filters"
            ></button>
          </div>
        </div>

        <!-- Active Filters Display -->
        <div class="active-filters" *ngIf="hasActiveFilters()">
          <span class="filters-label">Active filters:</span>
          
          <p-chip 
            *ngIf="selectedFramework" 
            [label]="'Framework: ' + selectedFramework"
            [removable]="true"
            (onRemove)="removeFrameworkFilter()"
            styleClass="filter-chip"
          ></p-chip>
          
          <p-chip 
            *ngIf="selectedDifficulty" 
            [label]="'Difficulty: ' + selectedDifficulty"
            [removable]="true"
            (onRemove)="removeDifficultyFilter()"
            styleClass="filter-chip"
          ></p-chip>
          
          <p-chip 
            *ngFor="let tag of selectedTags || []"
            [label]="'Tag: ' + tag"
            [removable]="true"
            (onRemove)="removeTagFilter(tag)"
            styleClass="filter-chip"
          ></p-chip>
          
          <p-chip 
            *ngIf="searchQuery?.trim()" 
            [label]="'Search: ' + searchQuery"
            [removable]="true"
            (onRemove)="clearSearch()"
            styleClass="filter-chip"
          ></p-chip>
        </div>
      </div>

      <!-- Results Count -->
      <div class="results-info">
        <span class="results-count" *ngIf="!loading">
          {{ filteredSamples.length }} sample{{ filteredSamples.length !== 1 ? 's' : '' }} found
        </span>
        <div class="loading-indicator" *ngIf="loading">
          <p-progressSpinner styleClass="small-spinner" strokeWidth="3"></p-progressSpinner>
          <span>Loading samples...</span>
        </div>
      </div>

      <!-- Samples Grid -->
      <div class="samples-grid" *ngIf="!loading">
        <div 
          *ngFor="let sample of filteredSamples; trackBy: trackBySample" 
          class="sample-card-wrapper"
        >
          <p-card class="sample-card" styleClass="sample-card">
            <!-- Card Header -->
            <ng-template pTemplate="header">
              <div class="card-header">
                <div class="sample-meta">
                  <div class="framework-badge" *ngIf="sample.framework">
                    <p-tag 
                      [value]="sample.framework" 
                      severity="info"
                      icon="pi pi-code"
                    ></p-tag>
                  </div>
                  
                  <div class="difficulty-badge" *ngIf="sample.difficulty">
                    <p-tag 
                      [value]="sample.difficulty" 
                      [severity]="getDifficultySeverity(sample.difficulty)"
                      icon="pi pi-star"
                    ></p-tag>
                  </div>
                </div>
                
                <div class="file-count">
                  <i class="pi pi-file"></i>
                  <span>{{ sample.files.length }} files</span>
                </div>
              </div>
            </ng-template>

            <!-- Card Content -->
            <ng-template pTemplate="content">
              <div class="sample-content">
                <h4 class="sample-title">{{ sample.title }}</h4>
                <p class="sample-description">{{ sample.description }}</p>
                
                <div class="sample-tags" *ngIf="sample.tags?.length">
                  <p-chip 
                    *ngFor="let tag of sample.tags | slice:0:4" 
                    [label]="tag"
                    styleClass="tag-chip"
                  ></p-chip>
                  <span *ngIf="sample.tags.length > 4" class="more-tags">
                    +{{ sample.tags.length - 4 }} more
                  </span>
                </div>
              </div>
            </ng-template>

            <!-- Card Footer -->
            <ng-template pTemplate="footer">
              <div class="sample-actions">
                <button 
                  pButton 
                  type="button" 
                  icon="pi pi-eye" 
                  label="View Code"
                  class="p-button-outlined p-button-sm"
                  (click)="viewSample(sample)"
                  pTooltip="View code sample"
                ></button>
                
                <button 
                  pButton 
                  type="button" 
                  icon="pi pi-external-link" 
                  class="p-button-text p-button-sm"
                  *ngIf="sample.stackblitzUrl"
                  (click)="openExternal(sample.stackblitzUrl!)"
                  pTooltip="Open in StackBlitz"
                ></button>
                
                <button 
                  pButton 
                  type="button" 
                  icon="pi pi-github" 
                  class="p-button-text p-button-sm"
                  *ngIf="sample.githubRepo"
                  (click)="openExternal(sample.githubRepo!)"
                  pTooltip="View on GitHub"
                ></button>
                
                <button 
                  pButton 
                  type="button" 
                  icon="pi pi-play" 
                  class="p-button-text p-button-sm"
                  *ngIf="sample.demoUrl"
                  (click)="openExternal(sample.demoUrl!)"
                  pTooltip="Live demo"
                ></button>
              </div>
            </ng-template>
          </p-card>
        </div>
      </div>

      <!-- Loading Skeletons -->
      <div class="samples-grid" *ngIf="loading">
        <div *ngFor="let i of [1,2,3,4,5,6]" class="sample-card-wrapper">
          <p-card class="sample-card skeleton-card">
            <ng-template pTemplate="header">
              <p-skeleton height="2rem" class="mb-2"></p-skeleton>
            </ng-template>
            <ng-template pTemplate="content">
              <p-skeleton height="1.5rem" class="mb-3"></p-skeleton>
              <p-skeleton height="4rem" class="mb-3"></p-skeleton>
              <div class="flex gap-2">
                <p-skeleton width="4rem" height="1.5rem"></p-skeleton>
                <p-skeleton width="3rem" height="1.5rem"></p-skeleton>
              </div>
            </ng-template>
            <ng-template pTemplate="footer">
              <div class="flex gap-2">
                <p-skeleton width="6rem" height="2rem"></p-skeleton>
                <p-skeleton width="2rem" height="2rem"></p-skeleton>
              </div>
            </ng-template>
          </p-card>
        </div>
      </div>

      <!-- Empty State -->
      <div class="empty-state" *ngIf="!loading && filteredSamples.length === 0">
        <div class="empty-content">
          <i class="pi pi-search empty-icon"></i>
          <h3>No samples found</h3>
          <p>Try adjusting your filters or search terms.</p>
          <button 
            pButton 
            type="button" 
            label="Clear Filters" 
            class="p-button-outlined"
            (click)="clearFilters()"
            *ngIf="hasActiveFilters()"
          ></button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./code-sample-gallery.component.scss']
})
export class CodeSampleGalleryComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  filteredSamples: CodeSampleMetadata[] = [];
  allSamples: CodeSampleMetadata[] = [];
  loading = true;
  
  // Filter options
  frameworkOptions: { label: string; value: string }[] = [];
  difficultyOptions: { label: string; value: string }[] = [];
  tagOptions: { label: string; value: string }[] = [];
  
  // Selected filters
  selectedFramework: string | null = null;
  selectedDifficulty: string | null = null;
  selectedTags: string[] = [];
  searchQuery = '';
  
  // Stats
  stats: any = null;

  constructor(
    private codeSampleService: CodeSampleService,
    private router: Router
  ) {}

  ngOnInit() {
    this.setupSearchDebounce();
    this.loadSamples();
    this.loadFilterOptions();
    this.loadStats();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupSearchDebounce() {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.applyFilters();
    });
  }

  private loadSamples() {
    this.codeSampleService.getAllSamples()
      .pipe(takeUntil(this.destroy$))
      .subscribe(samples => {
        this.allSamples = samples;
        this.filteredSamples = samples;
        this.loading = false;
      });
  }

  private loadFilterOptions() {
    // Load frameworks
    this.codeSampleService.getFrameworks()
      .pipe(takeUntil(this.destroy$))
      .subscribe(frameworks => {
        this.frameworkOptions = frameworks.map(f => ({ label: f, value: f }));
      });

    // Load difficulties
    this.codeSampleService.getDifficulties()
      .pipe(takeUntil(this.destroy$))
      .subscribe(difficulties => {
        this.difficultyOptions = difficulties.map(d => ({ 
          label: d.charAt(0).toUpperCase() + d.slice(1), 
          value: d 
        }));
      });

    // Load tags from all samples
    this.codeSampleService.getAllSamples()
      .pipe(takeUntil(this.destroy$))
      .subscribe(samples => {
        const allTags = new Set<string>();
        samples.forEach(sample => {
          sample.tags?.forEach(tag => allTags.add(tag));
        });
        this.tagOptions = Array.from(allTags).map(tag => ({ label: tag, value: tag }));
      });
  }

  private loadStats() {
    this.codeSampleService.getSampleStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => {
        this.stats = stats;
      });
  }

  onSearchInput() {
    this.searchSubject.next(this.searchQuery);
  }

  applyFilters() {
    const filters: FilterOptions = {
      framework: this.selectedFramework || undefined,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.selectedTags?.length ? this.selectedTags : undefined,
      search: this.searchQuery?.trim() || undefined
    };

    this.codeSampleService.filterSamples(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe(filtered => {
        this.filteredSamples = filtered;
      });
  }

  clearFilters() {
    this.selectedFramework = null;
    this.selectedDifficulty = null;
    this.selectedTags = [];
    this.searchQuery = '';
    this.filteredSamples = this.allSamples;
  }

  clearSearch() {
    this.searchQuery = '';
    this.applyFilters();
  }

  removeFrameworkFilter() {
    this.selectedFramework = null;
    this.applyFilters();
  }

  removeDifficultyFilter() {
    this.selectedDifficulty = null;
    this.applyFilters();
  }

  removeTagFilter(tag: string) {
    this.selectedTags = this.selectedTags.filter(t => t !== tag);
    this.applyFilters();
  }

  hasActiveFilters(): boolean {
    return !!(
      this.selectedFramework || 
      this.selectedDifficulty || 
      this.selectedTags?.length || 
      this.searchQuery?.trim()
    );
  }

  getDifficultySeverity(difficulty: string): 'success' | 'info' | 'warning' | 'danger' {
    switch (difficulty) {
      case 'beginner': return 'success';
      case 'intermediate': return 'info';
      case 'advanced': return 'warning';
      default: return 'info';
    }
  }

  viewSample(sample: CodeSampleMetadata) {
    // Navigate to a dedicated sample view page
    this.router.navigate(['/examples', sample.id]);
  }

  openExternal(url: string) {
    window.open(url, '_blank');
  }

  trackBySample(index: number, sample: CodeSampleMetadata): string {
    return sample.id;
  }
}
