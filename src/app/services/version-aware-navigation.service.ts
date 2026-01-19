import { Injectable, inject, computed } from '@angular/core';
import { Observable, map, combineLatest } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { VersionService } from './version.service';
import { DocsService } from './docs.service';
import { DocMeta } from '../core/models';

export interface VersionAwareMenuItem {
  label: string;
  slug: string;
  version?: string;
  command?: () => void;
  items?: VersionAwareMenuItem[];
  isVersionSpecific?: boolean;
  documentationState?: string; // drafts, proposals, backlog, declined
}

@Injectable({
  providedIn: 'root'
})
export class VersionAwareNavigationService {
  private versionService = inject(VersionService);
  private docsService = inject(DocsService);

  /**
   * Generate navigation menu items for the current version
   */
  generateCurrentVersionMenuItems(navigateCallback: (slug: string) => void): Observable<VersionAwareMenuItem[]> {
    return combineLatest([
      this.docsService.allDocs(),
      toObservable(this.versionService.currentVersion)
    ]).pipe(
      map(([allDocs, currentVersion]) => {
        const currentVersionDocs = this.versionService.getCurrentVersionDocs();
        return this.buildVersionAwareMenuStructure(currentVersionDocs, currentVersion, navigateCallback);
      })
    );
  }

  /**
   * Generate navigation menu items for all versions (used in version selector)
   */
  generateAllVersionsMenuItems(navigateCallback: (slug: string) => void): Observable<VersionAwareMenuItem[]> {
    return combineLatest([
      this.docsService.allDocs(),
      toObservable(this.versionService.availableVersions),
      toObservable(this.versionService.documentationStates)
    ]).pipe(
      map(([allDocs, versions, states]) => {
        return this.buildMultiVersionMenuStructure(allDocs, versions, states, navigateCallback);
      })
    );
  }

  /**
   * Generate navigation menu items for a specific version
   */
  generateVersionSpecificMenuItems(
    targetVersion: string, 
    navigateCallback: (slug: string) => void
  ): Observable<VersionAwareMenuItem[]> {
    return this.docsService.allDocs().pipe(
      map(allDocs => {
        const versionDocs = this.filterDocsByVersion(allDocs, targetVersion);
        return this.buildVersionAwareMenuStructure(versionDocs, targetVersion, navigateCallback);
      })
    );
  }

  /**
   * Generate breadcrumb navigation for current page
   */
  generateBreadcrumbs(currentSlug: string): Observable<VersionAwareMenuItem[]> {
    return combineLatest([
      this.docsService.allDocs(),
      toObservable(this.versionService.currentVersion)
    ]).pipe(
      map(([allDocs, currentVersion]) => {
        return this.buildBreadcrumbStructure(currentSlug, allDocs, currentVersion);
      })
    );
  }

  private buildVersionAwareMenuStructure(
    docs: DocMeta[], 
    version: string, 
    navigateCallback: (slug: string) => void
  ): VersionAwareMenuItem[] {
    const menuItems: VersionAwareMenuItem[] = [];
    const categories = new Map<string, VersionAwareMenuItem[]>();

    docs.forEach(doc => {
      const menuItem: VersionAwareMenuItem = {
        label: doc.title,
        slug: doc.slug,
        version: version,
        isVersionSpecific: this.isVersionSpecificPath(doc.slug),
        documentationState: this.extractDocumentationState(doc.slug),
        command: () => navigateCallback(doc.slug)
      };

      if (doc.category) {
        if (!categories.has(doc.category)) {
          categories.set(doc.category, []);
        }
        categories.get(doc.category)!.push(menuItem);
      } else {
        menuItems.push(menuItem);
      }
    });

    // Sort items within categories by order
    categories.forEach(items => {
      items.sort((a, b) => {
        const docA = docs.find(d => d.slug === a.slug);
        const docB = docs.find(d => d.slug === b.slug);
        return (docA?.order || 999) - (docB?.order || 999);
      });
    });

    // Add categorized items to menu (sorted by category name)
    const sortedCategories = Array.from(categories.keys()).sort();
    sortedCategories.forEach(categoryName => {
      const categoryItem: VersionAwareMenuItem = {
        label: categoryName,
        slug: '',
        version: version,
        items: categories.get(categoryName),
        isVersionSpecific: true
      };
      menuItems.push(categoryItem);
    });

    return menuItems;
  }

