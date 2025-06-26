import { Component, inject, signal, OnInit, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { TooltipModule } from 'primeng/tooltip';
import { EnvironmentAwareDocsService, MenuItem } from '../services/environment-aware-docs.service';
import { CustomNavigationMenuComponent, CustomMenuItem } from './custom-navigation-menu.component';
import { ThemeService, ThemeMode } from '../services/theme.service';
import { UserPreferencesService } from '../services/user-preferences.service';
import { MenuItem as PrimeMenuItem } from 'primeng/api';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'wb-hamburger-menu',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    DividerModule,
    TooltipModule,
    CustomNavigationMenuComponent
  ],
  template: `
    <button 
      pButton 
      type="button" 
      icon="pi pi-bars" 
      class="p-button-text p-button-rounded hamburger-btn"
      (click)="toggleMenu()"
      [attr.aria-label]="'Open navigation menu'"
      pTooltip="Navigation Menu"
      tooltipPosition="bottom">
    </button>

    <!-- Custom push sidebar -->
    <div class="push-sidebar" [class.open]="menuVisible()">
      <div class="sidebar-header">
        <div class="sidebar-header-content">
          <img 
            [src]="getLogoPath()" 
            width="120" 
            class="sidebar-logo"
            alt="Whizbang Logo"
          />
          <button 
            pButton 
            type="button" 
            icon="pi pi-times" 
            class="p-button-text p-button-rounded sidebar-close-btn"
            (click)="closeMenu()"
            [attr.aria-label]="'Close navigation menu'"
            pTooltip="Close Menu"
            tooltipPosition="bottom">
          </button>
        </div>
      </div>

      <div class="sidebar-content">
        <!-- Unified Navigation Menu -->
        <div class="sidebar-section">
          <wb-custom-navigation-menu 
            [menuItems]="customMenuItems()"
            [nestingLevel]="0">
          </wb-custom-navigation-menu>
        </div>

        <p-divider></p-divider>

        <!-- Theme & Settings -->
        <div class="sidebar-section">
          <h6 class="sidebar-section-title">Settings</h6>
          <div class="theme-buttons-row">
            <button 
              type="button"
              class="theme-button"
              [class.active]="themeService.themeMode() === 'light'"
              (click)="setTheme('light')"
              [attr.aria-pressed]="themeService.themeMode() === 'light'">
              <i class="pi pi-sun"></i>
              <span>Light</span>
            </button>
            
            <button 
              type="button"
              class="theme-button"
              [class.active]="themeService.themeMode() === 'dark'"
              (click)="setTheme('dark')"
              [attr.aria-pressed]="themeService.themeMode() === 'dark'">
              <i class="pi pi-moon"></i>
              <span>Dark</span>
            </button>
            
            <button 
              type="button"
              class="theme-button"
              [class.active]="themeService.themeMode() === 'auto'"
              (click)="setTheme('auto')"
              [attr.aria-pressed]="themeService.themeMode() === 'auto'">
              <i class="pi pi-desktop"></i>
              <span>System</span>
            </button>
          </div>
        </div>

        <!-- Footer Links -->
        <div class="sidebar-footer">
          <a 
            href="https://github.com/whizbang-lib/whizbang" 
            target="_blank" 
            class="footer-link">
            <i class="pi pi-github"></i>
            <span>GitHub</span>
            <i class="pi pi-external-link"></i>
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .hamburger-btn {
      color: white !important;
      font-size: 1.2rem;
      width: 2.5rem;
      height: 2.5rem;
      transition: background-color 0.2s;
    }

    .hamburger-btn:hover {
      background-color: rgba(255, 255, 255, 0.1) !important;
    }

    /* Custom push sidebar */
    .push-sidebar {
      position: fixed;
      top: 0;
      left: 0;
      width: 280px;
      height: 100vh;
      background: var(--wb-surface-ground);
      border-right: 1px solid var(--wb-surface-border);
      box-shadow: 2px 0 12px rgba(0, 0, 0, 0.15);
      transform: translateX(-100%);
      transition: transform 0.3s ease;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      color: var(--wb-text-primary);
    }

    .push-sidebar.open {
      transform: translateX(0);
    }

    .sidebar-header {
      padding: 1rem;
      border-bottom: 1px solid var(--wb-surface-border);
      background: var(--wb-surface-section);
    }

    .sidebar-header-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sidebar-close-btn {
      color: var(--wb-text-primary) !important;
      font-size: 1.2rem;
      width: 2.5rem;
      height: 2.5rem;
      flex-shrink: 0;
    }

    .sidebar-close-btn:hover {
      background-color: var(--wb-surface-hover) !important;
      color: var(--wb-text-primary) !important;
    }

    .sidebar-logo {
      max-width: 100%;
      height: auto;
    }

    .sidebar-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 0;
    }

    .sidebar-section {
      padding: 0 0 0.75rem 0;
    }

    .sidebar-section-title {
      margin: 0 1rem 0.75rem 1rem;
      color: var(--wb-text-secondary);
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    :host ::ng-deep .unified-nav-menu {
      border: none;
      background: transparent;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-panel {
      border: none;
      border-radius: 0.375rem;
      margin-bottom: 0.25rem;
      background: transparent;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-header {
      border: none;
      border-radius: 0.375rem;
      background: transparent;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link {
      padding: 0.75rem;
      background: transparent;
      border: none;
      color: var(--wb-text-primary);
      transition: all 0.2s;
      font-size: 0.9rem;
      font-weight: 500;
      border-radius: 0.375rem;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link:hover {
      background: var(--wb-surface-hover);
      color: var(--wb-text-primary);
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-content {
      border: none;
      padding: 0 0 0 1rem;
      background: transparent;
    }

    /* Menu item links (leaf items) */
    :host ::ng-deep .unified-nav-menu .p-menuitem-link {
      padding: 0.5rem 0.75rem;
      color: var(--wb-text-secondary);
      border-radius: 0.25rem;
      transition: all 0.2s;
      font-size: 0.875rem;
      border: none;
      background: transparent;
    }

    :host ::ng-deep .unified-nav-menu .p-menuitem-link:hover {
      background: var(--wb-surface-hover);
      color: var(--wb-text-primary);
    }

    /* Sub-menu content under top level menu items */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content {
      padding-top: 0.3em;
      margin-top: -0.1em;
    }

    /* Icons - theme aware */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link .p-menuitem-icon {
      color: var(--wb-text-secondary);
      margin-right: 0.75rem;
      font-size: 1rem;
    }

    /* Make sure toggles work properly */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link .p-panelmenu-icon {
      color: var(--wb-text-secondary);
    }

    /* Use CSS transforms to move arrows to the right */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link {
      position: relative !important;
      padding-right: 2rem !important;
    }

    /* Move chevron icons to the right using absolute positioning */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link .p-panelmenu-icon {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
    }

    /* Also target nested sub-menu items */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-link {
      position: relative !important;
      padding-right: 2rem !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-link .p-panelmenu-icon {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
    }

    /* Target any panel menu header with a chevron regardless of nesting */
    :host ::ng-deep .unified-nav-menu [class*="p-panelmenu-header-link"] .p-panelmenu-icon {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
    }

    /* Try targeting nested items more specifically */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-panel .p-panelmenu-content .p-panelmenu-panel .p-panelmenu-header-link {
      position: relative !important;
      padding-right: 2rem !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-panel .p-panelmenu-content .p-panelmenu-panel .p-panelmenu-header-link .p-panelmenu-icon {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
    }

    /* Try broader targeting for ALL chevron icons */
    :host ::ng-deep .unified-nav-menu .pi-chevron-right,
    :host ::ng-deep .unified-nav-menu .pi-chevron-down {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
    }

    /* Ensure ALL parent elements of chevrons have relative positioning */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-panel .p-panelmenu-content .p-panelmenu-panel .p-panelmenu-header {
      position: relative !important;
    }

    /* Final attempt - target ALL i elements that are chevrons in the menu */
    :host ::ng-deep .unified-nav-menu i.pi-chevron-right,
    :host ::ng-deep .unified-nav-menu i.pi-chevron-down,
    :host ::ng-deep .unified-nav-menu i[class*="chevron"] {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }

    /* Make ALL their parent links relative and add padding */
    :host ::ng-deep .unified-nav-menu a:has(i.pi-chevron-right),
    :host ::ng-deep .unified-nav-menu a:has(i.pi-chevron-down),
    :host ::ng-deep .unified-nav-menu a:has(i[class*="chevron"]),
    :host ::ng-deep .unified-nav-menu button:has(i.pi-chevron-right),
    :host ::ng-deep .unified-nav-menu button:has(i.pi-chevron-down),
    :host ::ng-deep .unified-nav-menu button:has(i[class*="chevron"]) {
      position: relative !important;
      padding-right: 2rem !important;
    }

    /* Target the sub-menu items more aggressively - they might be nested deeper */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content a,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content button,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-link {
      position: relative !important;
      padding-right: 2rem !important;
    }

    /* Target chevrons in sub-menu content specifically */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content i.pi-chevron-right,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content i.pi-chevron-down,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-link i.pi-chevron-right,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-link i.pi-chevron-down {
      position: absolute !important;
      right: 0.75rem !important;
      left: auto !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      margin-left: 0 !important;
    }

    /* Different approach - use CSS transform to move chevrons from their current position */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .pi-chevron-right,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .pi-chevron-down {
      transform: translateX(calc(100vw - 180px)) !important;
      position: relative !important;
      z-index: 10 !important;
    }

    /* FLOAT APPROACH - Float arrows to the right */
    
    /* Float ALL possible arrow elements to the right */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-icon,
    :host ::ng-deep .unified-nav-menu .pi-chevron-right,
    :host ::ng-deep .unified-nav-menu .pi-chevron-down {
      float: right !important;
      margin-right: 0.75rem !important;
      margin-left: 0 !important;
    }

    /* Ensure text stays left-aligned */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-label,
    :host ::ng-deep .unified-nav-menu .p-menuitem-text {
      text-align: left !important;
      float: none !important;
    }

    /* Clear floats on menu items */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link,
    :host ::ng-deep .unified-nav-menu .p-menuitem-link {
      overflow: hidden !important;
    }

    /* PHASE 3: Text Alignment - Force proper left alignment */
    
    /* Ensure ALL text elements are properly left-aligned */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-label,
    :host ::ng-deep .unified-nav-menu .p-menuitem-text,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-label,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-text {
      text-align: left !important;
      flex: 1 !important;
      margin-right: 1rem !important;
      direction: ltr !important;
    }

    /* Keep menu item icons properly positioned on the left */
    :host ::ng-deep .unified-nav-menu .p-menuitem-icon {
      position: static !important;
      margin-right: 0.75rem !important;
      margin-left: 0 !important;
      order: 0 !important;
    }

    /* PHASE 4: Remove ALL indenting from sub-menu content */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content {
      padding: 0 !important;
      padding-left: 0 !important;
      margin-left: 0 !important;
      margin: 0 !important;
    }

    /* Ensure sub-menu items use full width */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem,
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-panel {
      margin-left: 0 !important;
      padding-left: 0 !important;
    }

    /* PHASE 5: Visual Hierarchy - Enhanced styling */
    
    /* Top-level menu items - bold font and different background */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link {
      font-weight: 700 !important;
      background: var(--wb-surface-section) !important;
      margin: 0.25rem 0 !important;
      border-radius: 0.375rem !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link:hover {
      background: var(--wb-surface-hover) !important;
    }

    /* Sub-menu items - normal font and transparent background */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-link {
      font-weight: 400 !important;
      background: transparent !important;
      padding: 0.5rem 0.75rem !important;
      margin: 0.125rem 0 !important;
      border-radius: 0.25rem !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-link:hover {
      background: var(--wb-surface-hover) !important;
    }

    /* Nested expandable sub-menu items */
    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-link {
      font-weight: 500 !important;
      background: transparent !important;
      padding: 0.5rem 0.75rem !important;
      margin: 0.125rem 0 !important;
      border-radius: 0.25rem !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-link:hover {
      background: var(--wb-surface-hover) !important;
    }

    /* Ensure menu item icons stay on the left */
    :host ::ng-deep .unified-nav-menu .p-menuitem-icon {
      position: static !important;
      margin-right: 0.75rem !important;
    }


    /* Remove white backgrounds more aggressively but preserve text */
    :host ::ng-deep .push-sidebar .p-panelmenu,
    :host ::ng-deep .push-sidebar .p-panelmenu-panel,
    :host ::ng-deep .push-sidebar .p-panelmenu-header,
    :host ::ng-deep .push-sidebar .p-panelmenu-content {
      background: transparent !important;
      border: none !important;
    }

    /* Target the unified menu specifically */
    :host ::ng-deep .unified-nav-menu {
      background: transparent !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu {
      background: transparent !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-panel {
      background: transparent !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-header {
      background: transparent !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-content {
      background: transparent !important;
    }

    /* Fix text visibility - theme aware text */
    :host ::ng-deep .push-sidebar .p-panelmenu-header-label {
      color: var(--wb-text-primary) !important;
    }

    :host ::ng-deep .unified-nav-menu .p-panelmenu-header-label {
      color: var(--wb-text-primary) !important;
    }

    /* Divider styling - theme aware */
    :host ::ng-deep .push-sidebar .p-divider {
      border-color: var(--wb-surface-border);
    }

    :host ::ng-deep .push-sidebar .p-divider-horizontal:before {
      border-top-color: var(--wb-surface-border);
    }

    .settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
    }

    .settings-label {
      font-size: 0.9rem;
      color: var(--wb-text-primary);
      font-weight: 500;
    }

    .theme-buttons-row {
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      flex-wrap: wrap;
    }

    .theme-button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--wb-surface-border);
      border-radius: 0.375rem;
      background: var(--wb-surface-card);
      color: var(--wb-text-primary);
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.875rem;
      text-align: left;
      flex: 1;
      min-width: 0;
    }

    .theme-button:hover {
      background: var(--wb-surface-hover);
      border-color: var(--wb-primary-color);
    }

    .theme-button.active {
      background: var(--wb-primary-color);
      color: var(--wb-primary-color-text);
      border-color: var(--wb-primary-color);
    }

    .theme-button i {
      font-size: 1rem;
      width: 1rem;
      text-align: center;
      flex-shrink: 0;
    }

    .theme-button span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-footer {
      margin-top: auto;
      padding: 1rem;
      border-top: 1px solid var(--wb-surface-border);
      background: var(--wb-surface-section);
    }

    .footer-link {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      color: var(--wb-text-secondary);
      text-decoration: none;
      border-radius: 0.375rem;
      transition: all 0.2s;
      font-size: 0.9rem;
    }

    .footer-link:hover {
      background: var(--wb-surface-hover);
      color: var(--wb-text-primary);
    }

    .footer-link i:first-child {
      font-size: 1rem;
    }

    .footer-link i:last-child {
      font-size: 0.75rem;
      margin-left: auto;
      opacity: 0.6;
    }

    /* Mobile optimizations - Enhanced for better touch interaction */
    @media (max-width: 768px) {
      .push-sidebar {
        width: 320px; /* Slightly wider for tablet */
      }
      
      .hamburger-btn {
        width: 44px !important; /* WCAG compliant touch target */
        height: 44px !important;
        font-size: 1.25rem;
      }
      
      .sidebar-close-btn {
        width: 44px !important; /* WCAG compliant touch target */
        height: 44px !important;
        font-size: 1.25rem;
      }
      
      .sidebar-section {
        padding: 1rem;
      }
      
      :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link,
      :host ::ng-deep .unified-nav-menu .p-menuitem-link {
        padding: 1rem 0.75rem; /* Better touch targets */
        font-size: 1rem;
        min-height: 44px; /* WCAG compliant */
        display: flex;
        align-items: center;
      }
      
      .footer-link {
        padding: 1rem 0.75rem;
        min-height: 44px; /* WCAG compliant */
        font-size: 1rem;
      }
    }
    
    @media (max-width: 480px) {
      .push-sidebar {
        width: 100vw; /* Full width on small mobile */
      }

      .sidebar-section {
        padding: 0.75rem;
      }

      :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link,
      :host ::ng-deep .unified-nav-menu .p-menuitem-link {
        padding: 1.25rem 1rem; /* Even larger touch targets for small screens */
        font-size: 1.125rem;
        min-height: 48px; /* Larger than minimum for small screens */
      }
      
      .footer-link {
        padding: 1.25rem 1rem;
        min-height: 48px;
        font-size: 1.125rem;
      }
      
      .settings-row {
        padding: 1rem;
        min-height: 48px;
      }
    }

    /* Ensure proper scrolling */
    :host ::ng-deep .hamburger-sidebar .p-sidebar-content {
      overflow: hidden;
    }

    .sidebar-content {
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--surface-300) transparent;
    }

    .sidebar-content::-webkit-scrollbar {
      width: 6px;
    }

    .sidebar-content::-webkit-scrollbar-track {
      background: transparent;
    }

    .sidebar-content::-webkit-scrollbar-thumb {
      background: var(--surface-300);
      border-radius: 3px;
    }

    .sidebar-content::-webkit-scrollbar-thumb:hover {
      background: var(--surface-400);
    }

    /* Active menu item styling - green text color */
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-panelmenu-header-link,
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-menuitem-link,
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-panelmenu-item-link {
      color: #10b981 !important;
      font-weight: 600 !important;
    }

    :host ::ng-deep .unified-nav-menu .active-menu-item .p-panelmenu-header-link .p-panelmenu-header-label,
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-menuitem-link .p-menuitem-text,
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-panelmenu-item-link {
      color: #10b981 !important;
      font-weight: 600 !important;
    }

    /* Active item icons should be green and more prominent */
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-menuitem-icon {
      color: #10b981 !important;
      font-weight: bold !important;
    }

    /* Hover states for active items */
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-panelmenu-header-link:hover,
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-menuitem-link:hover,
    :host ::ng-deep .unified-nav-menu .active-menu-item .p-panelmenu-item-link:hover {
      color: #059669 !important;
    }

    /* LIGHT MODE HOVER - DARKER COLOR FOR VISIBILITY */
    :root:not([data-theme="dark"]) :host ::ng-deep .unified-nav-menu .p-panelmenu-header-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .unified-nav-menu .p-menuitem-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-menuitem-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .push-sidebar .unified-nav-menu .p-panelmenu-header-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .push-sidebar .unified-nav-menu .p-menuitem-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .push-sidebar .unified-nav-menu .p-panelmenu-content .p-menuitem-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .push-sidebar .unified-nav-menu .p-panelmenu-content .p-panelmenu-header-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .sidebar-content .unified-nav-menu .p-panelmenu-header-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .sidebar-content .unified-nav-menu .p-menuitem-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .sidebar-section .unified-nav-menu .p-panelmenu-header-link:hover,
    :root:not([data-theme="dark"]) :host ::ng-deep .sidebar-section .unified-nav-menu .p-menuitem-link:hover,
    :root:not([data-theme="dark"]) :host .footer-link:hover,
    :root:not([data-theme="dark"]) :host .sidebar-close-btn:hover {
      background: #e5e7eb !important;
      background-color: #e5e7eb !important;
    }

  `]
})
export class HamburgerMenuComponent implements OnInit, OnDestroy {
  
