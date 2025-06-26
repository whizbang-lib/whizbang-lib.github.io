import { Component, Input, OnInit, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { TabViewModule } from 'primeng/tabview';
import { CardModule } from 'primeng/card';
import { TooltipModule } from 'primeng/tooltip';
import { MenuModule } from 'primeng/menu';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { forkJoin, map } from 'rxjs';

export interface CodeFile {
  filename: string;
  content: string;
  language: string;
  githubUrl?: string;
  description?: string;
}

export interface CodeSampleMetadata {
  id: string;
  title: string;
  description: string;
  files: CodeFile[];
  githubRepo?: string;
  stackblitzUrl?: string;
  codesandboxUrl?: string;
  demoUrl?: string;
  tags?: string[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  framework?: string;
  version?: string;
}

@Component({
  selector: 'wb-advanced-code-sample',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    TabViewModule,
    CardModule,
    TooltipModule,
    MenuModule,
    ProgressSpinnerModule,
    TagModule,
    ChipModule,
    OverlayPanelModule,
    ToastModule
  ],
  providers: [MessageService],
  template: `
    <p-toast></p-toast>
    
    <div class="advanced-code-sample" *ngIf="metadata">
      <!-- Header Section -->
      <div class="code-sample-header">
        <div class="header-content">
          <div class="title-section">
            <h3 class="sample-title">{{ metadata.title }}</h3>
            <p class="sample-description">{{ metadata.description }}</p>
          </div>
          
          <div class="metadata-section">
            <div class="tags" *ngIf="metadata.tags?.length">
              <p-chip 
                *ngFor="let tag of metadata.tags" 
                [label]="tag" 
                styleClass="mr-1 mb-1">
              </p-chip>
            </div>
            
            <div class="difficulty-badge" *ngIf="metadata.difficulty">
              <p-tag 
                [value]="metadata.difficulty" 
                [severity]="getDifficultySeverity(metadata.difficulty)"
                icon="pi pi-star">
              </p-tag>
            </div>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="action-buttons">
          <button 
            pButton 
            type="button" 
            icon="pi pi-external-link" 
            label="StackBlitz"
            class="p-button-outlined p-button-sm"
            *ngIf="metadata.stackblitzUrl"
            (click)="openExternal(metadata.stackblitzUrl!)"
            pTooltip="Open in StackBlitz">
          </button>
          
          <button 
            pButton 
            type="button" 
            icon="pi pi-external-link" 
            label="CodeSandbox"
            class="p-button-outlined p-button-sm"
            *ngIf="metadata.codesandboxUrl"
            (click)="openExternal(metadata.codesandboxUrl!)"
            pTooltip="Open in CodeSandbox">
          </button>
          
          <button 
            pButton 
            type="button" 
            icon="pi pi-github" 
            label="GitHub"
            class="p-button-outlined p-button-sm"
            *ngIf="metadata.githubRepo"
            (click)="openExternal(metadata.githubRepo!)"
            pTooltip="View source on GitHub">
          </button>
          
          <button 
            pButton 
            type="button" 
            icon="pi pi-play" 
            label="Live Demo"
            class="p-button-outlined p-button-sm"
            *ngIf="metadata.demoUrl"
            (click)="openExternal(metadata.demoUrl!)"
            pTooltip="View live demo">
          </button>
          
          <button 
            pButton 
            type="button" 
            icon="pi pi-copy" 
            label="Copy All"
            class="p-button-outlined p-button-sm"
            (click)="copyAllFiles()"
            pTooltip="Copy all files to clipboard">
          </button>
          
          <button 
            pButton 
            type="button" 
            icon="pi pi-download" 
            class="p-button-outlined p-button-sm"
            (click)="downloadZip()"
            pTooltip="Download as ZIP">
          </button>
        </div>
      </div>

      <!-- Code Files Tabs -->
      <div class="code-content">
        <p-tabView 
          #tabView
          [(activeIndex)]="activeTabIndex"
          [scrollable]="true"
          styleClass="code-tabs">
          
          <p-tabPanel 
            *ngFor="let file of metadata.files; let i = index" 
            [header]="file.filename"
            [selected]="i === 0">
            
            <ng-template pTemplate="header">
              <div class="tab-header">
                <i [class]="getFileIcon(file.language)" class="file-icon"></i>
                <span class="filename">{{ file.filename }}</span>
                <span class="language-badge">{{ file.language }}</span>
              </div>
            </ng-template>
            
            <div class="file-container">
              <!-- File Actions -->
              <div class="file-actions">
                <div class="file-info">
                  <span class="file-path">{{ file.filename }}</span>
                  <span class="file-description" *ngIf="file.description">{{ file.description }}</span>
                </div>
                
                <div class="file-buttons">
                  <button 
                    pButton 
                    type="button" 
                    icon="pi pi-copy" 
                    class="p-button-text p-button-sm"
                    (click)="copyFileContent(file)"
                    pTooltip="Copy file content">
                  </button>
                  
                  <button 
                    pButton 
                    type="button" 
                    icon="pi pi-github" 
                    class="p-button-text p-button-sm"
                    *ngIf="file.githubUrl"
                    (click)="openExternal(file.githubUrl!)"
                    pTooltip="View on GitHub">
                  </button>
                  
                  <button 
                    pButton 
                    type="button" 
                    icon="pi pi-download" 
                    class="p-button-text p-button-sm"
                    (click)="downloadFile(file)"
                    pTooltip="Download file">
                  </button>
                </div>
              </div>
              
              <!-- Code Content -->
              <div class="code-wrapper">
                <pre class="code-block" [attr.data-language]="file.language">
                  <code 
                    #codeElement 
                    [innerHTML]="getHighlightedCode(file.content, file.language)"
                    class="language-{{ file.language }}">
                  </code>
                </pre>
                
                <!-- Line Numbers -->
                <div class="line-numbers" *ngIf="showLineNumbers">
                  <div 
                    *ngFor="let line of getLineNumbers(file.content)" 
                    class="line-number">
                    {{ line }}
                  </div>
                </div>
                
                <!-- Copy button overlay -->
                <button 
                  pButton 
                  type="button" 
                  icon="pi pi-copy" 
                  class="copy-overlay-btn"
                  (click)="copyFileContent(file)"
                  pTooltip="Copy to clipboard">
                </button>
              </div>
            </div>
          </p-tabPanel>
        </p-tabView>
      </div>
      
      <!-- Footer with additional info -->
      <div class="code-sample-footer" *ngIf="metadata.framework || metadata.version">
        <div class="framework-info">
          <span *ngIf="metadata.framework" class="framework">
            Framework: <strong>{{ metadata.framework }}</strong>
          </span>
          <span *ngIf="metadata.version" class="version">
            Version: <strong>{{ metadata.version }}</strong>
          </span>
        </div>
        
        <div class="stats">
          <span class="file-count">{{ metadata.files.length }} files</span>
          <span class="total-lines">{{ getTotalLines() }} lines</span>
        </div>
      </div>
    </div>
    
    <!-- Loading State -->
    <div class="loading-container" *ngIf="loading">
      <p-progressSpinner></p-progressSpinner>
      <p>Loading code sample...</p>
    </div>
    
    <!-- Error State -->
    <div class="error-container" *ngIf="error">
      <div class="error-message">
        <i class="pi pi-exclamation-triangle"></i>
        <p>Failed to load code sample: {{ error }}</p>
        <button 
          pButton 
          type="button" 
          label="Retry" 
          class="p-button-sm"
          (click)="loadCodeSample()">
        </button>
      </div>
    </div>
  `,
  styleUrls: ['./advanced-code-sample.component.scss']
})
export class AdvancedCodeSampleComponent implements OnInit {
  @Input({ required: true }) sampleId = '';
  @Input() showLineNumbers = true;
  @Input() height = '400px';
  @Input() theme = 'vs-dark';

  @ViewChild('tabView') tabView: any;

  metadata: CodeSampleMetadata | null = null;
  loading = false;
  error: string | null = null;
  activeTabIndex = 0;

  private readonly languageIcons: { [key: string]: string } = {
    'typescript': 'pi pi-code',
    'javascript': 'pi pi-code',
    'html': 'pi pi-file',
    'css': 'pi pi-palette',
    'scss': 'pi pi-palette', 
    'json': 'pi pi-file-o',
    'markdown': 'pi pi-file-edit',
    'yaml': 'pi pi-cog',
    'xml': 'pi pi-file',
    'bash': 'pi pi-terminal',
    'shell': 'pi pi-terminal'
  };

  constructor(
    private http: HttpClient,
    private messageService: MessageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadCodeSample();
  }

  loadCodeSample() {
    if (!this.sampleId) {
      this.error = 'No sample ID provided';
      return;
    }

    this.loading = true;
    this.error = null;

    // Load metadata first
    this.http.get<CodeSampleMetadata>(`assets/code-samples/${this.sampleId}/metadata.json`)
      .subscribe({
        next: (metadata) => {
          this.metadata = metadata;
          this.loadFileContents();
        },
        error: (err) => {
          this.error = `Failed to load sample metadata: ${err.message}`;
          this.loading = false;
        }
      });
  }

  private loadFileContents() {
    if (!this.metadata) return;

    const fileRequests = this.metadata.files.map(file => 
      this.http.get(`assets/code-samples/${this.sampleId}/${file.filename}`, { responseType: 'text' })
        .pipe(map(content => ({ ...file, content })))
    );

    forkJoin(fileRequests).subscribe({
      next: (filesWithContent) => {
        if (this.metadata) {
          this.metadata.files = filesWithContent;
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = `Failed to load file contents: ${err.message}`;
        this.loading = false;
      }
    });
  }

  getFileIcon(language: string): string {
    return this.languageIcons[language.toLowerCase()] || 'pi pi-file';
  }

  getDifficultySeverity(difficulty: string): 'success' | 'info' | 'warning' | 'danger' {
    switch (difficulty) {
      case 'beginner': return 'success';
      case 'intermediate': return 'info';
      case 'advanced': return 'warning';
      default: return 'info';
    }
  }

  getHighlightedCode(content: string, language: string): string {
    // Basic syntax highlighting - in a real app you'd use Prism.js or highlight.js
    return this.highlightSyntax(content, language);
  }

  private highlightSyntax(code: string, language: string): string {
    // Simple syntax highlighting implementation
    let highlighted = code
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    switch (language.toLowerCase()) {
      case 'typescript':
      case 'javascript':
        highlighted = highlighted
          .replace(/\b(const|let|var|function|class|interface|type|import|export|from|default)\b/g, '<span class="keyword">$1</span>')
          .replace(/\b(string|number|boolean|object|any|void|null|undefined)\b/g, '<span class="type">$1</span>')
          .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
          .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
          .replace(/('[^']*'|"[^"]*"|`[^`]*`)/g, '<span class="string">$1</span>');
        break;
      
      case 'html':
        highlighted = highlighted
          .replace(/(&lt;\/?[^&gt;]+&gt;)/g, '<span class="tag">$1</span>')
          .replace(/(\w+)=/g, '<span class="attr-name">$1</span>=')
          .replace(/(="[^"]*")/g, '<span class="attr-value">$1</span>');
        break;
      
      case 'css':
      case 'scss':
        highlighted = highlighted
          .replace(/([.#]?[a-zA-Z-]+)(\s*{)/g, '<span class="selector">$1</span>$2')
          .replace(/([a-zA-Z-]+)(\s*:)/g, '<span class="property">$1</span>$2')
          .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>');
        break;
    }

    return highlighted;
  }

  getLineNumbers(content: string): number[] {
    const lines = content.split('\n').length;
    return Array.from({ length: lines }, (_, i) => i + 1);
  }

  getTotalLines(): number {
    return this.metadata?.files.reduce((total, file) => 
      total + file.content.split('\n').length, 0) || 0;
  }

  copyFileContent(file: CodeFile) {
    navigator.clipboard.writeText(file.content).then(() => {
      this.messageService.add({
        severity: 'success',
        summary: 'Copied!',
        detail: `${file.filename} copied to clipboard`,
        life: 2000
      });
    }).catch(() => {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Failed to copy to clipboard',
        life: 3000
      });
    });
  }

  copyAllFiles() {
    if (!this.metadata) return;

    const allContent = this.metadata.files
      .map(file => `// ${file.filename}\n${file.content}`)
      .join('\n\n' + '='.repeat(50) + '\n\n');

    navigator.clipboard.writeText(allContent).then(() => {
      this.messageService.add({
        severity: 'success',
        summary: 'All Files Copied!',
        detail: `${this.metadata!.files.length} files copied to clipboard`,
        life: 2000
      });
    });
  }

  downloadFile(file: CodeFile) {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  downloadZip() {
    if (!this.metadata) return;
    
    this.messageService.add({
      severity: 'info',
      summary: 'Download',
      detail: 'ZIP download feature coming soon!',
      life: 3000
    });
  }

  openExternal(url: string) {
    window.open(url, '_blank');
  }
}
