import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BreadcrumbItem } from '../components/breadcrumb.component';
import { VersionService } from './version.service';

interface NavTreeNode {
  name: string;
  title: string;
  order: number;
  icon?: string;
  pages: { slug: string; title: string; order: number }[];
  children: NavTreeNode[];
}

@Injectable({
  providedIn: 'root'
})
export class BreadcrumbService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private versionService = inject(VersionService);
  private docsIndex: any[] = [];
  private navTree: Record<string, NavTreeNode[]> = {};

  constructor() {
    this.loadDocsIndex();
    this.loadNavTree();
  }

  private async loadDocsIndex() {
    try {
      this.docsIndex = await this.http.get<any[]>('assets/docs-index.json').toPromise() || [];
    } catch (error) {
      console.error('Failed to load docs index for breadcrumbs:', error);
      this.docsIndex = [];
    }
  }

  private async loadNavTree() {
    try {
      this.navTree = await this.http.get<Record<string, NavTreeNode[]>>('assets/docs-nav-tree.json').toPromise() || {};
    } catch (error) {
      this.navTree = {};
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

    // Build breadcrumbs from the folder path using the nav tree for titles
    const startIndex = versionOrStateLabel ? 1 : 0; // Skip version/state part if already added
    const remainingParts = pathParts.slice(startIndex);
    const pageSlug = remainingParts[remainingParts.length - 1]; // Last part is the page
    const folderParts = remainingParts.slice(0, -1); // Everything except last is folders

    // Walk the nav tree to get folder titles
    const versionOrState = pathParts[0];
    let currentNodes = this.navTree[versionOrState] || [];
    let currentPath = `docs/${versionOrState}`;

    for (const folderName of folderParts) {
      currentPath += '/' + folderName;
      const matchingNode = currentNodes.find(n => n.name === folderName);

      if (matchingNode) {
        breadcrumbs.push({
          label: matchingNode.title,
          url: `/${currentPath}`,
          isActive: false
        });
        currentNodes = matchingNode.children;
      } else {
        // Fallback to humanized folder name
        breadcrumbs.push({
          label: this.slugToTitle(folderName),
          url: `/${currentPath}`,
          isActive: false
        });
        currentNodes = [];
      }
    }

    // Add the current page (always active, no link)
    const pageTitle = docEntry?.title || this.slugToTitle(pageSlug);
    breadcrumbs.push({
      label: pageTitle,
      isActive: true
    });

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