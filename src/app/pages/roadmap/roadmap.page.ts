import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { TimelineModule } from 'primeng/timeline';
import { VersionService, VersionInfo, StateInfo } from '../../services/version.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'wb-roadmap',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, BadgeModule, TimelineModule],
  template: `
    <div class="roadmap-container">
      <!-- Header Section -->
      <section class="roadmap-header">
        <h1>Whizbang Roadmap</h1>
        <p class="roadmap-subtitle">
          Explore upcoming features, current development progress, and released versions of the Whizbang .NET library.
        </p>
      </section>

      <!-- Loading State -->
      <div *ngIf="versionService.isLoading()" class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p>Loading roadmap...</p>
      </div>

      <!-- Roadmap Content -->
      <div *ngIf="!versionService.isLoading()" class="roadmap-content">
        
        <!-- Version Timeline -->
        <section class="versions-section">
          <h2>Version Timeline</h2>
          <p-timeline [value]="timelineEvents()" layout="vertical" styleClass="version-timeline">
            <ng-template #content let-event>
              <div class="timeline-card" [class]="'timeline-' + event.type">
                <div class="timeline-header">
                  <h3>{{ event.version }}</h3>
                  <span class="version-badge" [class]="'badge-' + event.type">
                    {{ getBadgeText(event.type) }}
                  </span>
                </div>
                <h4>{{ event.displayName }}</h4>
                <p *ngIf="event.description" class="timeline-description">{{ event.description }}</p>
                
                <div class="timeline-meta">
                  <div *ngIf="event.releaseDate" class="meta-item">
                    <i class="pi pi-calendar"></i>
                    <span>Released: {{ formatDate(event.releaseDate) }}</span>
                  </div>
                  <div *ngIf="event.estimatedDate && !event.releaseDate" class="meta-item">
                    <i class="pi pi-clock"></i>
                    <span>Estimated: {{ formatDate(event.estimatedDate) }}</span>
                  </div>
                </div>

                <div class="timeline-actions">
                  <button 
                    pButton 
                    type="button" 
                    label="View Documentation" 
                    icon="pi pi-book"
                    class="p-button-outlined"
                    (click)="navigateToVersion(event.version)">
                  </button>
                </div>
              </div>
            </ng-template>
            
            <ng-template #marker let-event>
              <div class="timeline-marker" [class]="'marker-' + event.type">
                <i [class]="getTimelineIcon(event.type)"></i>
              </div>
            </ng-template>
          </p-timeline>
        </section>

        <!-- Documentation States -->
        <section class="states-section" *ngIf="documentationStates().length > 0">
          <h2>Documentation States</h2>
          <p class="states-description">
            Explore documentation for features in various stages of development and consideration.
          </p>
          
          <div class="states-grid">
            <div 
              *ngFor="let state of documentationStates()" 
              class="state-card"
              (click)="navigateToState(state.state)">
              <div class="state-header">
                <h3>{{ state.displayName }}</h3>
                <span class="state-count" *ngIf="state.count > 0">{{ state.count }}</span>
              </div>
              <p class="state-description">{{ state.description }}</p>
              <div class="state-actions">
                <button 
                  pButton 
                  type="button" 
                  label="Explore" 
                  icon="pi pi-arrow-right"
                  class="p-button-text">
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Release Statistics -->
        <section class="stats-section">
          <h2>Release Statistics</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-number">{{ getVersionCountByType('released') }}</div>
              <div class="stat-label">Released Versions</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">{{ getVersionCountByType('beta') + getVersionCountByType('alpha') }}</div>
              <div class="stat-label">In Development</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">{{ getVersionCountByType('planned') }}</div>
              <div class="stat-label">Planned Versions</div>
            </div>
            <div class="stat-card">
              <div class="stat-number">{{ getTotalDocumentationCount() }}</div>
              <div class="stat-label">Documentation Pages</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .roadmap-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .roadmap-header {
      text-align: center;
      margin-bottom: 3rem;
    }

    .roadmap-header h1 {
      font-size: 3rem;
      margin-bottom: 1rem;
      color: var(--primary-color);
    }

    .roadmap-subtitle {
      font-size: 1.2rem;
      color: var(--text-color-secondary);
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .loading-container {
      text-align: center;
      padding: 4rem 0;
      color: var(--text-color-secondary);
    }

    .roadmap-content {
      display: flex;
      flex-direction: column;
      gap: 4rem;
    }

    .versions-section h2,
    .states-section h2,
    .stats-section h2 {
      font-size: 2rem;
      margin-bottom: 1.5rem;
      color: var(--text-color);
    }

    /* Timeline Styles */
    :host ::ng-deep .version-timeline .p-timeline-event-content {
      padding: 0;
    }

    /* Hide the opposite content in timeline to fix alignment */
    :host ::ng-deep .version-timeline .p-timeline-event-opposite {
      display: none !important;
    }

    .timeline-card {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: 0.5rem;
      padding: 1.5rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .timeline-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }

    .timeline-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .timeline-header h3 {
      margin: 0;
      font-size: 1.2rem;
      color: var(--text-color);
    }

    .timeline-header h4 {
      margin: 0 0 1rem 0;
      font-size: 1rem;
      font-weight: 500;
      color: var(--text-color-secondary);
    }

    .version-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-released {
      background: #10b981;
      color: white;
    }

    .badge-beta {
      background: #3b82f6;
      color: white;
    }

    .badge-alpha {
      background: #f59e0b;
      color: white;
    }

    .badge-planned {
      background: #8b5cf6;
      color: white;
    }

    .timeline-description {
      color: var(--text-color-secondary);
      line-height: 1.6;
      margin-bottom: 1rem;
    }

    .timeline-meta {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    .timeline-actions {
      display: flex;
      gap: 0.5rem;
    }

    .timeline-marker {
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      color: white;
    }

    .marker-released {
      background: #10b981;
    }

    .marker-beta {
      background: #3b82f6;
    }

    .marker-alpha {
      background: #f59e0b;
    }

    .marker-planned {
      background: #8b5cf6;
    }

    /* States Section */
    .states-description {
      color: var(--text-color-secondary);
      margin-bottom: 2rem;
      line-height: 1.6;
    }

    .states-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .state-card {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: 0.5rem;
      padding: 1.5rem;
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .state-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }

    .state-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .state-header h3 {
      margin: 0;
      color: var(--text-color);
    }

    .state-count {
      background: var(--primary-color);
      color: var(--primary-color-text);
      padding: 0.25rem 0.5rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .state-description {
      color: var(--text-color-secondary);
      line-height: 1.6;
      margin-bottom: 1rem;
    }

    .state-actions {
      display: flex;
      justify-content: flex-end;
    }

    /* Stats Section */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
    }

    .stat-card {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: 0.5rem;
      padding: 2rem;
      text-align: center;
    }

    .stat-number {
      font-size: 3rem;
      font-weight: bold;
      color: var(--primary-color);
      margin-bottom: 0.5rem;
    }

    .stat-label {
      color: var(--text-color-secondary);
      font-weight: 500;
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .roadmap-container {
        padding: 1rem;
      }

      .roadmap-header h1 {
        font-size: 2rem;
      }

      .states-grid {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .timeline-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
      }
    }
  `]
})
export class RoadmapPage {
  readonly versionService = inject(VersionService);
  private readonly router = inject(Router);
  private readonly seoService = inject(SeoService);

