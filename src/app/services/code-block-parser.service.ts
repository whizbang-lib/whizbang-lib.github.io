import { Injectable, ComponentRef, ViewContainerRef, EnvironmentInjector, createComponent } from '@angular/core';
import { EnhancedCodeBlockV2Component } from '../components/enhanced-code-block-v2.component';

interface CollapsibleCodeBlock {
  code: string;
  options: any;
  placeholder: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodeBlockParser {
  
  parseAllCodeBlocks(content: string): { processedContent: string, codeBlocks: CollapsibleCodeBlock[] } {
    const codeBlocks: CollapsibleCodeBlock[] = [];
    let processedContent = content;
    let blockIndex = 0;
    
    // Parse enhanced code blocks with metadata — ANY language, not just csharp.
    // A csharp-only regex left ```bash{...} / ```json{...} blocks unconsumed;
    // the regular-block pass below then mispaired their fences (its regex
    // can't match a ```lang{ opening) and swallowed the PROSE between blocks —
    // whole sections silently vanished from rendered pages.
    const enhancedCodeBlockRegex = /```([\w#+-]+)\{([^}]*)\}([\s\S]*?)```/g;
    let match;

    while ((match = enhancedCodeBlockRegex.exec(content)) !== null) {
      const language = match[1];
      // Mermaid diagrams (even with {caption/tests} metadata) are rendered
      // separately by the markdown page — never as code blocks.
      if (language === 'mermaid') continue;
      const metadataString = match[2];
      const code = match[3].trim();
      const placeholder = `[CODE_BLOCK_${blockIndex}]`;

      // Parse metadata
      const options = this.parseMetadata(metadataString);
      if (!options.language) {
        options.language = language;
      }
      
      // Set component type based on whether it's collapsible
      if (options.showLinesOnly && Array.isArray(options.showLinesOnly) && options.showLinesOnly.length > 0) {
        options.collapsible = true;
      }
      
      codeBlocks.push({
        code,
        options,
        placeholder
      });
      
      // Replace the code block with a placeholder
      processedContent = processedContent.replace(match[0], placeholder);
      blockIndex++;
    }
    
    // Parse regular code blocks (without metadata)
    // NOTE: Skip mermaid blocks - they are handled separately by the markdown page component
    const regularCodeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    
    // First, collect all matches to avoid issues with modifying the string during iteration
    const regularMatches = Array.from(processedContent.matchAll(regularCodeBlockRegex));
    
    // Create an array to store the blocks in order
    const regularCodeBlocks = [];
    
    // Process matches in order to create code blocks
    for (let i = 0; i < regularMatches.length; i++) {
      const regularMatch = regularMatches[i];
      const language = regularMatch[1] || 'text';

      // Skip mermaid blocks - they need to be rendered with Mermaid.js, not as code blocks
      if (language === 'mermaid') {
        continue;
      }

      const code = regularMatch[2].trim();
      const placeholder = `[CODE_BLOCK_${blockIndex + i}]`;
      
      // Check if this is a code language that should have front-matter
      const shouldHaveFrontMatter = ['csharp', 'cs', 'c#', 'javascript', 'js', 'typescript', 'ts', 'json', 'xml', 'yaml', 'yml', 'bash', 'sh', 'powershell', 'ps1', 'sql', 'html', 'css', 'scss', 'python', 'py', 'java', 'go', 'rust', 'php'].includes(language.toLowerCase());
      
      // Create options for regular code blocks
      const options = {
        language: language,
        showLineNumbers: true,
        showCopyButton: true,
        collapsible: false,
        // Add error flag for missing front-matter
        missingFrontMatter: shouldHaveFrontMatter,
        errorMessage: shouldHaveFrontMatter ? 
          `⚠️ Missing Front-Matter: This ${language} codeblock needs metadata. Add front-matter like: \`\`\`${language}{title: "...", description: "...", framework: "NET8", category: "...", difficulty: "BEGINNER|INTERMEDIATE|ADVANCED", tags: [...]}` : 
          undefined
      };
      
      regularCodeBlocks.push({
        code,
        options,
        placeholder,
        match: regularMatch[0]
      });
    }
    
    // Now replace all matches in reverse order to avoid index shifting, but add to codeBlocks in forward order
    for (let i = regularCodeBlocks.length - 1; i >= 0; i--) {
      const block = regularCodeBlocks[i];
      processedContent = processedContent.replace(block.match, block.placeholder);
    }
    
    // Add blocks to codeBlocks array in the correct order
    for (let i = 0; i < regularCodeBlocks.length; i++) {
      const block = regularCodeBlocks[i];
      codeBlocks.push({
        code: block.code,
        options: block.options,
        placeholder: block.placeholder
      });
      blockIndex++;
    }
    
    return { processedContent, codeBlocks };
  }
  
  // Keep the old method for backward compatibility
  parseCollapsibleCodeBlocks(content: string): { processedContent: string, codeBlocks: CollapsibleCodeBlock[] } {
    return this.parseAllCodeBlocks(content);
  }
  
  /** Parse a fence metadata string (`key="v" tests=[...]`). Reused for ```mermaid{...}. */
  parseFenceMetadata(metadataString: string): any {
    return this.parseMetadata(metadataString);
  }

  private parseMetadata(metadataString: string): any {
    const metadata: any = {};

    try {
      // Real content overwhelmingly uses the one-line `key="value"` / `key=[...]`
      // form (e.g. dispatcher.md). A colon+newline (`key: value`) form is legacy
      // and rare. Detect the equals form by a key immediately assigned a quoted
      // string or an array — a colon-style value that merely contains "=" (or a
      // description containing ":") won't false-trigger either branch.
      if (/\w+\s*=\s*["'[]/.test(metadataString)) {
        // key="quoted value" | key=[array] | key=bareValue, whitespace/newline separated.
        const tokenRe = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[^\s]+)/g;
        let m: RegExpExecArray | null;
        while ((m = tokenRe.exec(metadataString)) !== null) {
          metadata[m[1]] = this.coerceMetadataValue(m[2]);
        }
      } else {
        // Legacy per-line `key: value` form.
        const lines = metadataString.split('\n').map(line => line.trim()).filter(line => line);
        for (const line of lines) {
          const colonIndex = line.indexOf(':');
          if (colonIndex === -1) continue;
          const key = line.substring(0, colonIndex).trim().replace(/"/g, '');
          metadata[key] = this.coerceMetadataValue(line.substring(colonIndex + 1).trim());
        }
      }

      // Set defaults
      metadata.showLineNumbers = metadata.showLineNumbers !== false;
      metadata.showCopyButton = metadata.showCopyButton !== false;

    } catch (error) {
      console.warn('Failed to parse code metadata:', error);
    }

    return metadata;
  }

  /** Coerce a raw metadata value: `[...]` -> array, quoted -> unquoted string. */
  private coerceMetadataValue(raw: string): any {
    const v = raw.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      try {
        return JSON.parse(v);
      } catch {
        return v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
    }
    return v.replace(/^["']|["']$/g, '');
  }
  
  createCodeBlockComponent(
    codeBlock: CollapsibleCodeBlock, 
    viewContainer: ViewContainerRef,
    injector: EnvironmentInjector
  ): ComponentRef<EnhancedCodeBlockV2Component> {
    const componentRef = createComponent(EnhancedCodeBlockV2Component, {
      environmentInjector: injector
    });
    
    componentRef.instance.code = codeBlock.code;
    componentRef.instance.options = codeBlock.options;
    
    // Trigger change detection to ensure the component renders
    componentRef.changeDetectorRef.detectChanges();
    
    return componentRef;
  }
}
