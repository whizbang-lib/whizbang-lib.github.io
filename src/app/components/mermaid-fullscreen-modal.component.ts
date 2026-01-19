import { Component, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'wb-mermaid-fullscreen-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen()) {
      <div class="modal-overlay" (click)="close()">
        <div class="modal-container" (click)="$event.stopPropagation()">
          <button 
            class="modal-close-btn"
            (click)="close()"
            type="button"
            title="Close (ESC)"
            aria-label="Close fullscreen diagram">
            ×
          </button>
          <div class="diagram-container" [innerHTML]="svgContent()"></div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .modal-container {
      position: relative;
      width: 95vw;
      max-width: 95vw;
      max-height: 95vh;
      background: var(--surface-card);
      border-radius: 0.5rem;
      padding: 2rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease;
      overflow-y: auto;
      overflow-x: hidden;
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }


    .diagram-container {
      width: 100%;
      min-height: 300px;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow: visible;
      padding: 1rem 0;
      position: relative; /* Ensure button can position relative to this */
    }

    /* Make SVG fit the width of the container and be scrollable vertically */
    .diagram-container ::ng-deep svg {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      max-height: none !important;
      min-height: auto !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    
    /* Ensure mermaid diagram container fits properly */
    .diagram-container ::ng-deep .mermaid-diagram {
      display: block !important;
      width: 100% !important;
      height: auto !important;
      position: relative !important;
    }
    
    /* Modal close button */
    .modal-close-btn {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 10002;
      background: rgba(255, 255, 255, 0.95);
      border: 2px solid rgba(255, 255, 255, 0.3);
      color: #000000;
      border-radius: 0.375rem;
      width: 2.5rem;
      height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      font-size: 1.5rem;
      font-weight: bold;
    }
    
    .modal-close-btn:hover {
      background: #ffffff;
      color: #000000;
      border-color: #ffffff;
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    
    .modal-close-btn:active {
      transform: scale(0.95);
    }
    
    .modal-close-btn:focus {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    /* Mobile adjustments */
    @media (max-width: 768px) {
      .modal-container {
        width: 100vw;
        max-width: 100vw;
        max-height: 100vh;
        border-radius: 0;
        padding: 1rem;
      }
      
      .diagram-container {
        padding: 0.5rem 0;
      }
    }

    /* Dark mode specific styles */
    :host-context([data-theme="dark"]) .modal-container {
      background: #1e293b;
      border: 1px solid #334155;
    }
  `]
})
export class MermaidFullscreenModalComponent {
  isOpen = signal(false);
  svgContent = signal<SafeHtml | string>('');
  private sanitizer = inject(DomSanitizer);
  
  constructor() {
    // Apply styles after content is rendered
    effect(() => {
      if (this.isOpen() && this.svgContent()) {
        // Wait for next tick to ensure DOM is updated
        setTimeout(() => {
          const modalContainer = document.querySelector('.diagram-container');
          if (modalContainer) {
            const svgEl = modalContainer.querySelector('svg');
            if (svgEl) {
              this.styleForFullscreen(svgEl as SVGElement);
            }
          }
        }, 0);
      }
    });
  }

  open(svgElement: SVGElement) {
    // Clone and store the SVG HTML
    const clone = svgElement.cloneNode(true) as SVGElement;
    
    // Wrap in a div if it's just an SVG
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-diagram';
    wrapper.appendChild(clone);
    
    // Sanitize and set the content
    this.svgContent.set(this.sanitizer.bypassSecurityTrustHtml(wrapper.outerHTML));
    this.isOpen.set(true);
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    
    // Add ESC key listener
    document.addEventListener('keydown', this.handleEscKey);
  }
  
  styleForFullscreen(svgEl: SVGElement) {
    // Get original viewBox or dimensions
    const viewBox = svgEl.getAttribute('viewBox');
    const origWidth = svgEl.getAttribute('width') || svgEl.style.width;
    const origHeight = svgEl.getAttribute('height') || svgEl.style.height;
    
    // Remove size attributes and set responsive styles
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.display = 'block';
    svgEl.style.width = '100%';
    svgEl.style.height = 'auto';
    svgEl.style.maxWidth = '100%';
    
    // Ensure viewBox is set for proper scaling
    if (!viewBox && origWidth && origHeight) {
      const w = parseInt(origWidth.toString());
      const h = parseInt(origHeight.toString());
      if (!isNaN(w) && !isNaN(h)) {
        svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
    }
    
    // Ensure preserveAspectRatio is set
    if (!svgEl.hasAttribute('preserveAspectRatio')) {
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
  }

  close() {
    this.isOpen.set(false);
    this.svgContent.set('');
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    // Remove ESC key listener
    document.removeEventListener('keydown', this.handleEscKey);
  }

  private handleEscKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.close();
    }
  }
}