import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class ScrollManagementService {
  private router = inject(Router);
  private isVersionSwitching = false;
  private versionSwitchHasRouteMatch = false;

  constructor() {
    // Listen to navigation events
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.handleScrollOnNavigation(event);
    });
  }

  /**
   * Mark that the next navigation is a version switch
   * @param hasRouteMatch - true if the target version has a matching route/page
   */
  markVersionSwitching(hasRouteMatch: boolean): void {
    this.isVersionSwitching = true;
    this.versionSwitchHasRouteMatch = hasRouteMatch;
  }

  private handleScrollOnNavigation(event: NavigationEnd): void {
    setTimeout(() => {
      const url = event.url;
      
      if (this.isVersionSwitching) {
        // Version switching behavior
        if (this.versionSwitchHasRouteMatch && url.includes('#')) {
          // Has route match AND anchor - let browser handle scrolling to anchor
          // This preserves both route and anchor position
        } else {
          // No route match OR no anchor - scroll to top
          window.scrollTo(0, 0);
        }
        
        // Reset flags
        this.isVersionSwitching = false;
        this.versionSwitchHasRouteMatch = false;
      } else {
        // Regular navigation - scroll to top unless there's an anchor
        if (url.includes('#')) {
          // Has anchor - let browser handle scrolling to anchor
          // The browser will automatically scroll to the anchor
        } else {
          // No anchor - scroll to top
          window.scrollTo(0, 0);
        }
      }
    }, 0);
  }
}