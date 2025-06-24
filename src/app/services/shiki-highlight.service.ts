import { Injectable, inject } from '@angular/core';
import { createHighlighter, type Highlighter, type BundledLanguage, type BundledTheme } from 'shiki';
import { ThemeService } from './theme.service';

export interface ShikiConfig {
  theme?: BundledTheme;
  language?: BundledLanguage;
  lineNumbers?: boolean;
  wordWrap?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ShikiHighlightService {
  private readonly themeService = inject(ThemeService);
  private highlighter: Highlighter | null = null;
  private readonly defaultLanguage: BundledLanguage = 'csharp';

  async initialize(): Promise<void> {
    if (this.highlighter) {
      return;
    }

    try {
      this.highlighter = await createHighlighter({
        themes: [
          'dark-plus',
          'light-plus', 
          'github-dark',
          'github-light',
          'monokai',
          'nord',
          'one-dark-pro',
          'solarized-dark',
          'solarized-light'
        ],
        langs: [
          'csharp',
          'json',
          'xml',
          'yaml',
          'sql',
          'powershell',
          'bash',
          'typescript',
          'javascript'
        ]
      });
    } catch (error) {
      console.error('Failed to initialize Shiki highlighter:', error);
      throw error;
    }
  }

  async highlightCode(
    code: string, 
    config: ShikiConfig = {}
  ): Promise<string> {
    if (!this.highlighter) {
      await this.initialize();
    }

    if (!this.highlighter) {
      // Fallback to basic HTML escaping
      return this.escapeHtml(code);
    }

    const {
      theme = this.getDefaultTheme(),
      language = this.defaultLanguage,
      lineNumbers = false,
      wordWrap = false
    } = config;

    try {
      const highlightedCode = this.highlighter.codeToHtml(code, {
        lang: language,
        theme: theme,
        transformers: [
          // Add line numbers if requested
          ...(lineNumbers ? [{
            line(node: any, line: number) {
              node.properties['data-line'] = line;
            }
          }] : []),
          
          // Add word wrap support
          ...(wordWrap ? [{
            pre(node: any) {
              node.properties.style = (node.properties.style || '') + 
                '; white-space: pre-wrap; word-break: break-word;';
            }
          }] : [])
        ]
      });

      return highlightedCode;
    } catch (error) {
      console.error('Failed to highlight code:', error);
      return this.escapeHtml(code);
    }
  }

  async highlightCSharp(
    code: string,
    theme: BundledTheme = this.getDefaultTheme(),
    options: { lineNumbers?: boolean; wordWrap?: boolean } = {}
  ): Promise<string> {
    return this.highlightCode(code, {
      language: 'csharp',
      theme,
      ...options
    });
  }

  async highlightMultipleLanguages(
    codeBlocks: Array<{ code: string; language: BundledLanguage; theme?: BundledTheme }>
  ): Promise<string[]> {
    if (!this.highlighter) {
      await this.initialize();
    }

    const promises = codeBlocks.map(({ code, language, theme }) => 
      this.highlightCode(code, { language, theme })
    );

    return Promise.all(promises);
  }

  getAvailableThemes(): BundledTheme[] {
    return [
      'dark-plus',
      'light-plus', 
      'github-dark',
      'github-light',
      'monokai',
      'nord',
      'one-dark-pro',
      'solarized-dark',
      'solarized-light'
    ];
  }

  getAvailableLanguages(): BundledLanguage[] {
    return [
      'csharp',
      'json',
      'xml',
      'yaml',
      'sql',
      'powershell',
      'bash',
      'typescript',
      'javascript'
    ];
  }

  getDefaultTheme(): BundledTheme {
    // Use the theme service to get the appropriate syntax highlighting theme
    return this.themeService.getSyntaxHighlightTheme() as BundledTheme;
  }
  
  getThemeFromUserPreference(): BundledTheme {
    // Delegate to theme service
    return this.getDefaultTheme();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return `<pre><code>${div.innerHTML}</code></pre>`;
  }

  // Advanced highlighting with custom annotations
  async highlightWithAnnotations(
    code: string,
    annotations: Array<{
      line: number;
      message: string;
      type: 'info' | 'warning' | 'error';
    }>,
    config: ShikiConfig = {}
  ): Promise<string> {
    const baseHighlighted = await this.highlightCode(code, config);
    
    // Add annotation support
    let annotatedCode = baseHighlighted;
    
    annotations.forEach(annotation => {
      const lineClass = `annotation-${annotation.type}`;
      const dataAttr = `data-annotation="${annotation.message}"`;
      
      // This is a simplified implementation
      // In a real scenario, you'd parse the HTML and add annotations
      annotatedCode = annotatedCode.replace(
        `data-line="${annotation.line}"`,
        `data-line="${annotation.line}" ${dataAttr} class="${lineClass}"`
      );
    });

    return annotatedCode;
  }

  // Diff highlighting for code comparisons
  async highlightDiff(
    oldCode: string,
    newCode: string,
    theme: BundledTheme = this.getDefaultTheme()
  ): Promise<{ old: string; new: string; diff: string }> {
    const [oldHighlighted, newHighlighted] = await Promise.all([
      this.highlightCSharp(oldCode, theme),
      this.highlightCSharp(newCode, theme)
    ]);

    // Simple diff implementation
    const diffCode = this.generateSimpleDiff(oldCode, newCode);
    const diffHighlighted = await this.highlightCode(diffCode, {
      language: 'diff',
      theme
    });

    return {
      old: oldHighlighted,
      new: newHighlighted,
      diff: diffHighlighted
    };
  }

  private generateSimpleDiff(oldCode: string, newCode: string): string {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    const diffLines: string[] = [];

    // Very basic diff - in production, use a proper diff library
    const maxLength = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        diffLines.push(`  ${oldLine || ''}`);
      } else {
        if (oldLine && !newLine) {
          diffLines.push(`- ${oldLine}`);
        } else if (!oldLine && newLine) {
          diffLines.push(`+ ${newLine}`);
        } else {
          diffLines.push(`- ${oldLine || ''}`);
          diffLines.push(`+ ${newLine || ''}`);
        }
      }
    }

    return diffLines.join('\n');
  }
}
