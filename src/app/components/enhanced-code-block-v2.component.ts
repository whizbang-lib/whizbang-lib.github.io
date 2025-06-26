import { Component, Input, ViewChild, ElementRef, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectorRef, ChangeDetectionStrategy, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ChipModule } from 'primeng/chip';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { DialogModule } from 'primeng/dialog';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { ThemeService } from '../services/theme.service';
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';

interface CodeBlockOptions {
  title?: string;
  language?: string;
  filename?: string;
  githubUrl?: string;
  docsUrl?: string;
  nugetPackage?: string;
  nugetPackages?: string[];
  description?: string;
  tags?: string[];
  category?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  collapsible?: boolean;
  showCopyButton?: boolean;
  showDownloadButton?: boolean;
  // New collapsible options
  showLinesOnly?: number[];
  framework?: string;
  difficulty?: string;
  usingStatements?: string[];
}

@Component({
  standalone: true,
  imports: [CommonModule, ButtonModule, TooltipModule, ChipModule, OverlayPanelModule, DialogModule],
  selector: 'wb-enhanced-code-v2',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('collapseAnimation', [
      state('expanded', style({ height: '*', opacity: 1 })),
      state('collapsed', style({ height: '200px', opacity: 0.9 })),
      transition('expanded <=> collapsed', animate('300ms ease-in-out'))
    ]),
    trigger('buttonAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.8)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ])
    ])
  ],
  template: `
    <div class="enhanced-code-block" 
         [class.collapsible]="isCollapsible" 
         [class.collapsed]="collapsed">
      
      <!-- Header with metadata -->
      <div class="code-header" *ngIf="hasHeader()">
        <div class="code-info">
          <h4 *ngIf="options.title" class="code-title">{{ options.title }}</h4>
          
          <div class="metadata-row" *ngIf="hasMetadata()">
            <span *ngIf="options.filename" class="filename">
              <i class="pi pi-file"></i>
              {{ options.filename }}
            </span>
            
            <p-chip 
              *ngIf="options.language" 
              [label]="options.language" 
              [style]="{'background-color': getLanguageColor()}"
              class="language-chip">
            </p-chip>
            
            <p-chip 
              *ngIf="options.framework"
              [label]="options.framework"
              class="framework-chip">
            </p-chip>
            
            <p-chip 
              *ngIf="options.difficulty"
              [label]="options.difficulty"
              class="difficulty-chip"
              [attr.data-difficulty]="options.difficulty?.toLowerCase()">
            </p-chip>
            
            <!-- Tags moved inline to save vertical space -->
            <p-chip 
              *ngFor="let tag of options.tags" 
              [label]="tag" 
              class="tag-chip">
            </p-chip>
          </div>
        </div>
        
        <div class="code-actions">
          <!-- Collapse Toggle - Now Icon Only -->
          <button 
            *ngIf="isCollapsible"
            pButton 
            type="button"
            [icon]="collapsed ? 'pi pi-chevron-down' : 'pi pi-chevron-up'" 
            class="p-button-sm p-button-outlined"
            [pTooltip]="collapsed ? 'Show Full Code' : 'Show Less'"
            (click)="toggleCollapse($event)"
            [@buttonAnimation]>
          </button>
          
          <!-- Copy Button -->
          <button 
            *ngIf="options.showCopyButton !== false"
            pButton 
            type="button"
            icon="pi pi-copy" 
            class="p-button-sm p-button-text" 
            pTooltip="Copy code"
            (click)="copyCode($event)"
            [disabled]="copying">
            <span *ngIf="copying">Copied!</span>
          </button>
          
          <!-- Copy with Usings Button -->
          <button 
            *ngIf="options.showCopyButton !== false && options.usingStatements && options.usingStatements.length > 0"
            pButton 
            type="button"
            icon="pi pi-clone" 
            class="p-button-sm p-button-text" 
            pTooltip="Copy code with using statements"
            (click)="copyCodeWithUsings($event)"
            [disabled]="copyingWithUsings">
            <span *ngIf="copyingWithUsings">Copied!</span>
          </button>
          
          <!-- Download Button -->
          <button 
            *ngIf="options.showDownloadButton"
            pButton 
            type="button"
            icon="pi pi-download" 
            class="p-button-sm p-button-text"
            pTooltip="Download file"
            (click)="downloadCode($event)">
          </button>
          
          <!-- GitHub Link -->
          <button 
            *ngIf="options.githubUrl"
            pButton 
            type="button"
            icon="pi pi-github" 
            class="p-button-sm p-button-text"
            pTooltip="View on GitHub"
            (click)="openGitHub($event)">
          </button>
          
          <!-- More Info Toggle -->
          <button 
            *ngIf="hasAdditionalInfo()"
            pButton 
            type="button"
            icon="pi pi-info-circle" 
            class="p-button-sm p-button-text"
            pTooltip="More info"
            (click)="toggleMoreInfo($event)">
          </button>
        </div>
      </div>
      
      <!-- Code Content with Animation -->
      <div class="code-container" 
           [class.collapsed]="collapsed"
           [@collapseAnimation]="collapsed ? 'collapsed' : 'expanded'"
           *ngIf="true">
        
        <!-- Line Numbers (if enabled) -->
        <div class="line-numbers" 
             *ngIf="options.showLineNumbers && displayLineNumbers.length > 0">
          <span 
            *ngFor="let lineNum of displayLineNumbers; trackBy: trackByLineNumber"
            class="line-number"
            [class.gap-indicator]="lineNum === '⋯'"
            [class.highlighted-line-number]="isHighlightedLineNumber(lineNum)">
            {{ getDisplayLineNumber(lineNum) }}
          </span>
        </div>
        
        <!-- Code Content -->
        <div class="code-content">
          <pre class="code-pre">
            <div 
              #codeEl
              class="code-display"
              [class.language-csharp]="(options.language || 'csharp') === 'csharp'"
              [class.language-typescript]="options.language === 'typescript'"
              [class.language-javascript]="options.language === 'javascript'"
              [innerHTML]="displayContent">
            </div>
          </pre>
        </div>
      </div>
      
      <!-- More Info Content - Desktop Toggle View -->
      <div class="more-info-content" 
           *ngIf="showMoreInfo && !isMobileView()" 
           [@collapseAnimation]="showMoreInfo ? 'expanded' : 'collapsed'">
        
        <!-- Filename -->
        <div class="code-filename" *ngIf="options.filename">
          <div class="metadata-item">
            <strong>File:</strong> 
            <span class="filename-value">
              <i class="pi pi-file"></i>
              {{ options.filename }}
            </span>
          </div>
        </div>
        
        <!-- Description -->
        <div class="code-description" *ngIf="options.description">
          <p>{{ options.description }}</p>
        </div>
        
        <!-- Additional Metadata -->
        <div class="code-metadata" *ngIf="hasAdditionalMetadata()">
          <div class="metadata-item" *ngIf="options.category">
            <strong>Category:</strong> {{ options.category }}
          </div>
          
          <div class="metadata-item" *ngIf="options.nugetPackages && options.nugetPackages.length > 0">
            <strong>NuGet Packages:</strong> 
            <span class="nuget-packages-list">
              {{ options.nugetPackages.join(', ') }}
            </span>
            <button 
              pButton 
              icon="pi pi-download" 
              class="p-button-sm p-button-text install-deps-btn"
              (click)="showAllNugetCommands($event)"
              pTooltip="Show install commands for all dependencies">
            </button>
          </div>
          
          <div class="metadata-links" *ngIf="options.githubUrl || options.docsUrl">
            <a *ngIf="options.githubUrl" 
               [href]="options.githubUrl" 
               target="_blank" 
               class="metadata-link github-link">
              <i class="pi pi-github"></i>
              GitHub
            </a>
            
            <a *ngIf="options.docsUrl" 
               [href]="options.docsUrl" 
               target="_blank" 
               class="metadata-link docs-link">
              <i class="pi pi-file"></i>
              Documentation
            </a>
          </div>
        </div>
      </div>
      
      <!-- Mobile Modal Dialog -->
      <p-dialog 
        [visible]="showMoreInfo && isMobileView()" 
        (visibleChange)="onModalVisibleChange($event)"
        modal="true" 
        header="Additional Information" 
        [closable]="true" 
        [draggable]="false" 
        [resizable]="false"
        [dismissableMask]="true"
        [closeOnEscape]="true"
        styleClass="mobile-info-dialog"
        [style]="{width: '90vw', 'max-width': '400px'}">
        
        <!-- Filename -->
        <div class="dialog-filename" *ngIf="options.filename">
          <h6>File</h6>
          <p class="filename-display">
            <i class="pi pi-file"></i>
            {{ options.filename }}
          </p>
        </div>
        
        <!-- Description -->
        <div class="dialog-description" *ngIf="options.description">
          <h6>Description</h6>
          <p>{{ options.description }}</p>
        </div>
        
        <!-- Additional Metadata -->
        <div class="dialog-metadata" *ngIf="hasAdditionalMetadata()">
          <div class="dialog-metadata-item" *ngIf="options.category">
            <strong>Category:</strong> {{ options.category }}
          </div>
          
          <div class="dialog-metadata-item" *ngIf="options.nugetPackages && options.nugetPackages.length > 0">
            <strong>NuGet Packages:</strong>
            <ul class="nuget-list">
              <li *ngFor="let pkg of options.nugetPackages">{{ pkg }}</li>
            </ul>
            <button 
              pButton 
              icon="pi pi-download" 
              label="Show Install Commands"
              class="p-button-sm p-button-outlined"
              (click)="showAllNugetCommands($event)">
            </button>
          </div>
          
          <div class="dialog-links" *ngIf="options.githubUrl || options.docsUrl">
            <h6>Links</h6>
            <div class="dialog-link-buttons">
              <button 
                *ngIf="options.githubUrl"
                pButton 
                icon="pi pi-github" 
                label="GitHub"
                class="p-button-sm p-button-outlined"
                (click)="openGitHub($event)">
              </button>
              
              <button 
                *ngIf="options.docsUrl"
                pButton 
                icon="pi pi-file" 
                label="Documentation"
                class="p-button-sm p-button-outlined"
                (click)="openDocsUrl($event)">
              </button>
            </div>
          </div>
        </div>
      </p-dialog>
      
      <!-- Loading state -->
      <div class="code-loading" *ngIf="!isContentReady">
        <div class="loading-placeholder">
          <i class="pi pi-spin pi-spinner"></i>
          <span>Loading code...</span>
        </div>
      </div>
      
      
      <!-- Description Panel -->
      <p-overlayPanel #infoPanel>
        <div class="info-panel">
          <h5 *ngIf="options.description">Description</h5>
          <p *ngIf="options.description">{{ options.description }}</p>
          
          <h5 *ngIf="options.nugetPackage">NuGet Package</h5>
          <div *ngIf="options.nugetPackage" class="nuget-info">
            <code>{{ options.nugetPackage }}</code>
            <button 
              pButton 
              icon="pi pi-copy" 
              class="p-button-sm p-button-text"
              (click)="copyNugetCommand()"
              pTooltip="Copy install command">
            </button>
          </div>
        </div>
      </p-overlayPanel>
      
      <!-- NuGet Commands Panel -->
      <p-overlayPanel #nugetPanel [dismissable]="true">
        <div class="nuget-commands-panel">
          <h5>Install Dependencies</h5>
          
          <div class="command-section">
            <h6>.NET CLI</h6>
            <div class="command-box">
              <code>{{ getAllDotnetCommands() }}</code>
              <button 
                pButton 
                icon="pi pi-copy" 
                class="p-button-sm p-button-text"
                (click)="copyAllDotnetCommands()"
                pTooltip="Copy .NET CLI command">
              </button>
            </div>
          </div>
          
          <div class="command-section">
            <h6>Package Manager Console</h6>
            <div class="command-box">
              <code>{{ getAllPowerShellCommands() }}</code>
              <button 
                pButton 
                icon="pi pi-copy" 
                class="p-button-sm p-button-text"
                (click)="copyAllPowerShellCommands()"
                pTooltip="Copy PowerShell command">
              </button>
            </div>
          </div>
          
          <div class="command-section">
            <h6>PackageReference</h6>
            <div class="command-box">
              <code>{{ getAllPackageReferences() }}</code>
              <button 
                pButton 
                icon="pi pi-copy" 
                class="p-button-sm p-button-text"
                (click)="copyAllXmlReferences()"
                pTooltip="Copy all PackageReference tags">
              </button>
            </div>
          </div>
        </div>
      </p-overlayPanel>
    </div>
  `,
  styleUrls: ['./enhanced-code-block-v2.component.scss']
})
export class EnhancedCodeBlockV2Component implements OnInit, OnDestroy, OnChanges, AfterViewInit {
  @Input() code = '';
  @Input() options: CodeBlockOptions = {};
  @ViewChild('codeEl', { static: false }) codeEl!: ElementRef<HTMLElement>;
  @ViewChild('infoPanel') infoPanel: any;
  @ViewChild('nugetPanel') nugetPanel: any;
  
