import { Injectable } from '@angular/core';

export interface HeaderInfo {
  level: number;
  text: string;
  slug: string;
  originalText: string;
}

@Injectable({
  providedIn: 'root'
})
export class HeaderProcessorService {
  
  /**
   * Process markdown content to add anchor links to headers
   */
  processHeaders(content: string): { processedContent: string; headers: HeaderInfo[] } {
    const headers: HeaderInfo[] = [];
    const existingIds = new Set<string>();
    
    // Regex to match markdown headers (1-6 levels)
    const headerRegex = /^(#{1,6})\s+(.+?)(\s*\{#([^}]+)\})?$/gm;
    
    const processedContent = content.replace(headerRegex, (match, hashes, headerText, idPart, explicitId) => {
      const level = hashes.length;
      const cleanText = headerText.trim();
      
      // Use explicit ID if provided, otherwise generate slug
      const slug = explicitId || this.generateHeaderSlug(cleanText, existingIds);
      existingIds.add(slug);
      
      // Store header info for table of contents
      headers.push({
        level,
        text: cleanText,
        slug,
        originalText: match
      });
      
      // Return HTML header with interactive link button
      return `<h${level} id="${slug}" class="doc-header">
  <span class="header-text">${cleanText}</span>
  <button class="header-link-btn" 
          title="Copy link to this section"
          aria-label="Copy link to ${cleanText} section"
          onclick="copyHeaderLink('#${slug}')">
    <i class="pi pi-link" aria-hidden="true"></i>
  </button>
</h${level}>`;
    });
    
    return { processedContent, headers };
  }
  
  /**
   * Generate a kebab-case slug from header text
   */
  private generateHeaderSlug(headerText: string, existingIds: Set<string>): string {
    let slug = headerText
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special chars except hyphens
      .replace(/\s+/g, '-')     // Replace spaces with hyphens
      .replace(/-+/g, '-')      // Collapse multiple hyphens
      .replace(/^-|-$/g, '');   // Remove leading/trailing hyphens
    
    // Handle empty slugs
    if (!slug) {
      slug = 'header';
    }
    
    // Handle duplicates: "config", "config-1", "config-2", etc.
    let uniqueSlug = slug;
    let counter = 1;
    while (existingIds.has(uniqueSlug)) {
      uniqueSlug = `${slug}-${counter}`;
      counter++;
    }
    
    return uniqueSlug;
  }
  
  /**
   * Extract table of contents from headers
   */
  generateTableOfContents(headers: HeaderInfo[]): any[] {
    return headers.map(header => ({
      level: header.level,
      text: header.text,
      slug: header.slug,
      anchor: `#${header.slug}`
    }));
  }
}