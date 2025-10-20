import { Component, inject, signal, OnInit, ViewChild, ViewContainerRef, EnvironmentInjector, ComponentRef, AfterViewInit, effect, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MarkdownModule } from 'ngx-markdown';
import { HttpClient } from '@angular/common/http';
import { WbVideoComponent } from '../../components/wb-video.component';
import { WbExampleComponent } from '../../components/wb-example.component';
import { CommonModule } from '@angular/common';
import { EnhancedCodeBlockV2Component } from '../../components/enhanced-code-block-v2.component';
import { CodeBlockParser } from '../../services/code-block-parser.service';
import { MermaidService } from '../../services/mermaid.service';
import { ThemeService } from '../../services/theme.service';
import { SeoService } from '../../services/seo.service';
import { BreadcrumbService } from '../../services/breadcrumb.service';
import { BreadcrumbComponent, BreadcrumbItem } from '../../components/breadcrumb.component';
import { StructuredDataService } from '../../services/structured-data.service';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  standalone: true,
  imports: [MarkdownModule, WbVideoComponent, WbExampleComponent, CommonModule, BreadcrumbComponent],
  template: `
    <div>
      <!-- Loading state with fade-in animation -->
      <div *ngIf="!isContentReady()" 
           class="flex justify-content-center p-4 loading-fade-in"
           [@fadeIn]>
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
      </div>
      
      <!-- Content (hidden until ready) -->
      <div [style.visibility]="isContentReady() ? 'visible' : 'hidden'">
        <!-- Breadcrumb Navigation -->
        <wb-breadcrumb [items]="breadcrumbs()"></wb-breadcrumb>
        
        <markdown [data]="processedContent()"></markdown>
        
        <!-- Dynamic code block components for ALL blocks -->
        <div #codeBlockContainer></div>
        
        <div *ngFor="let video of videos()" class="my-4">
          <wb-video [id]="video"></wb-video>
        </div>
        
        <div *ngFor="let example of examples()" class="my-4">
          <wb-example [id]="example"></wb-example>
        </div>
      </div>
    </div>
  `,
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('500ms 500ms ease-in', style({ opacity: 1 }))
      ])
    ])
  ]
})
export class MarkdownPage implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private codeBlockParser = inject(CodeBlockParser);
  private injector = inject(EnvironmentInjector);
  private mermaidService = inject(MermaidService);
  private themeService = inject(ThemeService);
  private seoService = inject(SeoService);
  private breadcrumbService = inject(BreadcrumbService);
  private structuredDataService = inject(StructuredDataService);

  @ViewChild('codeBlockContainer', { read: ViewContainerRef }) codeBlockContainer!: ViewContainerRef;

  processedContent = signal('');
  videos = signal<string[]>([]);
  examples = signal<string[]>([]);
  breadcrumbs = signal<BreadcrumbItem[]>([]);
  isContentReady = signal(false);

  private allCodeBlocks: any[] = [];
  private codeComponentRefs: ComponentRef<EnhancedCodeBlockV2Component>[] = [];

  constructor() {
    // Listen for theme changes and re-render Mermaid diagrams
    effect(() => {
      const isDark = this.themeService.isDarkTheme();
      // Re-render diagrams when theme changes (if diagrams exist)
      if (this.mermaidBlocks.length > 0) {
        setTimeout(() => this.reRenderMermaidBlocks(), 100);
      }
    });
  }

  ngOnInit() {
    this.route.url.subscribe(async segments => {
      // Reset content ready state when navigating to new page
      this.isContentReady.set(false);
      const fullPath = segments.map(segment => segment.path).join('/');
      
      // Generate breadcrumbs for the current path (add 'docs/' prefix since we're in the docs route)
      const breadcrumbPath = fullPath ? `docs/${fullPath}` : 'docs';
      const breadcrumbItems = await this.breadcrumbService.generateBreadcrumbs(breadcrumbPath);
      this.breadcrumbs.set(breadcrumbItems);
      
      // Add structured data for breadcrumbs
      this.breadcrumbService.addStructuredDataToPage(breadcrumbItems);
      
      this.resolveMarkdownPath(fullPath).then(resolvedPath => {
        this.loadMarkdownContent(resolvedPath);
      });
    });
  }

  private async resolveMarkdownPath(urlPath: string): Promise<string> {
    try {
      // Load the docs index to find the actual file path
      const docsIndex = await this.http.get<any[]>('assets/docs-index.json').toPromise();
      
      // Find the entry that matches the URL path
      const docEntry = docsIndex?.find(doc => doc.slug === urlPath);
      
      if (docEntry) {
        // If we found an entry, construct the path based on the original slug structure
        // For clean index routes, we need to map back to the actual file path
        if (docEntry.slug === urlPath && !urlPath.includes('/')) {
          // This is likely a clean index route, try the folder/filename pattern first
          const expectedPath = `assets/docs/${urlPath}/${urlPath}.md`;
          
          // Check if the file exists by attempting to load it
          try {
            await this.http.get(expectedPath, { responseType: 'text' }).toPromise();
            return expectedPath;
          } catch {
            // If the folder/filename pattern doesn't work, fall back to the direct path
            return `assets/docs/${urlPath}.md`;
          }
        } else {
          // For non-index routes, use the slug as-is
          return `assets/docs/${docEntry.slug}.md`;
        }
      }
      
      // Fallback: use the URL path directly
      return `assets/docs/${urlPath}.md`;
    } catch (error) {
      console.error('Error resolving markdown path:', error);
      // Fallback: use the URL path directly
      return `assets/docs/${urlPath}.md`;
    }
  }
  
  ngAfterViewInit() {
    // Components will be created after markdown content is loaded
  }
  
  private createAllCodeBlocks() {
    // Clear existing components
    this.codeComponentRefs.forEach(ref => ref.destroy());
    this.codeComponentRefs = [];
    
    // Create new components for ALL blocks
    this.allCodeBlocks.forEach(codeBlock => {
      const componentRef = this.codeBlockParser.createCodeBlockComponent(
        codeBlock,
        this.codeBlockContainer,
        this.injector
      );
      
      this.codeComponentRefs.push(componentRef);
    });
    
    // Replace placeholders with actual components
    this.insertComponentsIntoDOM();
  }
  
  private insertComponentsIntoDOM() {
    // Use MutationObserver to wait for markdown content to be rendered
    this.waitForMarkdownRender().then(async () => {
      const markdownElement = document.querySelector('markdown');
      if (!markdownElement) {
        // If no markdown element, still try to render mermaid diagrams
        if (this.allCodeBlocks.length === 0) {
          await this.renderMermaidBlocks();
          this.isContentReady.set(true);
        }
        return;
      }
      
      this.allCodeBlocks.forEach((codeBlock, index) => {
        const placeholder = codeBlock.placeholder;
        
        // Find text nodes containing the placeholder
        const walker = document.createTreeWalker(
          markdownElement,
          NodeFilter.SHOW_TEXT,
          null
        );
        
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent && node.textContent.includes(placeholder)) {
            const componentRef = this.codeComponentRefs[index];
            if (componentRef) {
              // Create a wrapper div for the component
              const wrapper = document.createElement('div');
              wrapper.appendChild(componentRef.location.nativeElement);
              
              // Replace the text node with the component wrapper
              const parentElement = node.parentElement;
              if (parentElement) {
                parentElement.replaceChild(wrapper, node);
                break;
              }
            }
          }
        }
      });

      // All placeholders have been processed, render Mermaid diagrams
      setTimeout(async () => {
        await this.renderMermaidBlocks();
        this.isContentReady.set(true);
      }, 500);
    });
  }

  private waitForMarkdownRender(): Promise<void> {
    return new Promise((resolve) => {
      const markdownElement = document.querySelector('markdown');
      
      // If markdown element already exists and has content, resolve immediately
      if (markdownElement && markdownElement.children.length > 0) {
        resolve();
        return;
      }
      
      // Create a MutationObserver to watch for markdown content changes
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            const markdownEl = document.querySelector('markdown');
            if (markdownEl && markdownEl.children.length > 0) {
              observer.disconnect();
              resolve();
              return;
            }
          }
        }
      });
      
      // Start observing the document body for changes
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      // Fallback timeout to prevent infinite waiting
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000); // 5 second fallback
    });
  }

  private loadMarkdownContent(path: string) {
    this.http.get(path, { responseType: 'text' }).subscribe({
      next: (content) => {
        // Parse ALL code blocks (both enhanced and regular)
        const { processedContent, codeBlocks } = this.codeBlockParser.parseAllCodeBlocks(content);
        this.allCodeBlocks = codeBlocks;

        // Parse the rest of the content (videos, examples)
        const { processedContent: finalContent, videos, examples } = this.parseCustomComponents(processedContent);

        this.processedContent.set(finalContent);
        this.videos.set(videos);
        this.examples.set(examples);
        
        // Set SEO metadata for this page
        this.setSeoMetadata(content, finalContent);
        
        // Generate and add structured data for this page
        this.generateStructuredData(content, finalContent, path);
        
        // Create code block components after content is processed
        if (this.allCodeBlocks.length > 0) {
          setTimeout(() => this.createAllCodeBlocks(), 0);
        } else {
          // No code blocks to process, content is ready immediately
          this.isContentReady.set(true);
        }
      },
      error: (error) => {
        console.error('Failed to load markdown content:', error);
        this.processedContent.set('# Content not found\n\nThe requested page could not be loaded.');
        // Show error content immediately
        this.isContentReady.set(true);
      }
    });
  }

  private mermaidBlocks: {placeholder: string, code: string}[] = [];

  private async renderMermaidBlocks() {
    for (let i = 0; i < this.mermaidBlocks.length; i++) {
      const { placeholder, code } = this.mermaidBlocks[i];

      try {
        // Find the placeholder comment in the DOM
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_COMMENT,
          null
        );

        let commentNode;
        while (commentNode = walker.nextNode()) {
          if (commentNode.textContent === placeholder.replace('<!--', '').replace('-->', '')) {
            // Render the mermaid diagram with alt text
            const id = `mermaid-diagram-${i}`;
            const { svg, altText } = await this.mermaidService.renderDiagram(id, code);

            // Create container
            const container = document.createElement('div');
            container.className = 'mermaid-diagram';
            container.innerHTML = svg;

            // Add accessible alt text to the SVG
            const svgElement = container.querySelector('svg');
            if (svgElement && altText) {
              svgElement.setAttribute('role', 'img');
              svgElement.setAttribute('aria-label', altText);
              // Also add title element for additional accessibility
              const titleElement = document.createElementNS('http://www.w3.org/2000/svg', 'title');
              titleElement.textContent = altText;
              svgElement.insertBefore(titleElement, svgElement.firstChild);
            }

            // Replace comment with diagram
            if (commentNode.parentNode) {
              commentNode.parentNode.replaceChild(container, commentNode);
            }

            // Apply node classes to edges after SVG is in DOM
            if (svgElement) {
              this.mermaidService.applyNodeClassesToEdges(svgElement);
            }
            break;
          }
        }
      } catch (error) {
        console.error('Failed to render mermaid diagram:', error);
      }
    }
  }

  private async reRenderMermaidBlocks() {
    // Find all existing mermaid diagram containers and re-render them
    const containers = document.querySelectorAll('.mermaid-diagram');

    for (let i = 0; i < Math.min(containers.length, this.mermaidBlocks.length); i++) {
      const container = containers[i];
      const { code } = this.mermaidBlocks[i];

      try {
        // Re-render the diagram with new theme
        const id = `mermaid-diagram-${i}-rerender-${Date.now()}`;
        const { svg } = await this.mermaidService.renderDiagram(id, code);

        // Update container content
        container.innerHTML = svg;

        // Apply node classes to edges after SVG is updated
        const svgElement = container.querySelector('svg');
        if (svgElement) {
          this.mermaidService.applyNodeClassesToEdges(svgElement);
        }
      } catch (error) {
        console.error('Failed to re-render mermaid diagram:', error);
      }
    }
  }

  private parseCustomComponents(content: string) {
    const videos: string[] = [];
    const examples: string[] = [];

    // Strip frontmatter if it exists
    let processedContent = content;
    if (content.startsWith('---')) {
      const frontmatterEndIndex = content.indexOf('---', 3);
      if (frontmatterEndIndex !== -1) {
        processedContent = content.substring(frontmatterEndIndex + 3).trim();
      }
    }

    // Extract mermaid blocks BEFORE markdown processing
    this.mermaidBlocks = [];
    const mermaidRegex = /```mermaid\s*\r?\n([\s\S]*?)```/g;
    let mermaidMatch;
    let mermaidIndex = 0;

    while ((mermaidMatch = mermaidRegex.exec(processedContent)) !== null) {
      const mermaidCode = mermaidMatch[1];
      const placeholder = `<!--MERMAID_PLACEHOLDER_${mermaidIndex}-->`;
      this.mermaidBlocks.push({ placeholder, code: mermaidCode });
      processedContent = processedContent.replace(mermaidMatch[0], placeholder);
      mermaidIndex++;
    }
    
    // Extract video IDs
    const videoMatches = processedContent.match(/<wb-video\s+id="([^"]+)"><\/wb-video>/g);
    if (videoMatches) {
      videoMatches.forEach(match => {
        const idMatch = match.match(/id="([^"]+)"/);
        if (idMatch) {
          videos.push(idMatch[1]);
        }
      });
    }
    
    // Extract example IDs
    const exampleMatches = processedContent.match(/<wb-example\s+id="([^"]+)"><\/wb-example>/g);
    if (exampleMatches) {
      exampleMatches.forEach(match => {
        const idMatch = match.match(/id="([^"]+)"/);
        if (idMatch) {
          examples.push(idMatch[1]);
        }
      });
    }
    
    // Remove custom components from content
    processedContent = processedContent
      .replace(/<wb-video[^>]*><\/wb-video>/g, '')
      .replace(/<wb-example[^>]*><\/wb-example>/g, '');
    
    return { processedContent, videos, examples };
  }

  private async setSeoMetadata(originalContent: string, processedContent: string) {
    try {
      // Get current URL path
      const currentUrl = `${window.location.origin}${this.router.url}`;
      const urlPath = this.route.snapshot.url.map(segment => segment.path).join('/');
      
      // Load docs index to get page metadata
      const docsIndex = await this.http.get<any[]>('assets/docs-index.json').toPromise();
      const docEntry = docsIndex?.find(doc => doc.slug === urlPath);
      
      if (docEntry) {
        // Parse frontmatter to get additional metadata
        let frontmatterData: any = {};
        if (originalContent.startsWith('---')) {
          const frontmatterEnd = originalContent.indexOf('---', 3);
          if (frontmatterEnd !== -1) {
            const frontmatterContent = originalContent.substring(3, frontmatterEnd);
            // Simple YAML parsing for our basic fields
            frontmatterData = this.parseFrontmatter(frontmatterContent);
          }
        }
        
        // Use explicit description from frontmatter or docs index, or generate fallback
        let description = docEntry.description || frontmatterData.description;
        if (!description) {
          description = this.seoService.generateFallbackDescription(processedContent);
        }
        
        // Extract keywords from tags
        const tags = frontmatterData.tags || [];
        const keywords = Array.isArray(tags) ? this.seoService.extractKeywordsFromTags(tags) : '';
        
        // Set SEO metadata
        this.seoService.setPageMetadata({
          title: docEntry.title,
          description: description,
          keywords: keywords,
          type: 'article',
          url: currentUrl
        });
      }
    } catch (error) {
      console.error('Error setting SEO metadata:', error);
    }
  }

  private parseFrontmatter(frontmatterContent: string): any {
    const data: any = {};
    const lines = frontmatterContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex > 0) {
          const key = trimmed.substring(0, colonIndex).trim();
          let value = trimmed.substring(colonIndex + 1).trim();
          
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          
          // Handle arrays (simple comma-separated values)
          if (key === 'tags' && value.includes(',')) {
            data[key] = value.split(',').map(tag => tag.trim());
          } else {
            data[key] = value;
          }
        }
      }
    }
    
    return data;
  }

  private async generateStructuredData(originalContent: string, processedContent: string, path: string) {
    try {
      // Get current URL path
      const currentUrl = `${window.location.origin}${this.router.url}`;
      const urlPath = this.route.snapshot.url.map(segment => segment.path).join('/');
      
      // Load docs index to get page metadata
      const docsIndex = await this.http.get<any[]>('assets/docs-index.json').toPromise();
      const docEntry = docsIndex?.find(doc => doc.slug === urlPath);
      
      if (docEntry) {
        // Parse frontmatter to get additional metadata
        let frontmatterData: any = {};
        if (originalContent.startsWith('---')) {
          const frontmatterEnd = originalContent.indexOf('---', 3);
          if (frontmatterEnd !== -1) {
            const frontmatterContent = originalContent.substring(3, frontmatterEnd);
            frontmatterData = this.parseFrontmatter(frontmatterContent);
          }
        }
        
        // Prepare metadata for structured data
        const metadata = {
          title: docEntry.title,
          description: docEntry.description || frontmatterData.description || 'Whizbang .NET library documentation',
          category: docEntry.category || frontmatterData.category || 'Documentation',
          tags: frontmatterData.tags || [],
          order: frontmatterData.order
        };
        
        // Extract code examples from the original content
        const codeExamples = this.structuredDataService.extractCodeExamplesFromContent(originalContent);
        
        // Get current breadcrumbs
        const breadcrumbs = this.breadcrumbs();
        
        // Generate comprehensive structured data
        const structuredData = this.structuredDataService.generateDocumentationStructuredData(
          currentUrl,
          metadata,
          breadcrumbs,
          codeExamples
        );
        
        // Add structured data to page
        this.structuredDataService.addStructuredDataToPage(structuredData, 'documentation');
      }
    } catch (error) {
      console.error('Error generating structured data:', error);
    }
  }

  ngOnDestroy() {
    // Clean up SEO metadata when component is destroyed
    this.seoService.clearPageMetadata();
    
    // Clean up breadcrumb structured data
    this.breadcrumbService.removeStructuredDataFromPage();
    
    // Clean up documentation structured data
    this.structuredDataService.removeStructuredDataFromPage('documentation');
  }
}