  private buildMultiVersionMenuStructure(
    allDocs: DocMeta[], 
    versions: any[], 
    states: any[], 
    navigateCallback: (slug: string) => void
  ): VersionAwareMenuItem[] {
    const menuItems: VersionAwareMenuItem[] = [];

    // Add version-specific sections
    versions.forEach(version => {
      const versionDocs = this.filterDocsByVersion(allDocs, version.version);
      if (versionDocs.length > 0) {
        const versionItem: VersionAwareMenuItem = {
          label: `${version.title} (${versionDocs.length} docs)`,
          slug: '',
          version: version.version,
          isVersionSpecific: true,
          items: this.buildVersionAwareMenuStructure(versionDocs, version.version, navigateCallback)
        };
        menuItems.push(versionItem);
      }
    });

    // Add documentation state sections
    states.forEach(state => {
      const stateDocs = this.filterDocsByState(allDocs, state.key);
      if (stateDocs.length > 0) {
        const stateItem: VersionAwareMenuItem = {
          label: `${state.label} (${stateDocs.length} docs)`,
          slug: '',
          documentationState: state.key,
          isVersionSpecific: false,
          items: this.buildVersionAwareMenuStructure(stateDocs, state.key, navigateCallback)
        };
        menuItems.push(stateItem);
      }
    });

    return menuItems;
  }

  private buildBreadcrumbStructure(
    currentSlug: string, 
    allDocs: DocMeta[], 
    currentVersion: string
  ): VersionAwareMenuItem[] {
    const breadcrumbs: VersionAwareMenuItem[] = [];
    
    // Add home breadcrumb
    breadcrumbs.push({
      label: 'Home',
      slug: '',
      version: currentVersion
    });

    // Extract version/state from slug
    const slugParts = currentSlug.split('/');
    if (slugParts.length > 0) {
      const versionOrState = slugParts[0];
      
      if (this.isVersionPath(versionOrState)) {
        breadcrumbs.push({
          label: `Version ${versionOrState.replace('v', '')}`,
          slug: versionOrState,
          version: versionOrState,
          isVersionSpecific: true
        });
      } else if (this.isStatePath(versionOrState)) {
        breadcrumbs.push({
          label: this.getStateLabel(versionOrState),
          slug: versionOrState,
          documentationState: versionOrState
        });
      }
    }

    // Find the current document and add category if it exists
    const currentDoc = allDocs.find(doc => doc.slug === currentSlug);
    if (currentDoc?.category) {
      breadcrumbs.push({
        label: currentDoc.category,
        slug: `${slugParts[0] || currentVersion}/${currentDoc.category.toLowerCase().replace(/\s+/g, '-')}`,
        version: currentVersion
      });
    }

    // Add current page
    if (currentDoc) {
      breadcrumbs.push({
        label: currentDoc.title,
        slug: currentSlug,
        version: currentVersion
      });
    }

    return breadcrumbs;
  }

  private filterDocsByVersion(docs: DocMeta[], version: string): DocMeta[] {
    return docs.filter(doc => {
      const slugParts = doc.slug.split('/');
      return slugParts[0] === version;
    });
  }

  private filterDocsByState(docs: DocMeta[], state: string): DocMeta[] {
    return docs.filter(doc => {
      const slugParts = doc.slug.split('/');
      return slugParts[0] === state;
    });
  }

  private isVersionSpecificPath(slug: string): boolean {
    const firstPart = slug.split('/')[0];
    return this.isVersionPath(firstPart);
  }

  private isVersionPath(path: string): boolean {
    return /^v\d+\.\d+\.\d+(-\w+)?$/.test(path);
  }

  private isStatePath(path: string): boolean {
    return ['drafts', 'proposals', 'backlog', 'declined'].includes(path);
  }

  private extractDocumentationState(slug: string): string | undefined {
    const firstPart = slug.split('/')[0];
    return this.isStatePath(firstPart) ? firstPart : undefined;
  }

  private getStateLabel(state: string): string {
    const stateLabels: { [key: string]: string } = {
      'drafts': 'Draft Documentation',
      'proposals': 'Feature Proposals',
      'backlog': 'Future Features',
      'declined': 'Declined Features'
    };
    return stateLabels[state] || state;
  }

  /**
   * Get the navigation tree for the current version (used for sidebar)
   */
  getCurrentVersionNavigationTree = computed(() => {
    const currentVersionDocs = this.versionService.getCurrentVersionDocs();
    const currentVersion = this.versionService.currentVersion();
    
    return this.buildNavigationTree(currentVersionDocs, currentVersion);
  });

  /**
   * Get expanded navigation tree showing all versions and states
   */
  getExpandedNavigationTree = computed(() => {
    const allVersions = this.versionService.availableVersions();
    const allStates = this.versionService.documentationStates();
    
    return this.buildExpandedNavigationTree(allVersions, allStates);
  });

