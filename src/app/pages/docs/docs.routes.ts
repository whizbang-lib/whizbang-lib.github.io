import { Routes } from '@angular/router';
import { DocsPage } from './docs.page';

export const DOC_ROUTES: Routes = [
  {
    path: '',
    component: DocsPage,
    children: [
      { path: '', redirectTo: 'getting-started', pathMatch: 'full' },
      // Version and state root routes (Overview pages)
      { path: 'v1.0.0', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: 'v1.1.0', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: 'v1.2.0', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: 'proposals', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: 'drafts', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: 'backlog', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: 'declined', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) },
      { path: '**', loadComponent: () => import('./markdown.page').then(m => m.MarkdownPage) }
    ]
  }
];
