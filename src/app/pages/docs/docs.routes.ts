import { Routes } from '@angular/router';
import { DocsPage } from './docs.page';

export const DOC_ROUTES: Routes = [
  {
    path: '',
    component: DocsPage,
    children: [
      { path: '', redirectTo: 'getting-started', pathMatch: 'full' },
      { path: '**', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) }
    ]
  }
];