  // Reactive state
  highlightedContent = '';
  displayContent = '';
  displayLineNumbers: (number | string)[] = [];
  copying = false;
  copyingWithUsings = false;
  collapsed = false;
  hiddenLinesCount = 0;
  isContentReady = true;
  showMoreInfo = false;
  
  // Computed properties
  get isCollapsible(): boolean {
    const result = !!(this.options.showLinesOnly && this.options.showLinesOnly.length > 0);
    return result;
  }
  
  private allLines: string[] = [];
  private originalLineNumbers: number[] = [];
  
  private readonly themeService = inject(ThemeService);
  
  constructor(private cdr: ChangeDetectorRef) {
    // Register languages with highlight.js if not already registered
    if (!hljs.getLanguage('csharp')) {
      hljs.registerLanguage('csharp', csharp);
    }
    if (!hljs.getLanguage('typescript')) {
      hljs.registerLanguage('typescript', typescript);
    }
    if (!hljs.getLanguage('javascript')) {
      hljs.registerLanguage('javascript', javascript);
    }
    if (!hljs.getLanguage('json')) {
      hljs.registerLanguage('json', json);
    }
    if (!hljs.getLanguage('bash')) {
      hljs.registerLanguage('bash', bash);
    }
    if (!hljs.getLanguage('sql')) {
      hljs.registerLanguage('sql', sql);
    }
    if (!hljs.getLanguage('xml')) {
      hljs.registerLanguage('xml', xml);
    }
  }
  
