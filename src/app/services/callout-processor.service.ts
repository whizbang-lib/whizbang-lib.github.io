import { Injectable } from '@angular/core';

export interface CalloutInfo {
  type: 'new' | 'updated' | 'deprecated' | 'planned';
  content: string;
  attributes: Record<string, string>;
  isBreaking?: boolean;
  plannedVersion?: string;
  plannedHeader?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CalloutProcessorService {
  
  /**
   * Process markdown content to convert callout syntax to HTML
   */
  processCallouts(content: string): { processedContent: string; callouts: CalloutInfo[] } {
    const callouts: CalloutInfo[] = [];
    
    // Regex to match callout blocks: :::type{attributes} ... :::
    const calloutRegex = /:::(\w+)(\{[^}]*\})?\s*\n([\s\S]*?)(?=\n:::(?:\s|$)|\n\n|$)/g;
    
    const processedContent = content.replace(calloutRegex, (match, type, attributesStr, calloutContent) => {
      const attributes: Record<string, string> = {};
      
      // Parse attributes if present
      if (attributesStr) {
        const attrString = attributesStr.slice(1, -1); // Remove { }
        const attrMatches = attrString.match(/(\w+)="([^"]*)"/g);
        if (attrMatches) {
          attrMatches.forEach((attr: string) => {
            const [key, value] = attr.split('=');
            attributes[key] = value.replace(/"/g, '');
          });
        }
      }
      
      // Create callout info
      const calloutInfo: CalloutInfo = {
        type: type as any,
        content: calloutContent.trim(),
        attributes,
        isBreaking: attributes['type'] === 'breaking',
        plannedVersion: attributes['version'],
        plannedHeader: attributes['header']
      };
      
      callouts.push(calloutInfo);
      
      // Generate HTML for the callout
      return this.generateCalloutHtml(calloutInfo);
    });
    
    return { processedContent, callouts };
  }
  
  /**
   * Generate HTML for a callout
   */
  private generateCalloutHtml(callout: CalloutInfo): string {
    const cssClass = this.getCalloutCssClass(callout);
    const badge = this.getCalloutBadge(callout);
    const linkElement = this.getCalloutLink(callout);
    
    return `
<div class="callout ${cssClass}">
  <div class="callout-header">
    <span class="callout-badge">${badge}</span>
    ${linkElement}
  </div>
  <div class="callout-content">
    ${this.processCalloutContent(callout.content)}
  </div>
</div>`;
  }
  
  /**
   * Get CSS class for callout type
   */
  private getCalloutCssClass(callout: CalloutInfo): string {
    const baseClass = `callout-${callout.type}`;
    
    if (callout.type === 'new' && callout.isBreaking) {
      return `${baseClass} callout-breaking`;
    }
    
    if (callout.type === 'planned' && !callout.plannedVersion) {
      return `${baseClass} callout-placeholder`;
    }
    
    return baseClass;
  }
  
  /**
   * Get badge text for callout
   */
  private getCalloutBadge(callout: CalloutInfo): string {
    switch (callout.type) {
      case 'new':
        return callout.isBreaking ? 'Breaking Change' : 'New';
      case 'updated':
        return 'Updated';
      case 'deprecated':
        return 'Deprecated';
      case 'planned':
        return callout.plannedVersion ? `Planned for ${callout.plannedVersion}` : 'Planned';
      default:
        return (callout.type as string).charAt(0).toUpperCase() + (callout.type as string).slice(1);
    }
  }
  
  /**
   * Get link element for planned callouts
   */
  private getCalloutLink(callout: CalloutInfo): string {
    if (callout.type !== 'planned') {
      return '';
    }
    
    if (callout.plannedVersion && callout.plannedHeader) {
      const url = `/docs/${callout.plannedVersion}/${callout.plannedHeader}`;
      return `<a href="${url}" class="callout-link">View in ${callout.plannedVersion} →</a>`;
    }
    
    return '<span class="callout-placeholder-text">Coming Soon</span>';
  }
  
  /**
   * Process callout content (basic markdown processing)
   */
  private processCalloutContent(content: string): string {
    // Basic markdown processing for callout content
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
}