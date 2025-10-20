import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  url?: string;
  isActive?: boolean;
}

@Component({
  selector: 'wb-breadcrumb',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <nav aria-label="Breadcrumb" class="breadcrumb-nav">
      <ol class="breadcrumb-list" itemscope itemtype="https://schema.org/BreadcrumbList">
        <li 
          *ngFor="let item of items; let i = index" 
          class="breadcrumb-item"
          [class.breadcrumb-item--active]="item.isActive"
          itemprop="itemListElement" 
          itemscope 
          itemtype="https://schema.org/ListItem">
          
          <!-- Non-active items with links -->
          <a 
            *ngIf="item.url && !item.isActive" 
            [routerLink]="item.url"
            class="breadcrumb-link"
            itemprop="item">
            <span itemprop="name">{{ item.label }}</span>
          </a>
          
          <!-- Active item without link -->
          <span 
            *ngIf="item.isActive || !item.url" 
            class="breadcrumb-text"
            itemprop="item">
            <span itemprop="name">{{ item.label }}</span>
          </span>
          
          <!-- Separator (not for last item) -->
          <span 
            *ngIf="i < items.length - 1" 
            class="breadcrumb-separator" 
            aria-hidden="true">
            <i class="pi pi-chevron-right"></i>
          </span>
          
          <!-- Schema.org position -->
          <meta itemprop="position" [content]="(i + 1).toString()">
        </li>
      </ol>
    </nav>
  `,
  styles: [`
    .breadcrumb-nav {
      margin-bottom: 0.75rem;
      padding: 0 0 0.5rem 0;
      border-bottom: 1px solid var(--p-content-border-color);
    }

    .breadcrumb-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      list-style: none;
      margin: 0;
      padding: 0;
      gap: 0.5rem;
    }

    .breadcrumb-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .breadcrumb-link {
      color: var(--p-primary-color);
      text-decoration: none;
      font-size: 0.875rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      transition: all 0.2s ease;
    }

    .breadcrumb-link:hover {
      color: var(--p-primary-600);
      background-color: var(--p-content-hover-background);
      text-decoration: underline;
    }

    .breadcrumb-link:focus {
      outline: 2px solid var(--p-focus-ring-color);
      outline-offset: 2px;
    }

    .breadcrumb-text {
      color: var(--p-text-muted-color);
      font-size: 0.875rem;
      padding: 0.25rem 0.5rem;
    }

    .breadcrumb-item--active .breadcrumb-text {
      color: var(--p-text-color);
      font-weight: 500;
    }

    .breadcrumb-separator {
      color: var(--p-text-muted-color);
      font-size: 0.75rem;
      margin: 0 0.25rem;
    }

    .breadcrumb-separator i {
      font-size: 0.75rem;
    }

    /* Responsive design */
    @media (max-width: 768px) {
      .breadcrumb-nav {
        margin-bottom: 0.75rem;
        padding: 0 0 0.375rem 0;
      }

      .breadcrumb-link,
      .breadcrumb-text {
        font-size: 0.8125rem;
        padding: 0.1875rem 0.375rem;
      }

      .breadcrumb-list {
        gap: 0.375rem;
      }

      .breadcrumb-separator {
        margin: 0 0.125rem;
      }
    }

    /* Dark theme support */
    @media (prefers-color-scheme: dark) {
      .breadcrumb-nav {
        border-bottom-color: var(--p-content-border-color);
      }
    }
  `]
})
export class BreadcrumbComponent {
  @Input() items: BreadcrumbItem[] = [];
}