import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class ScrollSpyService implements OnDestroy {
  private observer: IntersectionObserver | null = null;
  private headings: Element[] = [];
  private activeHeading: string | null = null;

  constructor(private router: Router) {}

  initializeScrollSpy() {
    // Clean up existing observer
    this.cleanup();

    // Wait for DOM to be ready
    setTimeout(() => {
      this.setupObserver();
    }, 100);
  }

  private setupObserver() {
    // Find all headings in the markdown content
    this.headings = Array.from(document.querySelectorAll('markdown h1, markdown h2, markdown h3, markdown h4, markdown h5, markdown h6'));
    
    if (this.headings.length === 0) {
      return;
    }

    // Add IDs to headings if they don't have them and add copy link functionality
    this.headings.forEach((heading, index) => {
      if (!heading.id) {
        // Generate ID from heading text
        const text = heading.textContent || '';
        const id = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '') // Remove special characters
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .trim();
        heading.id = id || `heading-${index}`;
      }
      
      // Add copy link functionality
      this.addCopyLinkToHeading(heading as HTMLElement);
    });

    // Create intersection observer
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.updateActiveHeading(entry.target.id);
          }
        });
      },
      {
        rootMargin: '-20% 0px -80% 0px', // Trigger when heading is in top 20% of viewport
        threshold: 0
      }
    );

    // Observe all headings
    this.headings.forEach((heading) => {
      this.observer!.observe(heading);
    });

    // Set initial active heading based on current hash
    this.setInitialActiveHeading();
  }

  private setInitialActiveHeading() {
    const hash = window.location.hash.substring(1);
    if (hash) {
      const element = document.getElementById(hash);
      if (element) {
        this.activeHeading = hash;
        // Scroll to the element with offset for fixed header
        setTimeout(() => {
          this.scrollToElementWithOffset(element);
        }, 100);
        return;
      }
    }

    // If no hash or element not found, use first heading
    if (this.headings.length > 0) {
      this.updateActiveHeading(this.headings[0].id);
    }
  }

  private scrollToElementWithOffset(element: Element) {
    const headerHeight = 70; // Fixed header height
    const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
    const offsetPosition = elementPosition - headerHeight - 20; // Extra 20px padding

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }

  private updateActiveHeading(headingId: string) {
    if (this.activeHeading === headingId) {
      return;
    }

    this.activeHeading = headingId;
    
    // Update URL hash without triggering navigation
    const currentUrl = this.router.url.split('#')[0];
    const newUrl = `${currentUrl}#${headingId}`;
    
    // Use replaceState to avoid adding to browser history
    window.history.replaceState(null, '', newUrl);
  }

  private addCopyLinkToHeading(heading: HTMLElement) {
    // Skip if already has copy link
    if (heading.querySelector('.copy-link')) {
      return;
    }

    // Create copy link container
    const copyLink = document.createElement('a');
    copyLink.className = 'copy-link';
    copyLink.href = `#${heading.id}`;
    copyLink.setAttribute('aria-label', 'Copy link to this section');
    copyLink.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.65 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z"/>
      </svg>
    `;

    // Add click handler to copy link
    copyLink.addEventListener('click', (e) => {
      e.preventDefault();
      const fullUrl = `${window.location.origin}${window.location.pathname}#${heading.id}`;
      
      // Update URL hash and scroll to position
      window.history.replaceState(null, '', `#${heading.id}`);
      this.scrollToElementWithOffset(heading);
      
      // Copy to clipboard
      navigator.clipboard.writeText(fullUrl).then(() => {
        // Show temporary feedback
        this.showCopyFeedback(copyLink);
      }).catch(() => {
        // Fallback for older browsers
        this.fallbackCopyText(fullUrl);
        this.showCopyFeedback(copyLink);
      });
    });

    // Add the copy link to the heading as inline content
    heading.appendChild(copyLink);
  }

  private showCopyFeedback(element: HTMLElement) {
    const originalContent = element.innerHTML;
    element.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
      </svg>
    `;
    
    setTimeout(() => {
      element.innerHTML = originalContent;
    }, 1000);
  }

  private fallbackCopyText(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
    
    document.body.removeChild(textArea);
  }

  cleanup() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.headings = [];
    this.activeHeading = null;
  }

  ngOnDestroy() {
    this.cleanup();
  }
}