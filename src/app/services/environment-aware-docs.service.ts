import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { DocsService } from './docs.service';
import { DocMeta } from '../core/models';

export interface MenuItem {
  label: string;
  slug: string;
  command?: () => void;
  items?: MenuItem[];
}

@Injectable({
  providedIn: 'root'
})
export class EnvironmentAwareDocsService {
  private docsService = inject(DocsService);

  generateMenuItems(navigateCallback: (slug: string) => void): Observable<MenuItem[]> {
    return this.docsService.allDocs().pipe(
      map(docs => this.buildMenuStructure(docs, navigateCallback))
    );
  }

  /**
   * Manually refresh docs (no longer needed with polling)
   */
  refreshDocs(): void {
    // No manual refresh needed, polling handles it automatically
  }

  private buildMenuStructure(docs: DocMeta[], navigateCallback: (slug: string) => void): MenuItem[] {
    const menuItems: MenuItem[] = [];
    const categories = new Map<string, MenuItem[]>();

    docs.forEach(doc => {
      const menuItem: MenuItem = {
        label: doc.title,
        slug: doc.slug,
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
      menuItems.push({
        label: categoryName,
        slug: '',
        items: categories.get(categoryName)
      });
    });

    return menuItems;
  }
}
