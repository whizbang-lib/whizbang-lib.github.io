import { Injectable, Renderer2, RendererFactory2 } from '@angular/core';
import { SearchService } from './search.service';

@Injectable({
  providedIn: 'root'
})
export class TextHighlightService {
  private renderer: Renderer2;

  constructor(
    private rendererFactory: RendererFactory2,
    private searchService: SearchService
  ) {
    this.renderer = this.rendererFactory.createRenderer(null, null);
  }

  highlightInElement(element: HTMLElement): void {
    this.searchService.getHighlightedTerms().subscribe(terms => {
      if (terms.length === 0) {
        this.removeHighlights(element);
        return;
      }

      this.removeHighlights(element);
      this.addHighlights(element, terms);
    });
  }

  private removeHighlights(element: HTMLElement): void {
    const highlights = element.querySelectorAll('mark.search-highlight');
    highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        parent.replaceChild(
          this.renderer.createText(highlight.textContent || ''),
          highlight
        );
        parent.normalize();
      }
    });
  }

  private addHighlights(element: HTMLElement, terms: string[]): void {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip if parent is already a highlight or is a script/style tag
          const parent = node.parentElement;
          if (!parent || 
              parent.tagName === 'SCRIPT' || 
              parent.tagName === 'STYLE' ||
              parent.classList.contains('search-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes: Text[] = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node as Text);
    }

    textNodes.forEach(textNode => {
      this.highlightTextNode(textNode, terms);
    });
  }

  private highlightTextNode(textNode: Text, terms: string[]): void {
    const text = textNode.textContent || '';
    if (!text.trim()) return;

    let highlightedText = text;
    let hasMatches = false;

    for (const term of terms) {
      const regex = new RegExp(`(${this.escapeRegExp(term)})`, 'gi');
      if (regex.test(highlightedText)) {
        hasMatches = true;
        highlightedText = highlightedText.replace(regex, '<mark class="search-highlight">$1</mark>');
      }
    }

    if (hasMatches) {
      const wrapper = this.renderer.createElement('span');
      wrapper.innerHTML = highlightedText;
      
      const parent = textNode.parentNode;
      if (parent) {
        parent.insertBefore(wrapper, textNode);
        parent.removeChild(textNode);
        
        // Replace wrapper with its children
        while (wrapper.firstChild) {
          parent.insertBefore(wrapper.firstChild, wrapper);
        }
        parent.removeChild(wrapper);
      }
    }
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