  private router = inject(Router);
  private docsMenuService = inject(EnvironmentAwareDocsService);
  private themeService = inject(ThemeService);
  private userPreferencesService = inject(UserPreferencesService);
  
  private routerSubscription?: Subscription;
  
  // Use preferences service for menu visibility
  menuVisible = this.userPreferencesService.sidebarOpen;
  docsMenuItems = signal<MenuItem[]>([]);
  currentUrl = signal<string>('');

  // Convert to PrimeNG MenuItem structure - the standard way
  menuItems = computed(() => {
    const currentUrl = this.currentUrl();
    const items: PrimeMenuItem[] = [
      {
        label: 'Home',
        icon: 'pi pi-home',
        command: () => this.router.navigate(['/']),
        styleClass: this.isActiveRoute('/') ? 'active-menu-item' : ''
      },
      {
        label: 'Examples',
        icon: 'pi pi-code',
        command: () => this.router.navigate(['/examples']),
        styleClass: this.isActiveRoute('/examples') ? 'active-menu-item' : ''
      },
      {
        label: 'Videos',
        icon: 'pi pi-video',
        command: () => this.router.navigate(['/videos']),
        styleClass: this.isActiveRoute('/videos') ? 'active-menu-item' : ''
      }
    ];

    // Add documentation with sub-items (no command = expandable only)
    const docs = this.docsMenuItems();
    if (docs.length > 0) {
      const docsItem: PrimeMenuItem = {
        label: 'Documentation',
        icon: 'pi pi-book',
        items: this.convertToMenuItems(docs),
        expanded: this.shouldExpandDocs(currentUrl)
        // No command property = only expands, doesn't navigate
      };
      items.push(docsItem);
    }

    return items;
  });

