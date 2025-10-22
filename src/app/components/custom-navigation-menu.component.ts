import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MenuItem } from '../services/environment-aware-docs.service';
import { VersionSelectorComponent } from './version-selector.component';

export interface CustomMenuItem {
  label: string;
  icon?: string;
  command?: () => void;
  items?: CustomMenuItem[];
  expanded?: boolean;
  styleClass?: string;
  isVersionSelector?: boolean;
}

@Component({
  selector: 'wb-custom-navigation-menu',
  standalone: true,
  imports: [CommonModule, VersionSelectorComponent],
  template: `
    <ul class="custom-nav-menu" [class.deep-level]="nestingLevel >= 2">
      <li *ngFor="let item of menuItems" class="nav-item">
        <!-- Version Selector Item -->
        <div *ngIf="item.isVersionSelector" class="version-selector-item">
          <div class="version-selector-header">
            <i *ngIf="item.icon" [class]="item.icon" class="nav-icon"></i>
            <span class="version-selector-label">{{ item.label }}</span>
          </div>
          <div class="version-selector-wrapper">
            <wb-version-selector></wb-version-selector>
          </div>
        </div>
        
        <!-- Regular Menu Item -->
        <div *ngIf="!item.isVersionSelector"
          class="nav-item-content"
          [class.top-level]="nestingLevel === 0"
          [class.second-level]="nestingLevel === 1"
          [class.deep-level]="nestingLevel >= 2"
          [class.has-children]="item.items && item.items.length > 0"
          [class.active]="item.styleClass?.includes('active')"
          [class.has-active-child]="nestingLevel === 1 && hasActiveChild(item)"
          (click)="handleItemClick(item)">
          
          <!-- Left: Icon -->
          <i *ngIf="item.icon" [class]="item.icon" class="nav-icon"></i>
          
          <!-- Middle: Text (left-aligned) -->
          <span class="nav-label">{{ item.label }}</span>
          
          <!-- Right: Arrow (only if has children) -->
          <i *ngIf="item.items && item.items.length > 0" 
             [class]="item.expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" 
             class="nav-arrow"></i>
        </div>
        
        <!-- Sub-menu (recursive) with animation wrapper -->
        <div *ngIf="item.items && item.items.length > 0" 
             class="submenu-wrapper"
             [class.expanded]="item.expanded">
          <wb-custom-navigation-menu 
            [menuItems]="item.items"
            [nestingLevel]="nestingLevel + 1">
          </wb-custom-navigation-menu>
        </div>
      </li>
    </ul>
  `,
  styles: [`
    .custom-nav-menu {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .nav-item {
      margin: 0;
    }

    .nav-item-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: all 0.2s;
      border-radius: 0;
      margin: 0.25rem 0;
    }

    /* Top-level items - bold and background */
    .nav-item-content.top-level {
      font-weight: 700;
      background: var(--wb-surface-section);
    }

    .nav-item-content.top-level:hover {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 0.375rem;
    }



    /* Second-level items - normal weight, transparent button */
    .nav-item-content.second-level {
      font-weight: 400;
      background: transparent;
      padding: 0.5rem 1rem;
      margin: 0.125rem 0;
    }

    .nav-item-content.second-level:hover {
      background: rgba(0, 0, 0, 0.1);
    }

    /* Full-width background for second-level items - different color */
    .nav-item:has(.nav-item-content.second-level) {
      background: var(--wb-surface-border);
      margin: 0.125rem 0;
      border-radius: 0.25rem;
    }



    /* Highlight second-level items that have an active child - text only */
    .nav-item-content.second-level.has-active-child .nav-label {
      color: #10b981;
      font-weight: 600;
    }

    /* Deep-level items (third level and beyond) - plain text in container */
    .nav-item-content.deep-level {
      font-weight: 400;
      background: transparent;
      border: none;
      padding: 0.5rem 0.25rem;
      margin: 0.125rem 0;
      border-radius: 0.25rem;
    }

    .nav-item-content.deep-level:hover {
      background: rgba(0, 0, 0, 0.1);
    }

    /* Container styling for deep-level menus */
    .custom-nav-menu.deep-level {
      background: var(--wb-surface-ground);
      border: 1px solid var(--wb-surface-border);
      border-radius: 0.375rem;
      padding: 0.5rem;
      margin: 0.25rem 0.5rem;
    }



    /* Icon on left */
    .nav-icon {
      color: var(--wb-text-secondary);
      margin-right: 0.75rem;
      font-size: 1rem;
      flex-shrink: 0;
    }

    /* Text in middle, left-aligned */
    .nav-label {
      flex: 1;
      text-align: left;
      color: var(--wb-text-primary);
    }

    /* Arrow on right */
    .nav-arrow {
      color: var(--wb-text-secondary);
      font-size: 0.875rem;
      flex-shrink: 0;
      margin-left: 0.75rem;
    }

    /* Active item styling */
    .nav-item-content.active .nav-label,
    .nav-item-content.active .nav-icon,
    .nav-item-content.active .nav-arrow {
      color: #10b981 !important;
      font-weight: 600 !important;
    }

    /* No indenting for sub-menus */
    wb-custom-navigation-menu {
      display: block;
      padding-left: 0;
      margin-left: 0;
    }

    /* Submenu animation wrapper */
    .submenu-wrapper {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease-in-out, opacity 0.2s ease-in-out;
      opacity: 0;
    }

    .submenu-wrapper.expanded {
      max-height: 1000px; /* Large enough for any submenu */
      opacity: 1;
    }

    /* Arrow rotation animation */
    .nav-arrow {
      transition: transform 0.2s ease-in-out;
    }

    /* Rotate arrow when expanded */
    .nav-item-content:has(+ .submenu-wrapper.expanded) .nav-arrow.pi-chevron-right {
      transform: rotate(90deg);
    }

    /* Version Selector Item Styling */
    .version-selector-item {
      padding: 0.75rem 1rem;
      margin: 0.25rem 0;
      background: var(--wb-surface-section);
      border-radius: 0.375rem;
      border: 1px solid var(--wb-surface-border);
    }

    .version-selector-header {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .version-selector-header .nav-icon {
      color: var(--wb-text-secondary);
      margin-right: 0.5rem;
      font-size: 0.875rem;
    }

    .version-selector-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--wb-text-secondary);
      letter-spacing: 0.05em;
    }

    .version-selector-wrapper {
      padding: 0;
    }

    /* Override version selector styles for inline display */
    .version-selector-wrapper :host ::ng-deep .version-selector-btn {
      width: 100%;
      justify-content: space-between;
      font-size: 0.875rem;
    }

    /* No content placeholder styling */
    .nav-item-content.no-content-placeholder {
      opacity: 0.6;
      font-style: italic;
      cursor: default;
      background: transparent !important;
    }

    .nav-item-content.no-content-placeholder:hover {
      background: transparent !important;
    }

    .nav-item-content.no-content-placeholder .nav-icon {
      color: var(--wb-text-secondary);
    }

    .nav-item-content.no-content-placeholder .nav-label {
      color: var(--wb-text-secondary);
    }
  `]
})
export class CustomNavigationMenuComponent {
  @Input() menuItems: CustomMenuItem[] = [];
  @Input() nestingLevel: number = 0;

  private router = inject(Router);

  handleItemClick(item: CustomMenuItem): void {
    // If has children, toggle expansion
    if (item.items && item.items.length > 0) {
      item.expanded = !item.expanded;
    }
    
    // If has command, execute it
    if (item.command) {
      item.command();
    }
  }

  hasActiveChild(item: CustomMenuItem): boolean {
    if (!item.items) return false;
    
    // Check if any child or descendant is active
    return this.checkActiveRecursively(item.items);
  }

  private checkActiveRecursively(items: CustomMenuItem[]): boolean {
    for (const item of items) {
      // Check if this item is active
      if (item.styleClass?.includes('active')) {
        return true;
      }
      
      // Check children recursively
      if (item.items && this.checkActiveRecursively(item.items)) {
        return true;
      }
    }
    
    return false;
  }
}