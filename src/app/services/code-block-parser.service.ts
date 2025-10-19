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
    
    // Parse enhanced C# code blocks with metadata
    const csharpCodeBlockRegex = /```csharp\{([^}]*)\}([\s\S]*?)```/g;
    let match;
    
    while ((match = csharpCodeBlockRegex.exec(content)) !== null) {
      const metadataString = match[1];
      const code = match[2].trim();
      const placeholder = `[CODE_BLOCK_${blockIndex}]`;
      
      // Parse metadata
      const options = this.parseMetadata(metadataString);
      
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
    let regularMatch;

    while ((regularMatch = regularCodeBlockRegex.exec(processedContent)) !== null) {
      const language = regularMatch[1] || 'text';

      // Skip mermaid blocks - they need to be rendered with Mermaid.js, not as code blocks
      if (language === 'mermaid') {
        continue;
      }

      const code = regularMatch[2].trim();
      const placeholder = `[CODE_BLOCK_${blockIndex}]`;
      
      // Create basic options for regular code blocks
      const options = {
        language: language,
        showLineNumbers: true,
        showCopyButton: true,
        collapsible: false
      };
      
      codeBlocks.push({
        code,
        options,
        placeholder
      });
      
      // Replace the code block with a placeholder
      processedContent = processedContent.replace(regularMatch[0], placeholder);
      blockIndex++;
    }
    
    return { processedContent, codeBlocks };
  }
  
  // Keep the old method for backward compatibility
  parseCollapsibleCodeBlocks(content: string): { processedContent: string, codeBlocks: CollapsibleCodeBlock[] } {
    return this.parseAllCodeBlocks(content);
  }
  
  private parseMetadata(metadataString: string): any {
    const metadata: any = {};
    
    try {
      const lines = metadataString.split('\n').map(line => line.trim()).filter(line => line);
      
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        
        const key = line.substring(0, colonIndex).trim().replace(/"/g, '');
        const valueStr = line.substring(colonIndex + 1).trim();
        
        if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
          // Array value
          try {
            metadata[key] = JSON.parse(valueStr);
          } catch {
            metadata[key] = valueStr.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
          }
        } else {
          // String value
          metadata[key] = valueStr.replace(/^["']|["']$/g, '');
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