  // Convert to Custom MenuItem structure for our new component
  customMenuItems = computed(() => {
    const currentUrl = this.currentUrl();
    const items: CustomMenuItem[] = [
      {
        label: 'Home',
        icon: 'pi pi-home',
        command: () => this.router.navigate(['/']),
        styleClass: this.isActiveRoute('/') ? 'active-menu-item' : ''
      },
      {
        label: 'Examples',
        icon: 'pi pi-code',
        command: () => this.router.navigate(['/examples']),
        styleClass: this.isActiveRoute('/examples') ? 'active-menu-item' : ''
      },
      {
        label: 'Videos',
        icon: 'pi pi-video',
        command: () => this.router.navigate(['/videos']),
        styleClass: this.isActiveRoute('/videos') ? 'active-menu-item' : ''
      }
    ];

    // Add documentation with sub-items
    const docs = this.docsMenuItems();
    if (docs.length > 0) {
      const docsItem: CustomMenuItem = {
        label: 'Documentation',
        icon: 'pi pi-book',
        items: this.convertToCustomMenuItems(docs),
        expanded: this.shouldExpandDocs(currentUrl),
        styleClass: this.isActiveRoute('/docs') ? 'active-menu-item' : ''
      };
      items.push(docsItem);
    }

    return items;
  });

