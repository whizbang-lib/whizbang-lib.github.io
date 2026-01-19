import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { PopoverModule } from 'primeng/popover';
import { ThemeService, ThemeMode } from '../services/theme.service';

@Component({
  selector: 'wb-theme-toggle',
  standalone: true,
  imports: [CommonModule, ButtonModule, TooltipModule, PopoverModule],
  template: `
    <div class="theme-toggle-container">
      <!-- Quick Toggle Button -->
      <button 
        pButton 
        type="button"
        [icon]="currentIcon()"
        class="p-button-text p-button-rounded theme-toggle-btn"
        [pTooltip]="quickToggleTooltip()"
        tooltipPosition="bottom"
        (click)="quickToggle()"
        [attr.aria-label]="quickToggleTooltip()">
      </button>
      
      <!-- Advanced Options Button -->
      <button 
        pButton 
        type="button"
        icon="pi pi-chevron-down"
        class="p-button-text p-button-rounded theme-options-btn"
        pTooltip="Theme options"
        tooltipPosition="bottom"
        (click)="optionsPanel.toggle($event)"
        [attr.aria-label]="'Theme options'">
      </button>
      
      <!-- Theme Options Panel -->
      <p-popover #optionsPanel styleClass="theme-options-panel">
        <div class="theme-options">
          <h6>Theme Preference</h6>
          
          <div class="theme-option-group">
            <button 
              type="button"
              class="theme-option"
              [class.active]="themeService.themeMode() === 'light'"
              (click)="setTheme('light')"
              [attr.aria-pressed]="themeService.themeMode() === 'light'">
              <i class="pi pi-sun"></i>
              <span>Light</span>
            </button>
            
            <button 
              type="button"
              class="theme-option"
              [class.active]="themeService.themeMode() === 'dark'"
              (click)="setTheme('dark')"
              [attr.aria-pressed]="themeService.themeMode() === 'dark'">
              <i class="pi pi-moon"></i>
              <span>Dark</span>
            </button>
            
            <button 
              type="button"
              class="theme-option"
              [class.active]="themeService.themeMode() === 'auto'"
              (click)="setTheme('auto')"
              [attr.aria-pressed]="themeService.themeMode() === 'auto'">
              <i class="pi pi-desktop"></i>
              <span>System</span>
            </button>
          </div>
          
          <div class="theme-status" *ngIf="themeService.themeMode() === 'auto'">
            <small>
              Currently following system preference: 
              <strong>{{ themeService.systemTheme() }}</strong>
            </small>
          </div>
        </div>
      </p-popover>
    </div>
  `,
  styles: [`
    .theme-toggle-container {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .theme-toggle-btn {
      transition: all 0.2s ease;
    }
    
    .theme-toggle-btn:hover {
      transform: scale(1.1);
    }
    
    .theme-options-btn {
      font-size: 0.75rem;
      width: 1.5rem;
      height: 1.5rem;
    }
    
    :host ::ng-deep .theme-options-panel .p-popover-content {
      padding: 0;
    }
    
    .theme-options {
      padding: 1rem;
      min-width: 200px;
    }
    
    .theme-options h6 {
      margin: 0 0 0.75rem 0;
      color: var(--text-color);
      font-size: 0.9rem;
      font-weight: 600;
    }
    
    .theme-option-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    
    .theme-option {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--surface-border);
      border-radius: 0.375rem;
      background: var(--surface-card);
      color: var(--text-color);
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.875rem;
      text-align: left;
      width: 100%;
    }
    
    .theme-option:hover {
      background: var(--surface-hover);
      border-color: var(--primary-color);
    }
    
    .theme-option.active {
      background: var(--primary-color);
      color: var(--primary-color-text);
      border-color: var(--primary-color);
    }
    
    .theme-option i {
      font-size: 1rem;
      width: 1rem;
      text-align: center;
    }
    
    .theme-status {
      padding-top: 0.75rem;
      border-top: 1px solid var(--surface-border);
      color: var(--text-color-secondary);
      text-align: center;
    }
    
    .theme-status strong {
      color: var(--text-color);
      text-transform: capitalize;
    }

  `]
})
export class ThemeToggleComponent {
  readonly themeService = inject(ThemeService);
  
  // Computed properties for reactive UI
  readonly currentIcon = computed(() => {
    const activeTheme = this.themeService.activeTheme();
    return activeTheme === 'dark' ? 'pi pi-moon' : 'pi pi-sun';
  });
  
  readonly quickToggleTooltip = computed(() => {
    const activeTheme = this.themeService.activeTheme();
    const oppositeTheme = activeTheme === 'dark' ? 'light' : 'dark';
    return `Switch to ${oppositeTheme} theme`;
  });
  
  /**
   * Quick toggle between light and dark themes
   */
  quickToggle(): void {
    this.themeService.toggleTheme();
  }
  
  /**
   * Set specific theme mode
   */
  setTheme(mode: ThemeMode): void {
    this.themeService.setThemeMode(mode);
  }
}