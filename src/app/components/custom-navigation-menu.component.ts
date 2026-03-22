import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MenuItem } from '../services/environment-aware-docs.service';
import { VersionSelectorComponent } from './version-selector.component';

export interface CustomMenuItem {
  label: string;
  icon?: string;
  lightMode: boolean;
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
    <ul class="custom-nav-menu" [class.nested-level]="nestingLevel >= 2" [attr.data-level]="nestingLevel">
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
          [class.third-level]="nestingLevel === 2"
          [class.deep-level]="nestingLevel >= 3"
          [class.has-children]="item.items && item.items.length > 0"
          [class.active]="item.styleClass?.includes('active')"
          [class.has-active-child]="hasActiveChild(item)"
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
      transition: all 0.2s ease;
      border-radius: 0.375rem;
      margin: 0.125rem 0.5rem;
    }

    /* ── Top-level items ── */
    .nav-item-content.top-level {
      font-weight: 600;
      font-size: 0.9rem;
      background: transparent;
      padding: 0.625rem 0.75rem;
      margin: 0.125rem 0.5rem;
      border-left: 2px solid transparent;
    }

    .nav-item-content.top-level:hover {
      background: rgba(255, 124, 0, 0.06);
      border-left-color: rgba(255, 124, 0, 0.3);
    }

    .nav-item-content.top-level.has-children {
      font-weight: 700;
      font-size: 0.8rem;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--wb-text-secondary);
      padding: 0.75rem 0.75rem 0.5rem;
      margin-top: 0.75rem;
      border-left: none;
      border-radius: 0;
    }

    .nav-item-content.top-level.has-children:first-child {
      margin-top: 0.25rem;
    }

    .nav-item-content.top-level.has-children:hover {
      background: transparent;
      border-left: none;
    }

    .nav-item-content.top-level.has-children .nav-label {
      color: var(--wb-text-secondary);
    }

    .nav-item-content.top-level.has-children .nav-arrow {
      font-size: 0.7rem;
    }

    /* ── Second-level items (folder contents) ── */
    .nav-item-content.second-level {
      font-weight: 400;
      font-size: 0.875rem;
      background: transparent;
      padding: 0.5rem 0.75rem 0.5rem 1rem;
      margin: 0.0625rem 0.5rem;
      border-left: 2px solid transparent;
      border-radius: 0.25rem;
    }

    .nav-item-content.second-level:hover {
      background: rgba(255, 124, 0, 0.06);
      border-left-color: rgba(255, 124, 0, 0.3);
    }

    /* Second-level folder headers (subfolders like Transports, Workers) */
    .nav-item-content.second-level.has-children {
      font-weight: 700;
      font-size: 0.75rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 0.625rem 0.75rem;
      margin-top: 0.5rem;
      border-left: 2px solid var(--brand-purple, #7b3ff8);
      background: rgba(123, 63, 248, 0.05);
      border-radius: 0 0.25rem 0.25rem 0;
    }

    .nav-item-content.second-level.has-children .nav-label {
      color: var(--wb-text-secondary);
    }

    .nav-item-content.second-level.has-children:hover {
      border-left-color: var(--brand-orange, #ff7c00);
      background: rgba(255, 124, 0, 0.06);
    }

    .nav-item-content.second-level.has-children .nav-arrow {
      font-size: 0.625rem;
    }

    /* Submenu container for expanded second-level */
    .nav-item:has(.nav-item-content.second-level) > .submenu-wrapper.expanded {
      margin: 0 0 0.25rem 0;
    }

    /* ── Highlight items that have an active child ── */
    .nav-item-content.has-active-child .nav-label {
      color: var(--brand-orange, #ff7c00);
      font-weight: 600;
    }

    .nav-item-content.has-active-child .nav-icon {
      color: var(--brand-orange, #ff7c00);
    }

    .nav-item-content.top-level.has-children.has-active-child {
      border-bottom: 1px solid rgba(255, 124, 0, 0.2);
      padding-bottom: calc(0.5rem - 1px);
    }

    /* ── Third-level items (children of subfolders) ── */
    .nav-item-content.third-level {
      font-weight: 400;
      font-size: 0.8125rem;
      background: transparent;
      border: none;
      padding: 0.4375rem 0.5rem 0.4375rem 0.75rem;
      margin: 0.0625rem 0;
      border-radius: 0.25rem;
      border-left: 2px solid transparent;
    }

    .nav-item-content.third-level:hover {
      background: rgba(255, 124, 0, 0.06);
      border-left-color: rgba(255, 124, 0, 0.3);
    }

    .nav-item-content.third-level.has-children {
      font-weight: 700;
      font-size: 0.6875rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      border-left: 2px solid rgba(255, 0, 102, 0.3);
      background: rgba(255, 0, 102, 0.04);
      border-radius: 0 0.25rem 0.25rem 0;
      padding: 0.5rem 0.75rem;
      margin-top: 0.375rem;
    }

    .nav-item-content.third-level.has-children .nav-label {
      color: var(--wb-text-secondary);
    }

    .nav-item-content.third-level.has-children:hover {
      border-left-color: var(--brand-pink, #ff0066);
      background: rgba(255, 0, 102, 0.06);
    }

    /* ── Deep-level items (4th level+) ── */
    .nav-item-content.deep-level {
      font-weight: 400;
      font-size: 0.8rem;
      background: transparent;
      border: none;
      padding: 0.375rem 0.5rem 0.375rem 0.75rem;
      margin: 0.0625rem 0;
      border-radius: 0.25rem;
      border-left: 2px solid transparent;
    }

    .nav-item-content.deep-level:hover {
      background: rgba(255, 124, 0, 0.06);
      border-left-color: rgba(255, 124, 0, 0.3);
    }

    /* ── Nested containers — progressive indentation ── */
    .custom-nav-menu.nested-level {
      border-left: 2px solid rgba(123, 63, 248, 0.2);
      border-radius: 0 0.375rem 0.375rem 0;
      padding: 0.25rem 0.125rem;
      margin: 0.125rem 0.25rem 0.375rem 1rem;
    }

    /* Level 2 container (children of folders) */
    .custom-nav-menu[data-level="2"] {
      background: rgba(123, 63, 248, 0.04);
      border-left-color: rgba(123, 63, 248, 0.2);
    }

    /* Level 3 container (grandchildren) */
    .custom-nav-menu[data-level="3"] {
      background: rgba(255, 0, 102, 0.03);
      border-left-color: rgba(255, 0, 102, 0.2);
    }

    /* Level 4+ container */
    .custom-nav-menu[data-level="4"],
    .custom-nav-menu[data-level="5"] {
      background: rgba(255, 124, 0, 0.03);
      border-left-color: rgba(255, 124, 0, 0.2);
    }

    :root:not([data-theme="dark"]) .custom-nav-menu.nested-level {
      border-left-color: rgba(123, 63, 248, 0.12);
    }

    :root:not([data-theme="dark"]) .custom-nav-menu[data-level="2"] {
      background: rgba(123, 63, 248, 0.03);
    }

    :root:not([data-theme="dark"]) .custom-nav-menu[data-level="3"] {
      background: rgba(255, 0, 102, 0.025);
    }

    /* ── Icon on left ── */
    .nav-icon {
      color: var(--wb-text-secondary);
      margin-right: 0.625rem;
      font-size: 0.9375rem;
      flex-shrink: 0;
    }

    /* ── Text in middle ── */
    .nav-label {
      flex: 1;
      text-align: left;
      color: var(--wb-text-primary);
      line-height: 1.35;
    }

    /* ── Arrow on right ── */
    .nav-arrow {
      color: var(--wb-text-primary);
      font-size: 0.75rem;
      flex-shrink: 0;
      margin-left: 0.5rem;
      opacity: 0.8;
      transition: all 0.2s ease-in-out;
    }

    .nav-item-content:hover .nav-arrow {
      opacity: 1;
      color: var(--brand-orange, #ff7c00);
    }

    .nav-item-content.has-active-child .nav-arrow {
      color: var(--brand-orange, #ff7c00);
      opacity: 1;
    }

    /* ── Active item ── */
    .nav-item-content.active {
      background: rgba(255, 124, 0, 0.08);
      border-left: 3px solid;
      border-image: linear-gradient(180deg, #ff7c00, #ff0066, #7b3ff8) 1;
    }

    :root:not([data-theme="dark"]) .nav-item-content.active {
      background: rgba(255, 124, 0, 0.06);
    }

    .nav-item-content.active .nav-label {
      color: var(--brand-orange, #ff7c00) !important;
      font-weight: 600 !important;
    }

    .nav-item-content.active .nav-icon,
    .nav-item-content.active .nav-arrow {
      color: var(--brand-orange, #ff7c00) !important;
    }

    /* ── No indenting for sub-menus ── */
    wb-custom-navigation-menu {
      display: block;
      padding-left: 0;
      margin-left: 0;
    }

    /* ── Submenu animation ── */
    .submenu-wrapper {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.3s ease-in-out, opacity 0.2s ease-in-out;
      opacity: 0;
    }

    .submenu-wrapper > * {
      overflow: hidden;
    }

    .submenu-wrapper.expanded {
      grid-template-rows: 1fr;
      opacity: 1;
    }

    /* Arrow rotation animation */
    .nav-arrow {
      transition: transform 0.2s ease-in-out, opacity 0.2s ease, color 0.2s ease;
    }

    .nav-item-content:has(+ .submenu-wrapper.expanded) .nav-arrow.pi-chevron-right {
      transform: rotate(90deg);
    }

    /* ── Version Selector ── */
    .version-selector-item {
      padding: 0.5rem 0.75rem;
      margin: 0.25rem 0.5rem;
      background: transparent;
      border-radius: 0.375rem;
      border: none;
    }

    .version-selector-header {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .version-selector-header .nav-icon {
      color: #ffffff;
      margin-right: 0.5rem;
      font-size: 0.875rem;
    }

    .version-selector-label {
      font-size: 0.6875rem;
      font-weight: 700 !important;
      text-transform: uppercase;
      color: var(--wb-text-secondary) !important;
      letter-spacing: 0.06em;
    }

    .version-selector-wrapper {
      padding: 0;
    }

    .version-selector-wrapper :host ::ng-deep .version-selector-btn {
      width: 100%;
      justify-content: space-between;
      font-size: 0.875rem;
    }

    /* ── No content placeholder ── */
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