  // Helper method to convert our MenuItem to PrimeNG MenuItem
  private convertToMenuItems(menuItems: MenuItem[]): PrimeMenuItem[] {
    return menuItems.map(item => {
      const menuItem: PrimeMenuItem = {
        label: item.label,
        command: item.slug ? () => {
          const urlParts = ['docs', ...item.slug.split('/').filter(part => part)];
          this.router.navigate(urlParts);
        } : undefined,
        styleClass: item.slug && this.isActiveDocsRoute(item.slug) ? 'active-menu-item' : ''
      };

      if (item.items && item.items.length > 0) {
        menuItem.items = this.convertToMenuItems(item.items);
        menuItem.expanded = this.shouldExpandMenuItem(item);
      }

      return menuItem;
    });
  }

  // Helper method to convert our MenuItem to Custom MenuItem
  private convertToCustomMenuItems(menuItems: MenuItem[]): CustomMenuItem[] {
    return menuItems.map(item => {
      const menuItem: CustomMenuItem = {
        label: item.label,
        command: item.slug ? () => {
          const urlParts = ['docs', ...item.slug.split('/').filter(part => part)];
          this.router.navigate(urlParts);
        } : undefined,
        styleClass: item.slug && this.isActiveDocsRoute(item.slug) ? 'active-menu-item' : ''
      };

      if (item.items && item.items.length > 0) {
        menuItem.items = this.convertToCustomMenuItems(item.items);
        menuItem.expanded = this.shouldExpandMenuItem(item);
      }

      return menuItem;
    });
  }

