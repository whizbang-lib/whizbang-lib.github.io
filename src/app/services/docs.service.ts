import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { map, shareReplay } from "rxjs";
import { DocMeta } from "../core/models";

@Injectable({ providedIn: 'root' })
export class DocsService {
  private index$ = inject(HttpClient).get<DocMeta[]>('assets/docs-index.json')
                                     .pipe(shareReplay(1));

  allDocs()      { return this.index$; }
  bySlug(slug: string) {
    return this.index$.pipe(map(list => list.find(d => d.slug === slug)!));
  }
  allVideos()    { return this.index$.pipe(map(list => list.flatMap(d => d.videos))); }
  allExamples()  { return this.index$.pipe(map(list => list.flatMap(d => d.examples))); }
}
