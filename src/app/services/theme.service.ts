import { Injectable, signal, effect, inject } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ActiveTheme = 'light' | 'dark';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly STORAGE_KEY = 'wb-theme-preference';
  
  // Reactive signals for theme state
  private readonly _themeMode = signal<ThemeMode>('auto');
  private readonly _activeTheme = signal<ActiveTheme>('light');
  private readonly _systemTheme = signal<ActiveTheme>('light');
  
  // Public readonly signals
  readonly themeMode = this._themeMode.asReadonly();
  readonly activeTheme = this._activeTheme.asReadonly();
  readonly systemTheme = this._systemTheme.asReadonly();
  
  constructor() {
    // Initialize theme on service creation
    this.initializeTheme();
    
    // Watch for system theme changes
    this.watchSystemTheme();
    
    // Update active theme when mode or system theme changes
    effect(() => {
      this.updateActiveTheme();
    });
    
    // Apply theme changes to DOM
    effect(() => {
      this.applyThemeToDOM();
    });
  }
  
  /**
   * Set the theme mode (light, dark, or auto)
   */
  setThemeMode(mode: ThemeMode): void {
    this._themeMode.set(mode);
    this.saveThemePreference(mode);
  }
  
  /**
   * Toggle between light and dark themes
   * If currently on auto, switches to the opposite of current system theme
   */
  toggleTheme(): void {
    const currentMode = this._themeMode();
    
    if (currentMode === 'auto') {
      // If on auto, switch to opposite of system theme
      const oppositeTheme = this._systemTheme() === 'light' ? 'dark' : 'light';
      this.setThemeMode(oppositeTheme);
    } else {
      // Toggle between light and dark
      const newMode = currentMode === 'light' ? 'dark' : 'light';
      this.setThemeMode(newMode);
    }
  }
  
  /**
   * Get theme-aware CSS custom property value
   */
  getThemeProperty(propertyName: string): string {
    if (typeof window === 'undefined') return '';
    
    const rootStyles = getComputedStyle(document.documentElement);
    return rootStyles.getPropertyValue(propertyName).trim();
  }
  
  /**
   * Check if current theme is dark
   */
  isDarkTheme(): boolean {
    return this._activeTheme() === 'dark';
  }
  
  /**
   * Check if current theme is light
   */
  isLightTheme(): boolean {
    return this._activeTheme() === 'light';
  }
  
  /**
   * Get appropriate syntax highlighting theme
   */
  getSyntaxHighlightTheme(): string {
    return this.isDarkTheme() ? 'dark-plus' : 'light-plus';
  }
  
  private initializeTheme(): void {
    // Load saved preference or default to auto
    const savedTheme = this.loadThemePreference();
    this._themeMode.set(savedTheme);
    
    // Initialize system theme
    this.updateSystemTheme();
  }
  
  private watchSystemTheme(): void {
    if (typeof window === 'undefined') return;
    
    // Watch for changes to system color scheme preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (event: MediaQueryListEvent) => {
      this.updateSystemTheme();
    };
    
    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
    }
  }
  
  private updateSystemTheme(): void {
    if (typeof window === 'undefined') {
      this._systemTheme.set('light');
      return;
    }
    
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this._systemTheme.set(prefersDark ? 'dark' : 'light');
  }
  
  private updateActiveTheme(): void {
    const mode = this._themeMode();
    const systemTheme = this._systemTheme();
    
    if (mode === 'auto') {
      this._activeTheme.set(systemTheme);
    } else {
      this._activeTheme.set(mode);
    }
  }
  
  private applyThemeToDOM(): void {
    if (typeof document === 'undefined') return;
    
    const activeTheme = this._activeTheme();
    const root = document.documentElement;
    
    // Set data attribute for CSS targeting
    root.setAttribute('data-theme', activeTheme);
    
    // Update meta theme-color for mobile browsers
    this.updateMetaThemeColor();
    
    // Sync with unified preferences
    this.updateUnifiedPreferences(activeTheme);
    
    // Dispatch custom event for other components to listen to
    window.dispatchEvent(new CustomEvent('theme-changed', {
      detail: { theme: activeTheme, mode: this._themeMode() }
    }));
  }
  
  private updateMetaThemeColor(): void {
    if (typeof document === 'undefined') return;
    
    const themeColorMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
    if (themeColorMeta) {
      const themeColor = this.isDarkTheme() ? '#1a202c' : '#ffffff';
      themeColorMeta.content = themeColor;
    }
  }
  
  private saveThemePreference(theme: ThemeMode): void {
    if (typeof localStorage === 'undefined') return;
    
    try {
      localStorage.setItem(this.STORAGE_KEY, theme);
      // Also update the unified preferences service
      this.updateUnifiedPreferences(theme === 'auto' ? 'light' : theme as ActiveTheme);
    } catch (error) {
      console.warn('Failed to save theme preference:', error);
    }
  }
  
  private loadThemePreference(): ThemeMode {
    if (typeof localStorage === 'undefined') return 'auto';
    
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved && ['light', 'dark', 'auto'].includes(saved)) {
        return saved as ThemeMode;
      }
    } catch (error) {
      console.warn('Failed to load theme preference:', error);
    }
    
    return 'auto';
  }

  private updateUnifiedPreferences(activeTheme: ActiveTheme): void {
    // Update the unified preferences service if available
    // This is called after theme changes to keep preferences in sync
    try {
      const prefsKey = 'whizbang-user-preferences';
      const stored = localStorage.getItem(prefsKey);
      if (stored) {
        const preferences = JSON.parse(stored);
        preferences.theme = activeTheme;
        localStorage.setItem(prefsKey, JSON.stringify(preferences));
      }
    } catch (error) {
      console.warn('Failed to update unified preferences:', error);
    }
  }
}