  ngOnInit() {
    // Initialize current URL
    this.currentUrl.set(this.router.url);
    
    // Subscribe to router events to track current URL
    this.routerSubscription = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.currentUrl.set(event.url);
    });

    // Initialize docs menu items
    this.docsMenuService.generateMenuItems((slug: string) => {
      // Split slug into segments to avoid %2F encoding
      const urlParts = ['docs', ...slug.split('/').filter(part => part)];
      this.router.navigate(urlParts);
    }).subscribe(menuItems => {
      this.docsMenuItems.set(menuItems);
    });

    // Initialize body class based on saved preference
    if (this.menuVisible()) {
      document.body.classList.add('sidebar-open');
    }
  }

  ngOnDestroy() {
    this.routerSubscription?.unsubscribe();
  }

  toggleMenu() {
    const newVisible = this.userPreferencesService.toggleSidebar();
    // Add/remove class to body to push content
    if (newVisible) {
      document.body.classList.add('sidebar-open');
    } else {
      document.body.classList.remove('sidebar-open');
    }
  }

  closeMenu() {
    this.userPreferencesService.setSidebarOpen(false);
    document.body.classList.remove('sidebar-open');
  }



  getLogoPath(): string {
    const isDark = this.themeService.isDarkTheme();
    return isDark ? 'assets/branding/logo-dark.svg' : 'assets/branding/logo-light.svg';
  }

  // Route matching helper methods
  private isActiveRoute(route: string): boolean {
    const currentUrl = this.currentUrl();
    if (route === '/') {
      return currentUrl === '/' || currentUrl === '';
    }
    return currentUrl.startsWith(route);
  }

  private isActiveDocsRoute(slug: string): boolean {
    const currentUrl = this.currentUrl();
    const expectedPath = `/docs/${slug}`;
    return currentUrl === expectedPath || currentUrl.startsWith(expectedPath + '/');
  }

  private shouldExpandDocs(currentUrl: string): boolean {
    return currentUrl.startsWith('/docs');
  }

  private shouldExpandMenuItem(item: MenuItem): boolean {
    if (!item.items || item.items.length === 0) {
      return false;
    }
    
    // Expand if any child item is active
    return this.hasActiveChild(item);
  }

  private hasActiveChild(item: MenuItem): boolean {
    const currentUrl = this.currentUrl();
    
    // Check if this item's slug matches current route
    if (item.slug && this.isActiveDocsRoute(item.slug)) {
      return true;
    }
    
    // Check children recursively
    if (item.items) {
      return item.items.some(child => this.hasActiveChild(child));
    }
    
    return false;
  }

  /**
   * Set specific theme mode
   */
  setTheme(mode: ThemeMode): void {
    this.themeService.setThemeMode(mode);
  }
}