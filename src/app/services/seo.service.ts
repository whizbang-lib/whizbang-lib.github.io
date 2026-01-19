import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private meta = inject(Meta);
  private titleService = inject(Title);

  setPageMetadata(options: {
    title?: string;
    description?: string;
    keywords?: string;
    type?: string;
    url?: string;
  }) {
    const {
      title,
      description,
      keywords,
      type = 'article',
      url
    } = options;

    // Set page title
    if (title) {
      const fullTitle = `${title} | Whizbang Documentation`;
      this.titleService.setTitle(fullTitle);
      
      // Open Graph title
      this.meta.updateTag({ property: 'og:title', content: title });
      this.meta.updateTag({ name: 'twitter:title', content: title });
    }

    // Set meta description
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:description', content: description });
      this.meta.updateTag({ name: 'twitter:description', content: description });
    }

    // Set keywords
    if (keywords) {
      this.meta.updateTag({ name: 'keywords', content: keywords });
    }

    // Set Open Graph type
    this.meta.updateTag({ property: 'og:type', content: type });

    // Set canonical URL
    if (url) {
      this.meta.updateTag({ property: 'og:url', content: url });
      this.meta.updateTag({ name: 'twitter:url', content: url });
      
      // Remove existing canonical link and add new one
      const existingCanonical = document.querySelector('link[rel="canonical"]');
      if (existingCanonical) {
        existingCanonical.remove();
      }
      
      const link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      link.setAttribute('href', url);
      document.head.appendChild(link);
    }

    // Set Twitter card type
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    
    // Set site-wide Open Graph data
    this.meta.updateTag({ property: 'og:site_name', content: 'Whizbang Documentation' });
    this.meta.updateTag({ name: 'twitter:site', content: '@whizbang_lib' });
  }

  generateFallbackDescription(content: string): string {
    if (!content) return '';

    // Remove markdown syntax and HTML tags
    const cleanContent = content
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links, keep text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();

    // Get first meaningful sentence or paragraph, limit to 155 characters
    const sentences = cleanContent.split(/[.!?]+/);
    let description = sentences[0] || '';
    
    // If first sentence is too short, try to add more
    if (description.length < 100 && sentences.length > 1) {
      description += '. ' + sentences[1];
    }

    // Truncate to SEO-friendly length
    if (description.length > 155) {
      description = description.substring(0, 152) + '...';
    }

    return description;
  }

  extractKeywordsFromTags(tags: string[]): string {
    return tags.join(', ');
  }

  clearPageMetadata() {
    // Reset to default title
    this.titleService.setTitle('Whizbang Documentation');
    
    // Remove page-specific meta tags
    this.meta.removeTag('name="description"');
    this.meta.removeTag('name="keywords"');
    this.meta.removeTag('property="og:title"');
    this.meta.removeTag('property="og:description"');
    this.meta.removeTag('property="og:url"');
    this.meta.removeTag('name="twitter:title"');
    this.meta.removeTag('name="twitter:description"');
    this.meta.removeTag('name="twitter:url"');
    
    // Remove canonical link
    const existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) {
      existingCanonical.remove();
    }
  }
}