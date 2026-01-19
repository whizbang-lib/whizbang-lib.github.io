import { Routes } from '@angular/router';
import { PatternsPage } from './patterns.page';

export const PATTERN_ROUTES: Routes = [
  {
    path: '',
    component: PatternsPage,
    children: [
      { path: '', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
      { path: 'receptor', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
      { path: 'perspective', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
      { path: 'lens', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
      { path: 'dispatcher', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
      { path: 'policy', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
      { path: 'ledger', loadComponent: () => import('./patterns-markdown.page').then(m => m.PatternsMarkdownPage) },
    ]
  }
];