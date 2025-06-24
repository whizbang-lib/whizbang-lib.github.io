import { Injectable, inject, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, BehaviorSubject, forkJoin, of } from 'rxjs';
import { switchMap, distinctUntilChanged, shareReplay, catchError, tap, map } from 'rxjs/operators';
import { isDevMode } from '@angular/core';

export interface DocFile {
  slug: string;
  title: string;
  category?: string;
  order?: number;
}

@Injectable({
  providedIn: 'root'
})
export class SuperSimpleDocsService {
  private http = inject(HttpClient);
  private ngZone = inject(NgZone);
  private isDev = isDevMode();
  
  constructor() {
    console.log(this.isDev ? '🔥 Dev mode: Auto-refresh enabled' : '🏭 Production mode');
  }

  getDocsList(): Observable<DocFile[]> {
    if (this.isDev) {
      // In development: poll the docs-list.json every 2 seconds
      return timer(0, 2000).pipe(
        switchMap(() => this.loadDocsFromJson()),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        shareReplay(1)
      );
    } else {
      // In production: load once
      return this.loadDocsFromJson().pipe(shareReplay(1));
    }
  }

  private loadDocsFromJson(): Observable<DocFile[]> {
    return this.http.get<string[]>('assets/docs-list.json', {
      headers: { 'Cache-Control': 'no-cache' }
    }).pipe(
      switchMap(slugs => this.loadDocsMetadata(slugs)),
      tap(docs => console.log(`📚 Loaded ${docs.length} docs`)),
      catchError(error => {
        console.error('❌ Error loading docs:', error);
        return [];
      })
    );
  }

  private loadDocsMetadata(slugs: string[]): Observable<DocFile[]> {
    const requests = slugs.map(slug => 
      this.http.get(`assets/docs/${slug}.md`, { 
        responseType: 'text',
        headers: { 'Cache-Control': 'no-cache' }
      }).pipe(
        map(content => this.parseMetadata(content, slug)),
        catchError(() => of(null))
      )
    );

    return forkJoin(requests.length > 0 ? requests : [of(null)]).pipe(
      map(results => results.filter(Boolean) as DocFile[]),
      map(docs => this.sortDocs(docs))
    );
  }

  private parseMetadata(content: string, slug: string): DocFile {
    const doc: DocFile = {
      slug,
      title: this.titleCase(slug)
    };

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      
      const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
      if (titleMatch) doc.title = titleMatch[1].trim().replace(/['"]/g, '');
      
      const categoryMatch = frontmatter.match(/^category:\s*(.+)$/m);
      if (categoryMatch) doc.category = categoryMatch[1].trim().replace(/['"]/g, '');
      
      const orderMatch = frontmatter.match(/^order:\s*(\d+)$/m);
      if (orderMatch) doc.order = parseInt(orderMatch[1]);
    }

    return doc;
  }

  private sortDocs(docs: DocFile[]): DocFile[] {
    return docs.sort((a, b) => {
      if (a.category !== b.category) {
        return (a.category || 'zzz').localeCompare(b.category || 'zzz');
      }
      return (a.order || 999) - (b.order || 999);
    });
  }

  private titleCase(str: string): string {
    return str.split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
