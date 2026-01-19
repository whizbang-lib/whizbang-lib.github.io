import { Injectable } from '@angular/core';
import { MarkedRenderer } from 'ngx-markdown';

@Injectable({
  providedIn: 'root'
})
export class CustomMarkdownRendererService {
  
  /**
   * Create a custom renderer that adds interactive headers
   */
  createRenderer(): MarkedRenderer {
    const renderer = new MarkedRenderer();
    
    // Override heading renderer to add interactive header functionality
    renderer.heading = (text: string, level: number, raw: string): string => {
      // Extract explicit ID if present: "Header Text {#custom-id}"
      const idMatch = text.match(/^(.*?)\s*\{#([^}]+)\}$/);
      const headerText = idMatch ? idMatch[1].trim() : text;
      const explicitId = idMatch ? idMatch[2] : null;
      
      // Generate slug if no explicit ID
      const slug = explicitId || this.generateSlug(headerText);
      
      // Create interactive header with hover link icon
      return `
        <h${level} id="${slug}" class="doc-header">
          <span class="header-text">${headerText}</span>
          <button class="header-link-btn" 
                  title="Copy link to this section"
                  aria-label="Copy link to ${headerText} section"
                  onclick="copyHeaderLink('#${slug}')">
            <i class="pi pi-link" aria-hidden="true"></i>
          </button>
        </h${level}>
      `;
    };
    
    return renderer;
  }
  
  /**
   * Generate kebab-case slug from text
   */
  private generateSlug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'header';
  }
}