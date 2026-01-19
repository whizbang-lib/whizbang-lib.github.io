import { Injectable, inject, effect } from '@angular/core';
import { ThemeService, ActiveTheme } from './theme.service';

@Injectable({
  providedIn: 'root'
})
export class ThemeConfigService {
  private readonly themeService = inject(ThemeService);
  
  constructor() {
    // Watch for theme changes using effect (for signals)
    effect(() => {
      const theme = this.themeService.activeTheme();
      this.applyPrimeNGTheme(theme);
    });
  }
  
  /**
   * Initialize theme configuration
   */
  initialize(): void {
    // Apply initial theme
    this.applyPrimeNGTheme(this.themeService.activeTheme());
  }
  
  /**
   * Apply PrimeNG theme configuration based on active theme
   */
  private applyPrimeNGTheme(theme: ActiveTheme): void {
    // The WhizbangPreset theme handles all styling automatically
    // PrimeNG v19 with proper theme preset doesn't need manual CSS variable manipulation
    console.log(`Applied PrimeNG theme: ${theme} (using WhizbangPreset)`);
    
    // Add fallback CSS variables to ensure overlays have backgrounds
    this.ensureOverlayBackgrounds(theme);
  }
  
  /**
   * Ensure overlay components have proper backgrounds using PrimeNG v19 variables
   */
  private ensureOverlayBackgrounds(theme: ActiveTheme): void {
    const root = document.documentElement;
    
    if (theme === 'dark') {
      // Dark theme overlay backgrounds using correct PrimeNG v19 variable names
      root.style.setProperty('--p-overlay-select-background', 'var(--p-surface-900)');
      root.style.setProperty('--p-overlay-popover-background', 'var(--p-surface-900)');
      root.style.setProperty('--p-overlay-modal-background', 'var(--p-surface-900)');
      root.style.setProperty('--p-content-background', 'var(--p-surface-900)');
      // Additional fallback for specific components
      root.style.setProperty('--p-sidebar-background', 'var(--p-surface-900)');
      root.style.setProperty('--p-popover-background', 'var(--p-surface-900)');
    } else {
      // Light theme overlay backgrounds using correct PrimeNG v19 variable names
      root.style.setProperty('--p-overlay-select-background', 'var(--p-surface-0)');
      root.style.setProperty('--p-overlay-popover-background', 'var(--p-surface-0)');
      root.style.setProperty('--p-overlay-modal-background', 'var(--p-surface-0)');
      root.style.setProperty('--p-content-background', 'var(--p-surface-0)');
      // Additional fallback for specific components
      root.style.setProperty('--p-sidebar-background', 'var(--p-surface-0)');
      root.style.setProperty('--p-popover-background', 'var(--p-surface-0)');
    }
    
    console.log(`Set PrimeNG v19 overlay background variables for ${theme} theme`);
  }
}