  // Computed values for template
  readonly timelineEvents = computed(() => {
    const versions = this.versionService.availableVersions();
    return versions.map(version => ({
      ...version,
      date: version.releaseDate || version.estimatedDate
    })).sort((a, b) => {
      // Sort by status priority then by date
      const statusOrder = { 'released': 1, 'beta': 2, 'alpha': 3, 'planned': 4 };
      const statusA = statusOrder[a.type] || 999;
      const statusB = statusOrder[b.type] || 999;
      
      if (statusA !== statusB) {
        return statusA - statusB;
      }
      
      // Then by date (newest first for released, oldest first for planned)
      if (a.date && b.date) {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return a.type === 'released' ? dateB - dateA : dateA - dateB;
      }
      
      return 0;
    });
  });

  readonly documentationStates = computed(() => {
    return this.versionService.availableStates();
  });

  constructor() {
    // Set SEO metadata for roadmap page
    this.seoService.setPageMetadata({
      title: 'Whizbang Roadmap - Development Timeline & Future Features',
      description: 'Explore the Whizbang .NET library roadmap, including upcoming features, current development progress, and released versions.',
      keywords: 'whizbang roadmap, .NET library development, version timeline, upcoming features',
      type: 'website',
      url: `${window.location.origin}/roadmap`
    });
  }

  getBadgeText(type: string): string {
    const badges: Record<string, string> = {
      'released': 'Released',
      'beta': 'Beta',
      'alpha': 'Alpha', 
      'planned': 'Planned'
    };
    return badges[type] || 'Unknown';
  }

  getTimelineIcon(type: string): string {
    const icons: Record<string, string> = {
      'released': 'pi pi-check',
      'beta': 'pi pi-cog',
      'alpha': 'pi pi-play',
      'planned': 'pi pi-calendar'
    };
    return icons[type] || 'pi pi-circle';
  }

  formatDate(dateString: string): string {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  }

  navigateToVersion(version: string): void {
    this.router.navigate(['/docs', version]);
  }

  navigateToState(state: string): void {
    this.router.navigate(['/docs', state]);
  }

  getVersionCountByType(type: string): number {
    return this.versionService.availableVersions().filter(v => v.type === type).length;
  }

  getTotalDocumentationCount(): number {
    const versionedIndex = this.versionService.versionedIndex();
    return versionedIndex.reduce((total, item) => total + (item.docs?.length || 0), 0);
  }
}