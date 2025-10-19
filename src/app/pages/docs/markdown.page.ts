import { Component, inject, signal, OnInit, ViewChild, ViewContainerRef, EnvironmentInjector, ComponentRef, AfterViewInit, effect, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MarkdownModule } from 'ngx-markdown';
import { HttpClient } from '@angular/common/http';
import { WbVideoComponent } from '../../components/wb-video.component';
import { WbExampleComponent } from '../../components/wb-example.component';
import { CommonModule } from '@angular/common';
import { EnhancedCodeBlockV2Component } from '../../components/enhanced-code-block-v2.component';
import { CodeBlockParser } from '../../services/code-block-parser.service';
import { MermaidService } from '../../services/mermaid.service';
import { ThemeService } from '../../services/theme.service';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  standalone: true,
  imports: [MarkdownModule, WbVideoComponent, WbExampleComponent, CommonModule],
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
export class MarkdownPage implements OnInit, AfterViewInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private codeBlockParser = inject(CodeBlockParser);
  private injector = inject(EnvironmentInjector);
  private mermaidService = inject(MermaidService);
  private themeService = inject(ThemeService);

  @ViewChild('codeBlockContainer', { read: ViewContainerRef }) codeBlockContainer!: ViewContainerRef;

  processedContent = signal('');
  videos = signal<string[]>([]);
  examples = signal<string[]>([]);
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
    this.route.url.subscribe(segments => {
      // Reset content ready state when navigating to new page
      this.isContentReady.set(false);
      const fullPath = segments.map(segment => segment.path).join('/');
      this.loadMarkdownContent(`assets/docs/${fullPath}.md`);
    });
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
            // Render the mermaid diagram
            const id = `mermaid-diagram-${i}`;
            const { svg } = await this.mermaidService.renderDiagram(id, code);

            // Create container
            const container = document.createElement('div');
            container.className = 'mermaid-diagram';
            container.innerHTML = svg;

            // Replace comment with diagram
            if (commentNode.parentNode) {
              commentNode.parentNode.replaceChild(container, commentNode);
            }

            // Apply node classes to edges after SVG is in DOM
            const svgElement = container.querySelector('svg');
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
}
