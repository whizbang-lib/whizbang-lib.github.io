import { Component, inject, signal, OnInit, ViewChild, ViewContainerRef, EnvironmentInjector, ComponentRef, AfterViewInit, effect, OnDestroy, createComponent } from '@angular/core';
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
import { HeaderProcessorService, HeaderInfo } from '../../services/header-processor.service';
import { CalloutProcessorService, CalloutInfo } from '../../services/callout-processor.service';
import { VersionService } from '../../services/version.service';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { trigger, transition, style, animate } from '@angular/animations';
import { TestReferencesPanelComponent } from '../../components/test-references-panel.component';
import { VerifiedMarkerProcessor, VerifiedMarker } from '../../services/verified-marker-processor.service';
import { VerifiedBadgeComponent } from '../../components/verified-badge.component';
import { VerifiedSummaryComponent } from '../../components/verified-summary.component';
import { VerifiedModalComponent } from '../../components/verified-modal.component';

@Component({
  standalone: true,
  imports: [MarkdownModule, WbVideoComponent, WbExampleComponent, CommonModule, BreadcrumbComponent, ToastModule, TestReferencesPanelComponent, VerifiedSummaryComponent, VerifiedModalComponent],
  providers: [MessageService],
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

        <!-- Prominent, collapsible per-method "Verified by tests" summary -->
        <wb-verified-summary [testReferences]="testReferences()"></wb-verified-summary>

        <markdown [data]="processedContent()"></markdown>
        
        <!-- Dynamic code block components for ALL blocks -->
        <div #codeBlockContainer></div>
        
        <div *ngFor="let video of videos()" class="my-4">
          <wb-video [id]="video"></wb-video>
        </div>
        
        <div *ngFor="let example of examples()" class="my-4">
          <wb-example [id]="example"></wb-example>
        </div>

        <!-- Living docs: tests verifying this page, with live CI status -->
        <wb-test-references [testReferences]="testReferences()"></wb-test-references>
      </div>
      
      <!-- Focused modal opened by inline verified-by-tests badges -->
      <wb-verified-modal></wb-verified-modal>

      <!-- Toast notifications -->
      <p-toast></p-toast>
    </div>
  `,
  styles: [`
    :host ::ng-deep .doc-header {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 2rem;
      margin-bottom: 1rem;
      scroll-margin-top: 2rem; /* Account for sticky header */
    }
    
    :host ::ng-deep .header-text {
      flex: 1;
    }
    
    :host ::ng-deep .header-link-btn {
      opacity: 0;
      transition: opacity 0.2s ease;
      background: none;
      border: none;
      color: var(--primary-color);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
    }
    
    :host ::ng-deep .header-link-btn:hover {
      background: var(--surface-hover);
    }
    
    :host ::ng-deep .header-link-btn:focus {
      opacity: 1;
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    
    :host ::ng-deep .doc-header:hover .header-link-btn {
      opacity: 1;
    }
    
    :host ::ng-deep .header-link-btn i {
      font-size: 0.875rem;
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
      :host ::ng-deep .header-link-btn {
        opacity: 1; /* Always show on mobile for touch accessibility */
      }
    }
    
    /* Callout styles */
    :host ::ng-deep .callout {
      margin: 1.5rem 0;
      border-radius: 0.5rem;
      border-left: 4px solid;
      background: var(--surface-card);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    :host ::ng-deep .callout-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: rgba(var(--primary-color-rgb), 0.05);
      border-bottom: 1px solid var(--surface-border);
    }
    
    :host ::ng-deep .callout-content {
      padding: 1rem;
      color: var(--text-color);
      line-height: 1.6;
    }
    
    :host ::ng-deep .callout-badge {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      background: var(--primary-color);
      color: var(--primary-color-text);
    }
    
    :host ::ng-deep .callout-link {
      color: var(--primary-color);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
      transition: color 0.2s ease;
    }
    
    :host ::ng-deep .callout-link:hover {
      color: var(--primary-color-text);
    }
    
    :host ::ng-deep .callout-placeholder-text {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      font-style: italic;
    }
    
    /* Callout type-specific styles */
    :host ::ng-deep .callout-new {
      border-left-color: #10b981; /* Green */
    }
    
    :host ::ng-deep .callout-new .callout-badge {
      background: #10b981;
      color: white;
    }
    
    :host ::ng-deep .callout-updated {
      border-left-color: #3b82f6; /* Blue */
    }
    
    :host ::ng-deep .callout-updated .callout-badge {
      background: #3b82f6;
      color: white;
    }
    
    :host ::ng-deep .callout-breaking {
      border-left-color: #ef4444; /* Red */
    }
    
    :host ::ng-deep .callout-breaking .callout-badge {
      background: #ef4444;
      color: white;
    }
    
    :host ::ng-deep .callout-deprecated {
      border-left-color: #f59e0b; /* Orange */
    }
    
    :host ::ng-deep .callout-deprecated .callout-badge {
      background: #f59e0b;
      color: white;
    }
    
    :host ::ng-deep .callout-planned {
      border-left-color: #8b5cf6; /* Purple */
    }
    
    :host ::ng-deep .callout-planned .callout-badge {
      background: #8b5cf6;
      color: white;
    }
    
    :host ::ng-deep .callout-placeholder {
      opacity: 0.8;
      border-style: dashed;
    }

    /* Mermaid diagram figure: diagram + required caption/tests */
    :host ::ng-deep .mermaid-figure {
      margin: 1.5rem 0;
    }
    :host ::ng-deep .mermaid-figure .mermaid-caption {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
      padding: 0 0.25rem;
      font-size: 0.88rem;
      font-style: italic;
      color: var(--p-text-muted-color, #71717a);
    }
    :host ::ng-deep .mermaid-figure .mermaid-caption-text::before {
      content: "Figure — ";
      font-weight: 600;
      font-style: normal;
      color: var(--p-text-color, inherit);
    }
    :host ::ng-deep .mermaid-figure .mermaid-missing-meta {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: 0.4rem;
      font-size: 0.82rem;
      color: var(--orange-700, #b45309);
      background: color-mix(in srgb, var(--orange-500, #f59e0b) 15%, transparent);
      border: 1px solid color-mix(in srgb, var(--orange-500, #f59e0b) 40%, transparent);
    }
    :host ::ng-deep .mermaid-figure .mermaid-missing-meta code {
      background: color-mix(in srgb, var(--p-text-color, #808080) 10%, transparent);
      padding: 0.05rem 0.3rem;
      border-radius: 0.25rem;
    }
  `],
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
  private headerProcessor = inject(HeaderProcessorService);
  private calloutProcessor = inject(CalloutProcessorService);
  private verifiedMarkerProcessor = inject(VerifiedMarkerProcessor);
  private versionService = inject(VersionService);
  private messageService = inject(MessageService);

  @ViewChild('codeBlockContainer', { read: ViewContainerRef }) codeBlockContainer!: ViewContainerRef;

  processedContent = signal('');
  videos = signal<string[]>([]);
  examples = signal<string[]>([]);
  testReferences = signal<string[]>([]);
  breadcrumbs = signal<BreadcrumbItem[]>([]);
  headers = signal<HeaderInfo[]>([]);
  callouts = signal<CalloutInfo[]>([]);
  isContentReady = signal(false);

  private allCodeBlocks: any[] = [];
  private codeComponentRefs: ComponentRef<EnhancedCodeBlockV2Component>[] = [];
  private verifiedMarkers: VerifiedMarker[] = [];
  private verifiedComponentRefs: ComponentRef<VerifiedBadgeComponent>[] = [];
  private intersectionObserver?: IntersectionObserver;
  private currentActiveHeader?: string;

  constructor() {
    // Listen for theme changes and re-render Mermaid diagrams
    effect(() => {
      const isDark = this.themeService.isDarkTheme();
      // Re-render diagrams when theme changes (if diagrams exist)
      if (this.mermaidBlocks.length > 0) {
        setTimeout(() => this.reRenderMermaidBlocks(), 100);
      }
    });
    
    // Setup global copy function for header links
    if (typeof window !== 'undefined') {
      (window as any).copyHeaderLink = (anchor: string) => {
        this.copyHeaderLink(anchor);
      };
    }
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
      // Get current version from VersionService
      const currentVersion = this.versionService.currentVersion();
      
      // Get docs for current version
      const versionDocs = this.versionService.getCurrentVersionDocs();
      
      // Check if this is a state route (proposals, drafts, etc.) vs version route
      const availableStates = this.versionService.availableStates();
      const isStateRoute = availableStates.some(state => urlPath.startsWith(state.state));
      
      
      let docEntry;
      
      if (isStateRoute) {
        // For state routes, we need to get all docs and filter by state
        const stateName = availableStates.find(state => urlPath.startsWith(state.state))?.state;
        if (stateName) {
          // Get all docs from the versioned index
          const versionedIndex = this.versionService.versionedIndex();
          const allDocs = versionedIndex.flatMap(entry => entry.docs);
          
          // If the URL path is exactly the state name, treat it as the Overview page
          if (urlPath === stateName) {
            // Try to find _folder first for Overview page
            docEntry = allDocs.find((doc: any) => doc.slug === `${stateName}/_folder`);
            
            // If no _folder entry found, create a synthetic entry for the _folder file
            if (!docEntry) {
              docEntry = {
                slug: `${stateName}/_folder`,
                title: `${stateName} Overview`,
                category: 'Overview'
              };
            }
          } else {
            // First try exact match
            docEntry = allDocs.find((doc: any) => doc.slug === urlPath);
            
            // If no exact match, try with /_folder suffix for directory pages
            if (!docEntry) {
              docEntry = allDocs.find((doc: any) => doc.slug === `${urlPath}/_folder`);
            }
          }
        }
      } else {
        // Check if the URL path is exactly a version (Overview page)
        const availableVersions = this.versionService.availableVersions();
        const isVersionOverview = availableVersions.some(v => v.version === urlPath);
        
        if (isVersionOverview) {
          // For version Overview pages, load the _folder.md file
          // Use getDocsForVersionOrState to get docs for the specific version
          const specificVersionDocs = this.versionService.getDocsForVersionOrState(urlPath);
          docEntry = specificVersionDocs.find(doc => doc.slug === `${urlPath}/_folder`);
          
          // If not found in versioned index, create a synthetic entry for the _folder file
          if (!docEntry) {
            docEntry = {
              slug: `${urlPath}/_folder`,
              title: `${urlPath} Overview`,
              category: 'Overview'
            };
          }
        } else {
          // For version routes, extract the actual path after the version prefix
          let actualPath = urlPath;
          if (urlPath.startsWith(`${currentVersion}/`)) {
            actualPath = urlPath.substring(`${currentVersion}/`.length);
          }
          
          // First, try to find exact match with actual path in current version
          docEntry = versionDocs.find(doc => doc.slug === `${currentVersion}/${actualPath}`);
          
          // If no exact match, try finding just by the path part (without version prefix)
          if (!docEntry) {
            docEntry = versionDocs.find(doc => {
              const slugParts = doc.slug.split('/');
              const pathPart = slugParts.slice(1).join('/'); // Remove version prefix
              return pathPart === actualPath;
            });
          }
        }
      }
      
      if (docEntry) {
        // Use the full slug from the index to construct the file path
        const fullSlug = docEntry.slug;
        // Handle path construction differently for state routes vs version routes
        const slugParts = fullSlug.split('/');
        
        if (isStateRoute) {
          // For state routes, use the full slug as-is (no version prefix to remove)
          return `assets/docs/${fullSlug}.md`;
        } else {
          // For version routes, use the existing logic
          const pathPart = slugParts.slice(1).join('/'); // Remove version prefix

          // Compare against the URL with its version prefix stripped — menu links
          // include the version (/docs/v1.0.0/...), and comparing against the
          // raw urlPath made every folder-index page (dispatcher/dispatcher.md
          // collapsed to .../dispatcher) 404 when opened via a versioned link.
          const urlPathNoVersion = urlPath.startsWith(`${currentVersion}/`)
            ? urlPath.substring(`${currentVersion}/`.length)
            : urlPath;

          if (!pathPart.includes('/') || pathPart === urlPathNoVersion) {
            const fileName = slugParts[slugParts.length - 1];
            
            // Try folder/filename pattern first
            const expectedPath = `assets/docs/${fullSlug}/${fileName}.md`;
            
            try {
              await this.http.get(expectedPath, { responseType: 'text' }).toPromise();
              return expectedPath;
            } catch {
              // Fall back to direct path
              return `assets/docs/${fullSlug}.md`;
            }
          } else {
            // For non-index routes, use the slug as-is
            return `assets/docs/${fullSlug}.md`;
          }
        }
      }
      
      // Fallback: menu links carry the version (/docs/v1.0.0/...), so strip it
      // before re-prefixing or the path doubles (v1.0.0/v1.0.0/...). Folder-index
      // pages collapse to their folder slug, so retry <path>/<basename>.md when
      // the direct file is absent.
      return await this.resolveFallbackPath(currentVersion, urlPath);
    } catch (error) {
      console.error('Error resolving markdown path:', error);
      const productionVersion = this.versionService.getProductionVersion();
      return await this.resolveFallbackPath(productionVersion, urlPath);
    }
  }

  private async resolveFallbackPath(version: string, urlPath: string): Promise<string> {
    const cleanPath = urlPath.startsWith(`${version}/`)
      ? urlPath.substring(`${version}/`.length)
      : urlPath;
    const base = `assets/docs/${version}/${cleanPath}`;
    try {
      await this.http.get(`${base}.md`, { responseType: 'text' }).toPromise();
      return `${base}.md`;
    } catch {
      // Folder-index collapse: fundamentals/dispatcher -> dispatcher/dispatcher.md
      const baseName = cleanPath.split('/').pop();
      return `${base}/${baseName}.md`;
    }
  }
  
  ngAfterViewInit() {
    // Components will be created after markdown content is loaded
  }
  
  private createAllCodeBlocks() {
    // Clear existing components
    this.codeComponentRefs.forEach(ref => ref.destroy());
    this.codeComponentRefs = [];
    this.verifiedComponentRefs.forEach(ref => ref.destroy());
    this.verifiedComponentRefs = [];

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
          // Setup scroll spy after content is ready
          setTimeout(() => this.setupScrollSpy(), 100);
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

      // Mount inline verified-by-tests badges from {verified: ...} tokens.
      this.mountVerifiedMarkers(markdownElement);

      // All placeholders have been processed, render Mermaid diagrams
      setTimeout(async () => {
        await this.renderMermaidBlocks();
        this.isContentReady.set(true);
        // Setup scroll spy after content is ready
        setTimeout(() => this.setupScrollSpy(), 100);
      }, 500);
    });
  }

  /**
   * Swap each `[VERIFIED_n]` placeholder for a mounted wb-verified-badge. The
   * placeholder may be embedded mid-text (a sentence, a table cell), so we split
   * the text node around it instead of replacing the whole node. Badges inside
   * table cells render compact to keep dense tables readable.
   */
  private mountVerifiedMarkers(markdownElement: Element) {
    this.verifiedMarkers.forEach((marker) => {
      const walker = document.createTreeWalker(markdownElement, NodeFilter.SHOW_TEXT, null);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? '';
        const at = text.indexOf(marker.placeholder);
        if (at === -1) continue;
        const parent = node.parentElement;
        if (!parent) break;

        const ref = createComponent(VerifiedBadgeComponent, { environmentInjector: this.injector });
        ref.instance.tests = marker.tests;
        if (parent.closest('td, th')) ref.instance.compact = true;
        ref.changeDetectorRef.detectChanges();
        this.verifiedComponentRefs.push(ref);

        // Split: [before][placeholder][after] -> before | <badge> | after
        const after = (node as Text).splitText(at);
        after.textContent = (after.textContent ?? '').slice(marker.placeholder.length);
        parent.insertBefore(ref.location.nativeElement, after);
        break; // placeholder is unique
      }
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
        // Extract testReferences from frontmatter for the living-docs panel
        this.testReferences.set(this.extractFrontmatterList(content, 'testReferences'));

        // Parse ALL code blocks (both enhanced and regular)
        const { processedContent, codeBlocks } = this.codeBlockParser.parseAllCodeBlocks(content);
        this.allCodeBlocks = codeBlocks;

        // Process headers for interactive functionality
        const { processedContent: contentWithHeaders, headers } = this.headerProcessor.processHeaders(processedContent);
        this.headers.set(headers);

        // Process callouts for enhanced documentation
        const { processedContent: contentWithCallouts, callouts } = this.calloutProcessor.processCallouts(contentWithHeaders);
        this.callouts.set(callouts);

        // Replace {verified: Class.Method} tokens with placeholders (mounted as
        // wb-verified-badge after render) — works in prose, tables, captions.
        const { processedContent: contentWithVerified, markers } = this.verifiedMarkerProcessor.process(contentWithCallouts);
        this.verifiedMarkers = markers;

        // Parse the rest of the content (videos, examples)
        const { processedContent: finalContent, videos, examples } = this.parseCustomComponents(contentWithVerified);

        this.processedContent.set(finalContent);
        this.videos.set(videos);
        this.examples.set(examples);
        
        // Set SEO metadata for this page
        this.setSeoMetadata(content, finalContent);
        
        // Generate and add structured data for this page
        this.generateStructuredData(content, finalContent, path);
        
        // Create code block components (and mount verified-badge markers) after
        // content is processed.
        if (this.allCodeBlocks.length > 0 || this.verifiedMarkers.length > 0) {
          setTimeout(() => this.createAllCodeBlocks(), 0);
        } else {
          // No code blocks to process, content is ready immediately
          this.isContentReady.set(true);
          // Setup scroll spy after content is ready
          setTimeout(() => this.setupScrollSpy(), 100);
        }
      },
      error: (error) => {
        console.error('Failed to load markdown content:', error);
        this.processedContent.set('# Content not found\n\nThe requested page could not be loaded.');
        // Show error content immediately
        this.isContentReady.set(true);
        // No need for scroll spy setup on error pages
      }
    });
  }

  private mermaidBlocks: {placeholder: string, code: string, caption?: string, tests?: string[]}[] = [];

  private async renderMermaidBlocks() {
    for (let i = 0; i < this.mermaidBlocks.length; i++) {
      const { placeholder, code, caption, tests } = this.mermaidBlocks[i];

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
            const { svg, altText, isTimeline } = await this.mermaidService.renderDiagram(id, code);

            // Create container
            const container = document.createElement('div');
            container.className = isTimeline ? 'mermaid-diagram timeline-diagram' : 'mermaid-diagram';
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

            // Wrap the diagram in a figure with a required caption + verified badge.
            const figure = document.createElement('figure');
            figure.className = 'mermaid-figure';
            figure.appendChild(container);

            const hasCaption = !!(caption && caption.trim());
            const hasTests = Array.isArray(tests) && tests.length > 0;

            if (hasCaption || hasTests) {
              const figcaption = document.createElement('figcaption');
              figcaption.className = 'mermaid-caption';
              if (hasCaption) {
                const text = document.createElement('span');
                text.className = 'mermaid-caption-text';
                text.textContent = caption!;
                figcaption.appendChild(text);
              }
              if (hasTests) {
                const badge = createComponent(VerifiedBadgeComponent, { environmentInjector: this.injector });
                badge.instance.tests = tests!;
                badge.changeDetectorRef.detectChanges();
                this.verifiedComponentRefs.push(badge);
                figcaption.appendChild(badge.location.nativeElement);
              }
              figure.appendChild(figcaption);
            }

            if (!hasCaption || !hasTests) {
              const missing = [!hasCaption ? 'a caption' : null, !hasTests ? 'tests' : null].filter(Boolean).join(' and ');
              const warn = document.createElement('div');
              warn.className = 'mermaid-missing-meta';
              warn.innerHTML =
                `<i class="pi pi-exclamation-triangle"></i> This diagram is missing ${missing}. ` +
                `Add <code>\`\`\`mermaid{caption="…" tests=["Class.MethodAsync"]}</code>.`;
              figure.appendChild(warn);
            }

            // Replace comment with the figure
            if (commentNode.parentNode) {
              commentNode.parentNode.replaceChild(figure, commentNode);
            }

            // Apply node classes to edges after SVG is in DOM
            if (svgElement) {
              this.mermaidService.applyNodeClassesToEdges(svgElement);
            }

            // Add maximize button to the container
            this.mermaidService.addMaximizeButton(container);
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
        const { svg, isTimeline } = await this.mermaidService.renderDiagram(id, code);

        // Update container class and content
        container.className = isTimeline ? 'mermaid-diagram timeline-diagram' : 'mermaid-diagram';
        container.innerHTML = svg;

        // Apply node classes to edges after SVG is updated
        const svgElement = container.querySelector('svg');
        if (svgElement) {
          this.mermaidService.applyNodeClassesToEdges(svgElement);
        }
        
        // Add maximize button to the container
        this.mermaidService.addMaximizeButton(container as HTMLElement);
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

    // Extract mermaid blocks BEFORE markdown processing.
    // Collect all matches up front: exec() while mutating the scanned string
    // advances lastIndex past unseen content and silently skips every other
    // block on pages with multiple diagrams.
    // A diagram may carry required metadata: ```mermaid{caption="..." tests=[...]}
    this.mermaidBlocks = [];
    const mermaidRegex = /```mermaid(\{[\s\S]*?\})?\s*\r?\n([\s\S]*?)```/g;
    const mermaidMatches = [...processedContent.matchAll(mermaidRegex)];
    mermaidMatches.forEach((match, mermaidIndex) => {
      const placeholder = `<!--MERMAID_PLACEHOLDER_${mermaidIndex}-->`;
      const meta = match[1] ? this.codeBlockParser.parseFenceMetadata(match[1].slice(1, -1)) : {};
      const tests = Array.isArray(meta.tests) ? meta.tests : (meta.tests ? [meta.tests] : []);
      this.mermaidBlocks.push({ placeholder, code: match[2], caption: meta.caption, tests });
      processedContent = processedContent.replace(match[0], placeholder);
    });
    
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
      
      // Load docs for current version to get page metadata
      const currentVersion = this.versionService.currentVersion();
      const versionDocs = this.versionService.getCurrentVersionDocs();
      const docEntry = versionDocs.find(doc => doc.slug === `${currentVersion}/${urlPath}` || doc.slug.endsWith(`/${urlPath}`));
      
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

  /**
   * Extracts a YAML block-list field (e.g. testReferences) from raw
   * frontmatter. parseFrontmatter() is line-based and can't handle lists.
   */
  private extractFrontmatterList(content: string, key: string): string[] {
    if (!content.startsWith('---')) return [];
    const end = content.indexOf('\n---', 3);
    if (end === -1) return [];
    const fm = content.substring(3, end);
    const m = fm.match(new RegExp(`^${key}:\\s*\\n((?:[ \\t]+.+\\n?)+)`, 'm'));
    if (!m) return [];
    // Items are `- value`, or folded scalars `- >-` followed by an indented
    // continuation line (used for long paths).
    const items: string[] = [];
    let pendingFold = false;
    for (const raw of m[1].split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('- ') || line === '-') {
        const value = line.replace(/^-\s*/, '').replace(/^["']|["']$/g, '');
        if (value === '>-' || value === '>' || value === '|') {
          pendingFold = true;
        } else if (value) {
          items.push(value);
          pendingFold = false;
        }
      } else if (pendingFold) {
        items.push(line.replace(/^["']|["']$/g, ''));
        pendingFold = false;
      }
    }
    return items;
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
      
      // Load docs for current version to get page metadata
      const currentVersion = this.versionService.currentVersion();
      const versionDocs = this.versionService.getCurrentVersionDocs();
      const docEntry = versionDocs.find(doc => doc.slug === `${currentVersion}/${urlPath}` || doc.slug.endsWith(`/${urlPath}`));
      
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

  /**
   * Copy header link to clipboard
   */
  copyHeaderLink(anchor: string): void {
    const fullUrl = `${window.location.origin}${window.location.pathname}${anchor}`;
    
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(fullUrl).then(() => {
        this.showCopySuccessMessage();
      }).catch(() => {
        this.fallbackCopyToClipboard(fullUrl);
      });
    } else {
      this.fallbackCopyToClipboard(fullUrl);
    }
  }

  /**
   * Fallback copy method for older browsers
   */
  private fallbackCopyToClipboard(text: string): void {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
      document.execCommand('copy');
      this.showCopySuccessMessage();
    } catch (err) {
      console.error('Failed to copy text:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Unable to copy link to clipboard',
        life: 3000
      });
    } finally {
      document.body.removeChild(textArea);
    }
  }

  /**
   * Show success message for copied link
   */
  private showCopySuccessMessage(): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Link Copied',
      detail: 'Section link copied to clipboard',
      life: 2000
    });
  }

  /**
   * Setup scroll spy to update URL with current header anchor
   */
  private setupScrollSpy(): void {
    // Clean up existing observer
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    // Only setup scroll spy if we have headers
    const headerElements = document.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
    if (headerElements.length === 0) return;

    // Create intersection observer to watch headers
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        // Find all visible headers
        const visibleHeaders = entries
          .filter(entry => entry.isIntersecting)
          .map(entry => ({
            id: entry.target.id,
            top: entry.boundingClientRect.top,
            element: entry.target as HTMLElement
          }))
          .sort((a, b) => a.top - b.top); // Sort by position on screen

        // Get the header that's most recent in the top half of the viewport
        const viewportHeight = window.innerHeight;
        const topHalfThreshold = viewportHeight / 2;

        let targetHeader = visibleHeaders.find(header => header.top <= topHalfThreshold);
        
        // If no header is in the top half, use the first visible one
        if (!targetHeader && visibleHeaders.length > 0) {
          targetHeader = visibleHeaders[0];
        }

        // Update URL if we have a target header and it's different from current
        if (targetHeader && targetHeader.id !== this.currentActiveHeader) {
          this.currentActiveHeader = targetHeader.id;
          this.updateUrlWithAnchor(targetHeader.id);
        }
      },
      {
        // Trigger when headers cross the top half of the viewport
        rootMargin: '-25% 0px -50% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1]
      }
    );

    // Observe all header elements
    headerElements.forEach(header => {
      this.intersectionObserver!.observe(header);
    });
  }

  /**
   * Update URL with anchor without triggering navigation
   */
  private updateUrlWithAnchor(anchor: string): void {
    const currentUrl = new URL(window.location.href);
    currentUrl.hash = `#${anchor}`;
    
    // Update URL without triggering navigation
    window.history.replaceState(null, '', currentUrl.toString());
  }

  ngOnDestroy() {
    // Clean up scroll spy observer
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    // Destroy dynamically mounted components
    this.codeComponentRefs.forEach(ref => ref.destroy());
    this.codeComponentRefs = [];
    this.verifiedComponentRefs.forEach(ref => ref.destroy());
    this.verifiedComponentRefs = [];

    // Clean up SEO metadata when component is destroyed
    this.seoService.clearPageMetadata();
    
    // Clean up breadcrumb structured data
    this.breadcrumbService.removeStructuredDataFromPage();
    
    // Clean up documentation structured data
    this.structuredDataService.removeStructuredDataFromPage('documentation');
  }
}
