import { Injectable, signal, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type VersionType = 'released' | 'beta' | 'alpha' | 'planned';
export type DocumentationState = 'drafts' | 'proposals' | 'backlog' | 'declined';

export interface VersionInfo {
  version: string;
  type: VersionType;
  displayName: string;
  releaseDate?: string;
  estimatedDate?: string;
  status: string;
  theme: string;
  description?: string;
  metadata?: any;
}

export interface StateInfo {
  state: DocumentationState;
  displayName: string;
  description: string;
  count: number;
  metadata?: any;
}

export interface VersionedIndex {
  version?: string;
  state?: string;
  metadata: any;
  docs: any[];
}

@Injectable({
  providedIn: 'root'
})
export class VersionService {
  private readonly STORAGE_KEY = 'wb-selected-version';
  private readonly DEFAULT_VERSION = 'v1.0.0'; // Production version
  private http = inject(HttpClient);
  
  // Reactive signals for version state
  private readonly _currentVersion = signal<string>(this.DEFAULT_VERSION);
  private readonly _availableVersions = signal<VersionInfo[]>([]);
  private readonly _availableStates = signal<StateInfo[]>([]);
  private readonly _versionedIndex = signal<VersionedIndex[]>([]);
  private readonly _isLoading = signal<boolean>(true);
  
  // Public readonly signals
  readonly currentVersion = this._currentVersion.asReadonly();
  readonly availableVersions = this._availableVersions.asReadonly();
  readonly availableStates = this._availableStates.asReadonly();
  readonly versionedIndex = this._versionedIndex.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  
  constructor() {
    // Initialize version system
    this.initializeVersions();
    
    // Load user's version preference
    this.loadVersionPreference();
  }
  
  /**
   * Set the current version
   */
  setCurrentVersion(version: string): void {
    this._currentVersion.set(version);
    this.saveVersionPreference(version);
  }
  
  /**
   * Get version information by version string
   */
  getVersionInfo(version: string): VersionInfo | undefined {
    return this._availableVersions().find(v => v.version === version);
  }
  
  /**
   * Get state information by state string
   */
  getStateInfo(state: DocumentationState): StateInfo | undefined {
    return this._availableStates().find(s => s.state === state);
  }
  
  /**
   * Check if a version is released
   */
  isReleased(version: string): boolean {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.type === 'released';
  }
  
  /**
   * Check if a version is in development (beta/alpha)
   */
  isInDevelopment(version: string): boolean {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.type === 'beta' || versionInfo?.type === 'alpha';
  }
  
  /**
   * Check if a version is planned for future
   */
  isPlanned(version: string): boolean {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.type === 'planned';
  }
  
  /**
   * Get documentation for current version
   */
  getCurrentVersionDocs(): any[] {
    const currentVersionData = this._versionedIndex().find(
      item => item.version === this._currentVersion()
    );
    return currentVersionData?.docs || [];
  }
  
  /**
   * Get documentation for specific version or state
   */
  getDocsForVersionOrState(versionOrState: string): any[] {
    const versionData = this._versionedIndex().find(
      item => item.version === versionOrState || item.state === versionOrState
    );
    return versionData?.docs || [];
  }
  
  /**
   * Get the production/default version
   */
  getProductionVersion(): string {
    const releasedVersions = this._availableVersions().filter(v => v.type === 'released');
    return releasedVersions[0]?.version || this.DEFAULT_VERSION;
  }
  
  /**
   * Generate URL for a document in current version
   */
  generateDocUrl(docSlug: string): string {
    const currentVersion = this._currentVersion();
    
    // If it's the production version, use clean URLs
    if (currentVersion === this.getProductionVersion()) {
      return `/docs/${docSlug}`;
    }
    
    // For other versions, include version in URL
    return `/docs/${currentVersion}/${docSlug}`;
  }

  /**
   * Get documentation for a specific version
   */
  getVersionDocs(version: string): any[] {
    const versionData = this._versionedIndex().find(
      item => item.version === version
    );
    return versionData?.docs || [];
  }

  /**
   * Get documentation for a specific state
   */
  getStateDocs(state: string): any[] {
    const stateData = this._versionedIndex().find(
      item => item.state === state
    );
    return stateData?.docs || [];
  }

  /**
   * Get documentation states for computed signals
   */
  get documentationStates() {
    return this._availableStates.asReadonly();
  }
  
  private async initializeVersions(): Promise<void> {
    try {
      this._isLoading.set(true);
      
      // Load versioned documentation index
      const versionedIndex = await this.http.get<VersionedIndex[]>('assets/docs-index-versioned.json').toPromise();
      this._versionedIndex.set(versionedIndex || []);
      
      // Process versions and states
      const versions: VersionInfo[] = [];
      const states: StateInfo[] = [];
      
      for (const item of versionedIndex || []) {
        if (item.version) {
          // Process version
          const versionInfo: VersionInfo = {
            version: item.version,
            type: this.determineVersionType(item.metadata),
            displayName: this.getVersionDisplayName(item.version, item.metadata),
            releaseDate: item.metadata?.releaseDate,
            estimatedDate: item.metadata?.estimatedDate,
            status: item.metadata?.status || 'unknown',
            theme: item.metadata?.theme || '',
            description: item.metadata?.description,
            metadata: item.metadata
          };
          versions.push(versionInfo);
        } else if (item.state) {
          // Process state
          const stateInfo: StateInfo = {
            state: item.state as DocumentationState,
            displayName: this.getStateDisplayName(item.state),
            description: item.metadata?.description || '',
            count: item.docs?.length || 0,
            metadata: item.metadata
          };
          states.push(stateInfo);
        }
      }
      
      // Sort versions by release order (released first, then by version)
      versions.sort((a, b) => {
        if (a.type === 'released' && b.type !== 'released') return -1;
        if (a.type !== 'released' && b.type === 'released') return 1;
        return a.version.localeCompare(b.version);
      });
      
      this._availableVersions.set(versions);
      this._availableStates.set(states);
      
    } catch (error) {
      console.error('Error loading version information:', error);
    } finally {
      this._isLoading.set(false);
    }
  }
  
  private determineVersionType(metadata: any): VersionType {
    const status = metadata?.status?.toLowerCase();
    
    switch (status) {
      case 'released':
        return 'released';
      case 'beta':
        return 'beta';
      case 'alpha':
        return 'alpha';
      default:
        return 'planned';
    }
  }
  
  private getVersionDisplayName(version: string, metadata: any): string {
    if (metadata?.theme) {
      return `${version} - ${metadata.theme}`;
    }
    return version;
  }
  
  private getStateDisplayName(state: string): string {
    const stateNames: Record<string, string> = {
      drafts: 'Drafts',
      proposals: 'Proposals',
      backlog: 'Backlog',
      declined: 'Declined'
    };
    return stateNames[state] || state;
  }
  
  private loadVersionPreference(): void {
    if (typeof localStorage === 'undefined') return;
    
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        this._currentVersion.set(saved);
      }
    } catch (error) {
      console.warn('Failed to load version preference:', error);
    }
  }
  
  private saveVersionPreference(version: string): void {
    if (typeof localStorage === 'undefined') return;
    
    try {
      localStorage.setItem(this.STORAGE_KEY, version);
    } catch (error) {
      console.warn('Failed to save version preference:', error);
    }
  }
}