import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { PopoverModule } from 'primeng/popover';
import { BadgeModule } from 'primeng/badge';
import { VersionService, VersionInfo, StateInfo } from '../services/version.service';
import { Router, NavigationEnd } from '@angular/router';
import { ScrollManagementService } from '../services/scroll-management.service';
import { filter, map, startWith } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'wb-version-selector',
  standalone: true,
  imports: [CommonModule, ButtonModule, TooltipModule, PopoverModule, BadgeModule],
  template: `
    <div class="version-selector-container">
      <!-- Current Version Button -->
      <button 
        pButton 
        type="button"
        class="p-button-outlined version-selector-btn"
        [pTooltip]="currentVersionTooltip()"
        tooltipPosition="bottom"
        (click)="versionPanel.toggle($event)"
        [attr.aria-label]="'Select version'">
        <span class="version-label">{{ currentVersionDisplay() }}</span>
        <i class="pi pi-chevron-down version-chevron"></i>
      </button>
      
      <!-- Version Selection Panel -->
      <p-popover #versionPanel styleClass="version-selector-panel">
        <div class="version-options">
          <h6>Documentation Version</h6>
          
          <!-- Released Versions -->
          <div class="version-section" *ngIf="releasedVersions().length > 0">
            <div class="section-title">Released</div>
            <div class="version-option-group">
              <button 
                type="button"
                class="version-option"
                *ngFor="let version of releasedVersions()"
[class.active]="currentContext().type === 'version' && currentContext().value === version.version"
                (click)="selectVersion(version.version)"
[attr.aria-pressed]="currentContext().type === 'version' && currentContext().value === version.version">
                <div class="version-info">
                  <span class="version-name">{{ version.displayName }}</span>
                  <span class="version-date" *ngIf="version.releaseDate">{{ formatDate(version.releaseDate) }}</span>
                </div>
                <span class="version-badge" [ngClass]="'badge-' + version.type">{{ version.type }}</span>
              </button>
            </div>
          </div>
          
          <!-- Development Versions -->
          <div class="version-section" *ngIf="developmentVersions().length > 0">
            <div class="section-title">Development</div>
            <div class="version-option-group">
              <button 
                type="button"
                class="version-option"
                *ngFor="let version of developmentVersions()"
[class.active]="currentContext().type === 'version' && currentContext().value === version.version"
                (click)="selectVersion(version.version)"
[attr.aria-pressed]="currentContext().type === 'version' && currentContext().value === version.version">
                <div class="version-info">
                  <span class="version-name">{{ version.displayName }}</span>
                  <span class="version-date" *ngIf="version.estimatedDate">Est. {{ formatDate(version.estimatedDate) }}</span>
                </div>
                <span class="version-badge" [ngClass]="'badge-' + version.type">{{ version.type }}</span>
              </button>
            </div>
          </div>
          
          <!-- Planned Versions -->
          <div class="version-section" *ngIf="plannedVersions().length > 0">
            <div class="section-title">Planned</div>
            <div class="version-option-group">
              <button 
                type="button"
                class="version-option"
                *ngFor="let version of plannedVersions()"
[class.active]="currentContext().type === 'version' && currentContext().value === version.version"
                (click)="selectVersion(version.version)"
[attr.aria-pressed]="currentContext().type === 'version' && currentContext().value === version.version">
                <div class="version-info">
                  <span class="version-name">{{ version.displayName }}</span>
                  <span class="version-date" *ngIf="version.estimatedDate">Est. {{ formatDate(version.estimatedDate) }}</span>
                </div>
                <span class="version-badge" [ngClass]="'badge-' + version.type">{{ version.type }}</span>
              </button>
            </div>
          </div>
          
          <!-- Documentation States -->
          <div class="version-section" *ngIf="availableStates().length > 0">
            <div class="section-title">Documentation States</div>
            <div class="version-option-group">
              <button 
                type="button"
                class="version-option state-option"
                *ngFor="let state of availableStates()"
                [class.active]="currentContext().type === 'state' && currentContext().value === state.state"
                (click)="selectState(state.state)"
                [attr.aria-pressed]="currentContext().type === 'state' && currentContext().value === state.state">
                <div class="version-info">
                  <span class="version-name">{{ state.displayName }}</span>
                  <span class="version-description">{{ state.description }}</span>
                </div>
                <span class="version-count">{{ state.count }}</span>
              </button>
            </div>
          </div>
          
          <div class="version-status">
            <small>
              Current: <strong>{{ currentContext().displayName }}</strong>
              <span *ngIf="currentContext().type === 'version' && currentVersionInfo()?.description"> - {{ currentVersionInfo()?.description }}</span>
              <span *ngIf="currentContext().type === 'state' && currentContext().stateInfo?.description"> - {{ currentContext().stateInfo?.description }}</span>
            </small>
          </div>
        </div>
      </p-popover>
    </div>
  `,
  styles: [`
    .version-selector-container {
      display: flex;
      align-items: center;
    }
    
    .version-selector-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 120px;
      justify-content: space-between;
      font-size: 0.875rem;
    }
    
    .version-label {
      font-weight: 500;
    }
    
    .version-chevron {
      font-size: 0.75rem;
      transition: transform 0.2s ease;
    }
    
    :host ::ng-deep .version-selector-panel .p-popover-content {
      padding: 0;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .version-options {
      padding: 1rem;
      min-width: 300px;
    }
    
    .version-options h6 {
      margin: 0 0 1rem 0;
      color: var(--text-color);
      font-size: 0.9rem;
      font-weight: 600;
    }
    
    .version-section {
      margin-bottom: 1rem;
    }
    
    .version-section:last-of-type {
      margin-bottom: 0;
    }
    
    .section-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-color-secondary);
      margin-bottom: 0.5rem;
      padding: 0 0.75rem;
    }
    
    .version-option-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    
    .version-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem;
      border: 1px solid var(--surface-border);
      border-radius: 0.375rem;
      background: var(--surface-card);
      color: var(--text-color);
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.875rem;
      text-align: left;
      width: 100%;
    }
    
    .version-option:hover:not(.disabled) {
      background: var(--surface-hover);
      border-color: var(--primary-color);
    }
    
    .version-option.active {
      background: var(--primary-color);
      color: var(--primary-color-text);
      border-color: var(--primary-color);
    }
    
    .version-option.disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .version-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;
    }
    
    .version-name {
      font-weight: 500;
    }
    
    .version-date,
    .version-description {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
    }
    
    .version-option.active .version-date,
    .version-option.active .version-description {
      color: rgba(255, 255, 255, 0.8);
    }
    
    .version-badge {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      white-space: nowrap;
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
    
    .version-count {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-color-secondary);
      background: var(--surface-border);
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      min-width: 1.5rem;
      text-align: center;
    }
    
    .state-option:hover .version-count {
      background: var(--primary-color);
      color: var(--primary-color-text);
    }
    
    .version-status {
      padding-top: 1rem;
      border-top: 1px solid var(--surface-border);
      color: var(--text-color-secondary);
      text-align: center;
    }
    
    .version-status strong {
      color: var(--text-color);
    }
  `]
})
export class VersionSelectorComponent {
  readonly versionService = inject(VersionService);
  private router = inject(Router);
  private scrollManagement = inject(ScrollManagementService);
  