  ngOnInit() {
    // Process code and make content ready immediately
    this.processCode();
    this.collapsed = this.isCollapsible;
    this.updateDisplay();
    this.isContentReady = true;
    // Force change detection to ensure loading state updates
    this.cdr.detectChanges();
  }
  
  ngAfterViewInit() {
    // Ensure change detection runs
    this.cdr.markForCheck();
    
    // Add click listeners for expand gaps
    this.setupExpandListeners();
  }
  
  private setupExpandListeners() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      if (this.codeEl?.nativeElement) {
        this.codeEl.nativeElement.addEventListener('click', (event: Event) => {
          const target = event.target as HTMLElement;
          if (target?.classList.contains('expand-gap')) {
            event.preventDefault();
            event.stopPropagation();
            this.expandSection();
          }
        });
      }
    }, 0);
  }
  
  ngOnChanges(changes: SimpleChanges) {
    if (changes['code'] || changes['options']) {
      this.processCode();
      this.collapsed = this.isCollapsible;
      this.updateDisplay();
      this.isContentReady = true;
      this.cdr.markForCheck();
      
      // Re-setup listeners after content changes
      setTimeout(() => this.setupExpandListeners(), 0);
    }
  }
  
  ngOnDestroy() {
    // Clean up any timers
  }
  
  
  private processCode() {
    // Split code into lines and clean up
    this.allLines = this.code.split('\n');
    
    // Remove trailing empty lines (consistent with directive behavior)
    while (this.allLines.length > 0 && this.allLines[this.allLines.length - 1].trim() === '') {
      this.allLines.pop();
    }
    
    if (this.allLines.length === 0) {
      this.allLines = [''];
    }
    
    // Create line number mapping
    this.originalLineNumbers = this.allLines.map((_, index) => index + 1);
    
    // Apply syntax highlighting to full content
    this.highlightedContent = this.applyHighlighting(this.allLines.join('\n'));
  }
  
  private updateDisplay() {
    if (this.isCollapsible && this.collapsed && this.options.showLinesOnly) {
      this.updateCollapsedDisplay();
    } else {
      this.updateExpandedDisplay();
    }
    
    // Force change detection to ensure smooth updates
    this.cdr.detectChanges();
    
    // Re-setup expand listeners after display updates
    setTimeout(() => this.setupExpandListeners(), 0);
  }
  
  private updateCollapsedDisplay() {
    const showLines = this.options.showLinesOnly!;
    const visibleLines: string[] = [];
    const visibleLineNumbers: (number | string)[] = [];
    let lastShownLine = 0;
    
    for (const lineNum of showLines.sort((a, b) => a - b)) {
      if (lineNum >= 1 && lineNum <= this.allLines.length) {
        // Add gap indicator if there's a jump
        if (lastShownLine > 0 && lineNum > lastShownLine + 1) {
          const hiddenCount = lineNum - lastShownLine - 1;
          visibleLines.push(`<span class="expand-gap" data-expand="true">⋯ ${hiddenCount} hidden lines (click to expand)</span>`);
          visibleLineNumbers.push('⋯');
        }
        
        // Just add the line content - highlighting will be applied after syntax highlighting
        visibleLines.push(this.allLines[lineNum - 1]);
        
        // Mark line number as highlighted if this line should be highlighted
        if (this.options.highlightLines?.includes(lineNum)) {
          visibleLineNumbers.push(`highlighted-${lineNum}`);
        } else {
          visibleLineNumbers.push(lineNum);
        }
        lastShownLine = lineNum;
      }
    }
    
    // Add final gap if needed
    if (lastShownLine < this.allLines.length) {
      const hiddenCount = this.allLines.length - lastShownLine;
      visibleLines.push(`<span class="expand-gap" data-expand="true">⋯ ${hiddenCount} hidden lines (click to expand)</span>`);
      visibleLineNumbers.push('⋯');
    }
    
    // Separate expand gaps from code lines
    const processedLines: string[] = [];
    const codeLines: string[] = [];
    const lineMapping: { index: number; isGap: boolean; originalLineNum?: number }[] = [];
    const showLinesArray = showLines.sort((a, b) => a - b);
    let codeLineIndex = 0;
    
    visibleLines.forEach((line, index) => {
      if (line.includes('expand-gap')) {
        // Keep expand gaps as-is
        processedLines.push(line);
        lineMapping.push({ index, isGap: true });
      } else {
        // Apply syntax highlighting to code lines only
        const highlightedLine = this.applyHighlighting(line);
        codeLines.push(highlightedLine);
        
        // Check if this line should be highlighted
        const originalLineNum = showLinesArray[codeLineIndex];
        let finalLine = highlightedLine;
        
        if (this.options.highlightLines?.includes(originalLineNum)) {
          finalLine = `<span class="highlighted-line">${highlightedLine}</span>`;
        }
        
        processedLines.push(finalLine);
        lineMapping.push({ index, isGap: false, originalLineNum });
        codeLineIndex++;
      }
    });
    
    this.displayContent = processedLines.join('\n');
    this.displayLineNumbers = this.options.showLineNumbers ? visibleLineNumbers : [];
    this.hiddenLinesCount = this.allLines.length - showLines.length;
  }
  
  private updateExpandedDisplay() {
    // Apply syntax highlighting first
    this.displayContent = this.highlightedContent;
    
    // Apply line highlighting if specified
    if (this.options.highlightLines && this.options.highlightLines.length > 0) {
      const lines = this.displayContent.split('\n');
      
      // Wrap highlighted lines after syntax highlighting
      this.options.highlightLines.forEach(lineNum => {
        const lineIndex = lineNum - 1;
        if (lineIndex >= 0 && lineIndex < lines.length) {
          lines[lineIndex] = `<span class="highlighted-line">${lines[lineIndex]}</span>`;
        }
      });
      
      this.displayContent = lines.join('\n');
      
      // Mark highlighted line numbers
      if (this.options.showLineNumbers) {
        this.displayLineNumbers = this.originalLineNumbers.map(lineNum => {
          return this.options.highlightLines?.includes(lineNum) ? `highlighted-${lineNum}` : lineNum;
        });
      } else {
        this.displayLineNumbers = [];
      }
    } else {
      this.displayLineNumbers = this.options.showLineNumbers ? this.originalLineNumbers : [];
    }
    
    this.hiddenLinesCount = 0;
  }
  
  private applyHighlighting(code: string): string {
    // Apply syntax highlighting based on current theme and language
    const language = this.options.language || 'csharp';
    
    try {
      if (hljs.getLanguage(language)) {
        const result = hljs.highlight(code, { language });
        return result.value;
      }
    } catch (error) {
      console.warn('Failed to highlight code:', error);
    }
    
    // Fallback to plain text
    return this.escapeHtml(code);
  }
  
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  
  // Component interface methods
  hasHeader(): boolean {
    return !!(this.options.title || this.options.filename || this.options.language || 
             this.options.githubUrl || this.options.showCopyButton !== false || this.isCollapsible);
  }
  
  hasMetadata(): boolean {
    return !!(this.options.filename || this.options.language || this.options.framework || this.options.difficulty || (this.options.tags && this.options.tags.length > 0));
  }
  
  hasAdditionalInfo(): boolean {
    return !!(this.options.filename || this.options.description || this.hasAdditionalMetadata());
  }
  
  hasAdditionalMetadata(): boolean {
    return !!(this.options.category || 
             (this.options.nugetPackages && this.options.nugetPackages.length > 0) ||
             this.options.githubUrl || 
             this.options.docsUrl);
  }
  
  getLanguageColor(): string {
    switch (this.options.language?.toLowerCase()) {
      case 'csharp':
      case 'c#':
        return '#512BD4';
      case 'typescript':
        return '#3178C6';
      case 'javascript':
        return '#F7DF1E';
      case 'json':
        return '#292929';
      default:
        return '#6B7280';
    }
  }
  
  getDifficultySeverity(): 'success' | 'info' | 'warning' | 'danger' {
    switch (this.options.difficulty?.toLowerCase()) {
      case 'beginner': return 'success';
      case 'intermediate': return 'info';
      case 'advanced': return 'warning';
      case 'expert': return 'danger';
      default: return 'info';
    }
  }
  
  copyCode(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    if (this.copying) return;
    
    navigator.clipboard.writeText(this.code).then(() => {
      this.copying = true;
      setTimeout(() => {
        this.copying = false;
        this.cdr.detectChanges();
      }, 2000);
    }).catch(err => {
      console.warn('Failed to copy code:', err);
    });
  }
  
  copyCodeWithUsings(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    if (this.copyingWithUsings) return;
    
    // Build the complete code with using statements
    let codeWithUsings = '';
    
    if (this.options.usingStatements && this.options.usingStatements.length > 0) {
      // Add using statements at the top
      codeWithUsings = this.options.usingStatements
        .map(usingStatement => `using ${usingStatement};`)
        .join('\n') + '\n\n';
    }
    
    // Add the original code
    codeWithUsings += this.code;
    
    navigator.clipboard.writeText(codeWithUsings).then(() => {
      this.copyingWithUsings = true;
      setTimeout(() => {
        this.copyingWithUsings = false;
        this.cdr.detectChanges();
      }, 2000);
    }).catch(err => {
      console.warn('Failed to copy code with usings:', err);
    });
  }
  
  downloadCode(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const filename = this.options.filename || `code.${this.getFileExtension()}`;
    const blob = new Blob([this.code], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }
  
  openGitHub(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    if (this.options.githubUrl) {
      window.open(this.options.githubUrl, '_blank');
    }
  }
  
  copyNugetCommand() {
    if (this.options.nugetPackage) {
      const command = `dotnet add package ${this.options.nugetPackage}`;
      navigator.clipboard.writeText(command);
    }
  }
  
  showAllNugetCommands(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    const target = event.currentTarget || event.target;
    
    if (this.nugetPanel && target) {
      // Ensure we have a valid event target
      setTimeout(() => {
        this.nugetPanel.toggle(event, target);
        this.cdr.detectChanges();
      }, 0);
    }
  }
  
  copyCommand(command: string) {
    navigator.clipboard.writeText(command).then(() => {
      // Could add a toast notification here if desired
      console.log('Command copied:', command);
    }).catch(err => {
      console.warn('Failed to copy command:', err);
    });
  }
  
  copyPackageReference(packageName: string) {
    const reference = `<PackageReference Include="${packageName}" />`;
    this.copyCommand(reference);
  }
  
  copyAllDotnetCommands() {
    const commands = this.options.nugetPackages?.map(pkg => `dotnet add package ${pkg}`).join('\n') || '';
    this.copyCommand(commands);
  }
  
  copyAllPowerShellCommands() {
    const commands = this.options.nugetPackages?.map(pkg => `Install-Package ${pkg}`).join('\n') || '';
    this.copyCommand(commands);
  }
  
  copyAllXmlReferences() {
    const references = this.getAllPackageReferences();
    this.copyCommand(references);
  }
  
  getAllPackageReferences(): string {
    return this.options.nugetPackages?.map(pkg => `<PackageReference Include="${pkg}" />`).join('\n') || '';
  }
  
  getAllDotnetCommands(): string {
    if (!this.options.nugetPackages || this.options.nugetPackages.length === 0) return '';
    
    // For multiple packages, show each on its own line for clarity
    return this.options.nugetPackages.map(pkg => `dotnet add package ${pkg}`).join(' && ');
  }
  
  getAllPowerShellCommands(): string {
    if (!this.options.nugetPackages || this.options.nugetPackages.length === 0) return '';
    
    // For PowerShell, we can install multiple packages in one line
    if (this.options.nugetPackages.length > 1) {
      const packages = this.options.nugetPackages.join(', ');
      return `Install-Package ${packages}`;
    }
    // For single package
    return `Install-Package ${this.options.nugetPackages[0]}`;
  }
  
  toggleCollapse(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    this.collapsed = !this.collapsed;
    this.updateDisplay();
  }

  expandSection(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    // Expand to show all lines
    this.collapsed = false;
    this.updateDisplay();
  }
  
  toggleMoreInfo(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    this.showMoreInfo = !this.showMoreInfo;
    this.cdr.detectChanges();
  }
  
  isMobileView(): boolean {
    if (typeof window === 'undefined') {
      return false; // Server-side rendering fallback
    }
    return window.innerWidth < 768;
  }
  
  openDocsUrl(event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    if (this.options.docsUrl) {
      window.open(this.options.docsUrl, '_blank');
    }
  }
  
  onModalVisibleChange(visible: boolean) {
    this.showMoreInfo = visible;
    this.cdr.detectChanges();
  }
  
  trackByLineNumber(index: number, lineNum: number | string): string {
    return `${index}-${lineNum}`;
  }
  
  isHighlightedLineNumber(lineNum: number | string): boolean {
    if (typeof lineNum === 'string') {
      if (lineNum.startsWith('highlighted-')) {
        return true;
      }
      return false;
    }
    return this.options.highlightLines?.includes(lineNum) || false;
  }
  
  getDisplayLineNumber(lineNum: number | string): string {
    if (typeof lineNum === 'string') {
      if (lineNum.startsWith('highlighted-')) {
        return lineNum.replace('highlighted-', '');
      }
      return lineNum;
    }
    return lineNum.toString();
  }
  
  private getFileExtension(): string {
    switch (this.options.language?.toLowerCase()) {
      case 'csharp':
      case 'c#':
        return 'cs';
      case 'typescript':
        return 'ts';
      case 'javascript':
        return 'js';
      case 'json':
        return 'json';
      default:
        return 'txt';
    }
  }

}