  private buildNavigationTree(docs: DocMeta[], version: string): any {
    const tree: any = {
      version: version,
      categories: new Map(),
      uncategorized: []
    };

    docs.forEach(doc => {
      const node = {
        title: doc.title,
        slug: doc.slug,
        order: doc.order || 999,
        lastModified: (doc as any).lastModified
      };

      if (doc.category) {
        if (!tree.categories.has(doc.category)) {
          tree.categories.set(doc.category, []);
        }
        tree.categories.get(doc.category).push(node);
      } else {
        tree.uncategorized.push(node);
      }
    });

    // Sort categories and items
    tree.categories.forEach((items: any[]) => {
      items.sort((a: any, b: any) => a.order - b.order);
    });
    tree.uncategorized.sort((a: any, b: any) => a.order - b.order);

    return tree;
  }

  private buildExpandedNavigationTree(versions: any[], states: any[]): any {
    const expandedTree: any = {
      versions: new Map(),
      states: new Map()
    };

    // Process versions
    versions.forEach(version => {
      const versionDocs = this.versionService.getVersionDocs(version.version);
      expandedTree.versions.set(version.version, {
        ...version,
        tree: this.buildNavigationTree(versionDocs, version.version)
      });
    });

    // Process states
    states.forEach(state => {
      const stateDocs = this.versionService.getStateDocs(state.key);
      expandedTree.states.set(state.key, {
        ...state,
        tree: this.buildNavigationTree(stateDocs, state.key)
      });
    });

    return expandedTree;
  }

  /**
   * Get contextual navigation suggestions based on current page
   */
  getContextualSuggestions(currentSlug: string): Observable<VersionAwareMenuItem[]> {
    return combineLatest([
      this.docsService.allDocs(),
      toObservable(this.versionService.currentVersion)
    ]).pipe(
      map(([allDocs, currentVersion]) => {
        const currentDoc = allDocs.find((doc: DocMeta) => doc.slug === currentSlug);
        if (!currentDoc) return [];

        const suggestions: VersionAwareMenuItem[] = [];

        // Find related documents in the same category
        if (currentDoc.category) {
          const categoryDocs = allDocs.filter((doc: DocMeta) => 
            doc.category === currentDoc.category && 
            doc.slug !== currentSlug &&
            this.filterDocsByVersion([doc], currentVersion).length > 0
          );

          categoryDocs.slice(0, 3).forEach((doc: DocMeta) => {
            suggestions.push({
              label: `Related: ${doc.title}`,
              slug: doc.slug,
              version: currentVersion
            });
          });
        }

        // Find the next/previous documents by order
        const versionDocs = this.versionService.getCurrentVersionDocs();
        const currentIndex = versionDocs.findIndex((doc: any) => doc.slug === currentSlug);
        
        if (currentIndex > 0) {
          const prevDoc = versionDocs[currentIndex - 1];
          suggestions.unshift({
            label: `← ${prevDoc.title}`,
            slug: prevDoc.slug,
            version: currentVersion
          });
        }

        if (currentIndex < versionDocs.length - 1) {
          const nextDoc = versionDocs[currentIndex + 1];
          suggestions.push({
            label: `${nextDoc.title} →`,
            slug: nextDoc.slug,
            version: currentVersion
          });
        }

        return suggestions;
      })
    );
  }

  /**
   * Check if a navigation item should be expanded based on current route
   */
  shouldExpandNavigationItem(item: VersionAwareMenuItem, currentSlug: string): boolean {
    if (!item.items || item.items.length === 0) {
      return false;
    }

    // Expand if current slug starts with this item's path
    if (item.slug && currentSlug.startsWith(item.slug)) {
      return true;
    }

    // Expand if any child item matches current slug
    return item.items.some(child => this.shouldExpandNavigationItem(child, currentSlug));
  }

  /**
   * Generate search-aware navigation (highlight search matches)
   */
  generateSearchAwareNavigation(
    searchQuery: string,
    navigateCallback: (slug: string) => void
  ): Observable<VersionAwareMenuItem[]> {
    return this.generateCurrentVersionMenuItems(navigateCallback).pipe(
      map(menuItems => this.highlightSearchMatches(menuItems, searchQuery))
    );
  }

  private highlightSearchMatches(
    menuItems: VersionAwareMenuItem[], 
    searchQuery: string
  ): VersionAwareMenuItem[] {
    if (!searchQuery.trim()) return menuItems;

    const query = searchQuery.toLowerCase();

    return menuItems.map(item => {
      const matches = item.label.toLowerCase().includes(query);
      
      return {
        ...item,
        label: matches ? this.highlightText(item.label, searchQuery) : item.label,
        items: item.items ? this.highlightSearchMatches(item.items, searchQuery) : undefined
      };
    });
  }

  private highlightText(text: string, query: string): string {
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
}