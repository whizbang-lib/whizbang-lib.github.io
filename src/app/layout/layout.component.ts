import { Component, inject, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { Router, NavigationEnd, RouterModule, RouterOutlet } from '@angular/router';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { EnhancedSearchComponent } from '../components/enhanced-search.component';
import { VersionSelectorComponent } from '../components/version-selector.component';
import { ThemeToggleComponent } from '../components/theme-toggle.component';
import { HamburgerMenuComponent } from '../components/hamburger-menu.component';
import { AIEnhancementNotificationComponent } from '../components/ai-enhancement-notification.component';
import { GlobalToastComponent } from '../components/global-toast.component';
import { ThemeService } from '../services/theme.service';
import { Subscription, filter } from 'rxjs';

@Component({
  selector: 'wb-layout',
  standalone: true,
  imports: [RouterModule, RouterOutlet, ToolbarModule, ButtonModule, EnhancedSearchComponent, VersionSelectorComponent, ThemeToggleComponent, HamburgerMenuComponent, AIEnhancementNotificationComponent, GlobalToastComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
})
export class LayoutComponent implements AfterViewInit, OnDestroy {
  private themeService = inject(ThemeService);
  private router = inject(Router);
  private routerSub!: Subscription;

  @ViewChild('globalStarfield') globalStarfield!: ElementRef<HTMLElement>;

  year = new Date().getFullYear();

  getLogoPath(): string {
    return 'assets/branding/logo-dark.svg';
  }

  ngAfterViewInit() {
    this.generateStars();
    this.updateStarfieldVisibility(this.router.url);
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.updateStarfieldVisibility(e.urlAfterRedirects));
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }

  private generateStars() {
    const container = this.globalStarfield?.nativeElement;
    if (!container) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const layers = [
      { count: 120, size: 1, color: 'rgba(255,255,255,0.4)' },
      { count: 60, size: 1.5, color: 'rgba(255,255,255,0.6)' },
      { count: 25, size: 2.5, color: 'rgba(255,255,255,0.8)' },
    ];

    layers.forEach((layer) => {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.pointerEvents = 'none';

      const shadows: string[] = [];
      for (let i = 0; i < layer.count; i++) {
        const x = Math.round(Math.random() * vw);
        const y = Math.round(Math.random() * vh);
        shadows.push(`${x}px ${y}px 0 ${layer.size}px ${layer.color}`);
      }
      el.style.boxShadow = shadows.join(',');
      container.appendChild(el);
    });
  }

  private updateStarfieldVisibility(url: string) {
    const container = this.globalStarfield?.nativeElement;
    if (!container) return;
    // Hide on home page (which has its own animated starfield)
    const isHome = url === '/' || url === '';
    container.style.display = isHome ? 'none' : 'block';
  }
}
