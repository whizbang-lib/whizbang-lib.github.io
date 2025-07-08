import { Component, inject } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { EnhancedSearchComponent } from '../components/enhanced-search.component';
import { ThemeToggleComponent } from '../components/theme-toggle.component';
import { HamburgerMenuComponent } from '../components/hamburger-menu.component';
import { AIEnhancementNotificationComponent } from '../components/ai-enhancement-notification.component';
import { GlobalToastComponent } from '../components/global-toast.component';

@Component({
  selector: 'wb-layout',
  standalone: true,
  imports: [RouterModule, RouterOutlet, ToolbarModule, ButtonModule, EnhancedSearchComponent, ThemeToggleComponent, HamburgerMenuComponent, AIEnhancementNotificationComponent, GlobalToastComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
})
export class LayoutComponent {
  year = new Date().getFullYear();

  getLogoPath(): string {
    // Use dark logo for both light and dark themes since header now has dark background
    return 'assets/branding/logo-dark.svg';
  }

  getVersionInfo(): { commit: string; buildDate: string } {
    const versionInfo = (window as any).WHIZBANG_VERSION || { commit: 'dev', buildDate: 'local development' };
    
    // If it's local development, return as-is
    if (versionInfo.buildDate === 'local development') {
      return versionInfo;
    }
    
    // Convert UTC time to user's local timezone
    try {
      const utcDate = new Date(versionInfo.buildDate.replace(' UTC', ''));
      const localDate = utcDate.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      return {
        commit: versionInfo.commit,
        buildDate: localDate
      };
    } catch (error) {
      // Fallback to original if parsing fails
      return versionInfo;
    }
  }
}
