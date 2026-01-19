import { Component, inject } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { EnhancedSearchComponent } from '../components/enhanced-search.component';
import { VersionSelectorComponent } from '../components/version-selector.component';
import { ThemeToggleComponent } from '../components/theme-toggle.component';
import { HamburgerMenuComponent } from '../components/hamburger-menu.component';
import { AIEnhancementNotificationComponent } from '../components/ai-enhancement-notification.component';
import { GlobalToastComponent } from '../components/global-toast.component';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'wb-layout',
  standalone: true,
  imports: [RouterModule, RouterOutlet, ToolbarModule, ButtonModule, EnhancedSearchComponent, VersionSelectorComponent, ThemeToggleComponent, HamburgerMenuComponent, AIEnhancementNotificationComponent, GlobalToastComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
})
export class LayoutComponent {
  private themeService = inject(ThemeService);
  
  year = new Date().getFullYear();

  getLogoPath(): string {
    // Use dark logo for both light and dark themes since header now has dark background
    return 'assets/branding/logo-dark.svg';
  }
}