  // Track current URL to understand context
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => event.urlAfterRedirects),
      startWith(this.router.url)
    )
  );
  
  // Determine current context from URL
  readonly currentContext = computed(() => {
    const url = this.currentUrl();
    if (url && url.startsWith('/docs/')) {
      // Extract the segment after /docs/
      const docPath = url.replace('/docs/', '').split('/')[0];
      
      // Check if this is a state by looking up in available states
      const availableStates = this.versionService.availableStates();
      const matchingState = availableStates.find(s => s.state === docPath);
      
      if (matchingState) {
        return {
          type: 'state' as const,
          value: docPath,
          displayName: matchingState.displayName,
          stateInfo: matchingState
        };
      }
    }
    
    // Default to version context
    const currentVersion = this.versionService.currentVersion();
    const versionInfo = this.versionService.getVersionInfo(currentVersion);
    return {
      type: 'version' as const,
      value: currentVersion,
      displayName: versionInfo?.displayName || currentVersion,
      versionInfo
    };
  });
  
  // Computed properties for reactive UI
  readonly currentVersionDisplay = computed(() => {
    const context = this.currentContext();
    return context.displayName;
  });
  
  readonly currentVersionTooltip = computed(() => {
    const context = this.currentContext();
    if (context.type === 'state') {
      return `Current state: ${context.displayName}`;
    } else {
      return `Current version: ${context.displayName}`;
    }
  });
  
  readonly currentVersionInfo = computed(() => {
    const context = this.currentContext();
    if (context.type === 'version') {
      return context.versionInfo;
    } else {
      return null; // States don't have version info
    }
  });
  
  readonly releasedVersions = computed(() => {
    return this.versionService.availableVersions().filter(v => v.type === 'released');
  });
  
  readonly developmentVersions = computed(() => {
    return this.versionService.availableVersions().filter(v => v.type === 'beta' || v.type === 'alpha');
  });
  
  readonly plannedVersions = computed(() => {
    return this.versionService.availableVersions().filter(v => v.type === 'planned');
  });
  
  readonly availableStates = computed(() => {
    return this.versionService.availableStates();
  });
  
  /**
   * Select a specific version
   */
  selectVersion(version: string): void {
    this.versionService.setCurrentVersion(version);
    this.navigateWithPagePreservation('version', version);
  }
  
  /**
   * Select a documentation state (drafts, proposals, etc.)
   */
  selectState(state: string): void {
    this.navigateWithPagePreservation('state', state);
  }

  /**
   * Navigate to a new version/state while preserving current page and anchor if possible
   */
  private navigateWithPagePreservation(type: 'version' | 'state', target: string): void {
    const currentUrl = this.router.url;
    
    // If not in docs section, just navigate to the target root
    if (!currentUrl || !currentUrl.startsWith('/docs/')) {
      this.scrollManagement.markVersionSwitching(false);
      if (type === 'version') {
        this.router.navigate(['/docs']);
      } else {
        this.router.navigate(['/docs', target]);
      }
      return;
    }

    // Parse current URL to extract page info and anchor
    const urlWithoutAnchor = currentUrl.split('#')[0];
    const anchor = currentUrl.includes('#') ? currentUrl.split('#')[1] : undefined;
    
    // Extract current page path structure
    const docPath = urlWithoutAnchor.replace('/docs/', '');
    const pathParts = docPath.split('/');
    
    // If we're at the root docs page, navigate to target root
    if (!docPath || pathParts.length === 0) {
      this.scrollManagement.markVersionSwitching(false);
      if (type === 'version') {
        this.router.navigate(['/docs']);
      } else {
        this.router.navigate(['/docs', target]);
      }
      return;
    }

    // Skip the first part (current version/state) to get the actual page path
    const currentContextPart = pathParts[0];
    const pagePath = pathParts.slice(1).join('/');
    
    // If no page path (we're at a version/state root), navigate to target root
    if (!pagePath) {
      this.scrollManagement.markVersionSwitching(false);
      if (type === 'version') {
        this.router.navigate(['/docs', target]);
      } else {
        this.router.navigate(['/docs', target]);
      }
      return;
    }

    // Try to find matching page by route structure first
    const targetPagePath = `${target}/${pagePath}`;
    const targetDocs = this.versionService.getDocsForVersionOrState(target);
    let matchingPage = targetDocs.find(doc => doc.slug === targetPagePath);

    // If no route match found, fall back to title-based matching
    if (!matchingPage) {
      const currentDocs = this.getCurrentContextDocs();
      const currentPageSlug = `${currentContextPart}/${pagePath}`;
      const currentPage = currentDocs.find(doc => doc.slug === currentPageSlug);
      const currentTitle = currentPage?.title;

      if (currentTitle) {
        matchingPage = targetDocs.find(doc => doc.title === currentTitle);
      }
    }

    if (matchingPage) {
      // Found matching page - navigate to it
      const matchedPageSlug = matchingPage.slug;
      let targetUrl = `/docs/${matchedPageSlug}`;
      
      // If we have an anchor, try to preserve it
      if (anchor) {
        targetUrl += `#${anchor}`;
      }
      
      // Mark that this is a version switch with route match found
      this.scrollManagement.markVersionSwitching(true);
      this.router.navigateByUrl(targetUrl);
    } else {
      // No matching page found - navigate to target root (Overview)
      // Mark that this is a version switch with no route match
      this.scrollManagement.markVersionSwitching(false);
      
      if (type === 'version') {
        this.router.navigate(['/docs', target]);
      } else {
        this.router.navigate(['/docs', target]);
      }
    }
  }

  /**
   * Get docs for current context (version or state)
   */
  private getCurrentContextDocs(): any[] {
    const currentUrl = this.router.url;
    if (currentUrl && currentUrl.startsWith('/docs/')) {
      const docPath = currentUrl.replace('/docs/', '').split('/')[0];
      
      // Check if this is a state
      const availableStates = this.versionService.availableStates();
      const matchingState = availableStates.find(s => s.state === docPath);
      
      if (matchingState) {
        return this.versionService.getDocsForVersionOrState(docPath);
      } else {
        // It's a version or fallback to current version
        return this.versionService.getCurrentVersionDocs();
      }
    }
    
    return this.versionService.getCurrentVersionDocs();
  }
  
  /**
   * Format date for display
   */
  formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short' 
      });
    } catch {
      return dateString;
    }
  }
}