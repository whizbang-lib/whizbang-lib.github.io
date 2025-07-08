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
    return (window as any).WHIZBANG_VERSION || { commit: 'dev', buildDate: 'local development' };
  }
}
