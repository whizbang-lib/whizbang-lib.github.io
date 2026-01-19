import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BreadcrumbItem } from '../components/breadcrumb.component';
import { VersionService } from './version.service';

@Injectable({
  providedIn: 'root'
})
export class BreadcrumbService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private versionService = inject(VersionService);
  private docsIndex: any[] = [];

  constructor() {
    this.loadDocsIndex();
  }

  private async loadDocsIndex() {
    try {
      this.docsIndex = await this.http.get<any[]>('assets/docs-index.json').toPromise() || [];
    } catch (error) {
      console.error('Failed to load docs index for breadcrumbs:', error);
      this.docsIndex = [];
    }
  }

  async generateBreadcrumbs(urlPath: string): Promise<BreadcrumbItem[]> {
    // Ensure docs index is loaded
    if (this.docsIndex.length === 0) {
      await this.loadDocsIndex();
    }

    const breadcrumbs: BreadcrumbItem[] = [];

    // Always start with Home
    breadcrumbs.push({
      label: 'Home',
      url: '/',
      isActive: false
    });

    // If we're not in docs, return just Home
    if (!urlPath.startsWith('docs/') && urlPath !== 'docs') {
      return breadcrumbs;
    }

    // Add Documentation link
    breadcrumbs.push({
      label: 'Documentation',
      url: '/docs',
      isActive: urlPath === 'docs'
    });

    // If we're at the docs index, we're done
    if (urlPath === 'docs') {
      breadcrumbs[breadcrumbs.length - 1].isActive = true;
      return breadcrumbs;
    }

    // Extract the actual doc path (remove 'docs/' prefix)
    const docPath = urlPath.replace(/^docs\//, '');
    const pathParts = docPath.split('/');
    
    // Check if the first part is a version or state
    const firstPart = pathParts[0];
    let versionOrStateLabel = '';
    let versionOrStateUrl = '';
    
    // Check if it's a state (proposals, drafts, etc.)
    const availableStates = this.versionService.availableStates();
    const matchingState = availableStates.find(s => s.state === firstPart);
    
    if (matchingState) {
      versionOrStateLabel = matchingState.displayName;
      versionOrStateUrl = `/docs/${firstPart}`;
    } else {
      // Check if it's a version
      const availableVersions = this.versionService.availableVersions();
      const matchingVersion = availableVersions.find(v => v.version === firstPart);
      
      if (matchingVersion) {
        versionOrStateLabel = matchingVersion.displayName;
        versionOrStateUrl = `/docs/${firstPart}`;
      }
    }
    
    // If we found a version or state, add it to breadcrumbs
    if (versionOrStateLabel) {
      const isVersionOrStateOnly = pathParts.length === 1;
      breadcrumbs.push({
        label: versionOrStateLabel,
        url: isVersionOrStateOnly ? undefined : versionOrStateUrl,
        isActive: isVersionOrStateOnly
      });
      
      // If we're at just the version/state root, we're done
      if (isVersionOrStateOnly) {
        return breadcrumbs;
      }
    }
    
    // Find the document in the index
    const docEntry = this.docsIndex.find(doc => doc.slug === docPath);
    
    if (docEntry) {
      // Add category breadcrumb if it's different from the page title
      if (docEntry.category && docEntry.title !== docEntry.category) {
        // Check if there are other docs in this category to make it a meaningful link
        const categoryDocs = this.docsIndex.filter(doc => doc.category === docEntry.category);
        
        if (categoryDocs.length > 1) {
          // Find the main category page if it exists
          const categoryMainPage = categoryDocs.find(doc => 
            doc.title === docEntry.category || 
            doc.slug.endsWith(`/${this.slugify(docEntry.category)}`) ||
            doc.slug === this.slugify(docEntry.category)
          );

          if (categoryMainPage) {
            breadcrumbs.push({
              label: docEntry.category,
              url: `/docs/${categoryMainPage.slug}`,
              isActive: false
            });
          } else {
            // No main category page, just show category without link
            breadcrumbs.push({
              label: docEntry.category,
              isActive: false
            });
          }
        }
      }

      // Add the current page (always active, no link)
      breadcrumbs.push({
        label: docEntry.title,
        isActive: true
      });
    } else {
      // Fallback: generate breadcrumbs from URL structure
      let currentPath = 'docs';
      const startIndex = versionOrStateLabel ? 1 : 0; // Skip version/state part if already added

      for (let i = startIndex; i < pathParts.length; i++) {
        const part = pathParts[i];
        currentPath += '/' + part;
        const isLast = i === pathParts.length - 1;

        // Convert slug to title (capitalize and replace hyphens)
        const title = this.slugToTitle(part);

        breadcrumbs.push({
          label: title,
          url: isLast ? undefined : `/${currentPath}`,
          isActive: isLast
        });
      }
    }

    return breadcrumbs;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private slugToTitle(slug: string): string {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  generateStructuredData(breadcrumbs: BreadcrumbItem[]): string {
    const itemListElement = breadcrumbs
      .filter(item => item.url) // Only include items with URLs
      .map((item, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": item.label,
        "item": `${window.location.origin}${item.url}`
      }));

    const structuredData = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": itemListElement
    };

    return JSON.stringify(structuredData);
  }

  addStructuredDataToPage(breadcrumbs: BreadcrumbItem[]) {
    // Remove existing breadcrumb structured data
    const existingScript = document.querySelector('script[type="application/ld+json"][data-breadcrumb]');
    if (existingScript) {
      existingScript.remove();
    }

    // Add new structured data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-breadcrumb', 'true');
    script.textContent = this.generateStructuredData(breadcrumbs);
    document.head.appendChild(script);
  }

  removeStructuredDataFromPage() {
    const existingScript = document.querySelector('script[type="application/ld+json"][data-breadcrumb]');
    if (existingScript) {
      existingScript.remove();
    }
  }
}