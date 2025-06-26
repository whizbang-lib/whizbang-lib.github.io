import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  standalone: true,
  selector: 'wb-docs-page',
  imports: [RouterModule],
  template: `
    <div class="docs-container">
      <div class="docs-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .docs-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    .docs-content {
      min-height: 60vh;
      width: 100%;
    }

    @media (max-width: 768px) {
      .docs-container {
        padding: 1rem 0.5rem;
      }
    }
  `]
})
export class DocsPage {
  // Navigation is now handled by the global hamburger menu
  // This component is simplified to just provide a container for docs content
}
