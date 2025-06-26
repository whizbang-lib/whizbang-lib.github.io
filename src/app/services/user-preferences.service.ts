import { Injectable, signal } from '@angular/core';
import { ActiveTheme } from './theme.service';

export interface UserPreferences {
  sidebarOpen: boolean;
  theme: ActiveTheme;
}

@Injectable({
  providedIn: 'root'
})
export class UserPreferencesService {
  private readonly STORAGE_KEY = 'whizbang-user-preferences';
  
  // Default preferences
  private readonly defaultPreferences: UserPreferences = {
    sidebarOpen: false,
    theme: 'light'
  };

  // Reactive signals for preferences
  sidebarOpen = signal<boolean>(this.defaultPreferences.sidebarOpen);
  theme = signal<ActiveTheme>(this.defaultPreferences.theme);

  constructor() {
    this.loadPreferences();
  }

  /**
   * Load preferences from localStorage
   */
  private loadPreferences(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const preferences: UserPreferences = JSON.parse(stored);
        
        // Validate and set preferences
        this.sidebarOpen.set(Boolean(preferences.sidebarOpen));
        this.theme.set(preferences.theme === 'dark' ? 'dark' : 'light');
      }
    } catch (error) {
      console.warn('Failed to load user preferences from localStorage:', error);
    }
  }

  /**
   * Save preferences to localStorage
   */
  private savePreferences(): void {
    try {
      const preferences: UserPreferences = {
        sidebarOpen: this.sidebarOpen(),
        theme: this.theme()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.warn('Failed to save user preferences to localStorage:', error);
    }
  }

  /**
   * Update sidebar open state
   */
  setSidebarOpen(open: boolean): void {
    this.sidebarOpen.set(open);
    this.savePreferences();
  }

  /**
   * Toggle sidebar state
   */
  toggleSidebar(): boolean {
    const newState = !this.sidebarOpen();
    this.setSidebarOpen(newState);
    return newState;
  }

  /**
   * Update theme preference
   */
  setTheme(theme: ActiveTheme): void {
    this.theme.set(theme);
    this.savePreferences();
  }

  /**
   * Toggle theme
   */
  toggleTheme(): ActiveTheme {
    const newTheme: ActiveTheme = this.theme() === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
    return newTheme;
  }

  /**
   * Reset all preferences to defaults
   */
  resetPreferences(): void {
    this.sidebarOpen.set(this.defaultPreferences.sidebarOpen);
    this.theme.set(this.defaultPreferences.theme);
    this.savePreferences();
  }
}