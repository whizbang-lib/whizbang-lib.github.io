import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';
import { childRoutes } from './layout/child.routes';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: childRoutes
  },
  { path: '**', redirectTo: '' }
];

