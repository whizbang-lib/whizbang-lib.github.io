import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  standalone: true,
  selector: 'wb-patterns-page',
  imports: [RouterModule],
  template: `
    <div class="patterns-container">
      <div class="patterns-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .patterns-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0.5rem 1rem 2rem 1rem;
    }

    .patterns-content {
      min-height: 60vh;
      width: 100%;
    }

    @media (max-width: 768px) {
      .patterns-container {
        padding: 0.25rem 0.5rem 1rem 0.5rem;
      }
    }
  `]
})
export class PatternsPage {
  // Navigation is handled by the global hamburger menu
  // This component provides a container for pattern content
}