import { Routes } from '@angular/router';
export const childRoutes: Routes = [
  { path: '', loadComponent: () => import('../pages/home/home.page').then(m => m.HomePage) },
  { path: 'docs', loadChildren: () => import('../pages/docs/docs.routes').then(m => m.DOC_ROUTES) },
  { path: 'patterns', loadChildren: () => import('../pages/patterns/patterns.routes').then(m => m.PATTERN_ROUTES) },
  { path: 'roadmap', loadComponent: () => import('../pages/roadmap/roadmap.page').then(m => m.RoadmapPage) },
  { path: 'examples', loadComponent: () => import('../pages/examples/examples.page').then(m => m.ExamplesPage) },
  { path: 'videos', loadComponent: () => import('../pages/videos/videos.page').then(m => m.VideosPage) },
  // 🚀 Unlisted easter egg for issue #55 — absent from nav & sitemap, noindex.
  { path: 'to-the-moon', loadComponent: () => import('../pages/rockets/rockets.page').then(m => m.RocketsPage) },
  { path: 'test-v2', loadComponent: () => import('../pages/test-v2.page').then(m => m.TestV2Page) },
  { path: 'button-debug', loadComponent: () => import('../pages/button-debug.page').then(m => m.ButtonDebugPage) },
  { path: 'test-toast', loadComponent: () => import('../test-toast.component').then(m => m.TestToastComponent) }
];
