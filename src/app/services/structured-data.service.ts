import { Injectable, inject } from '@angular/core';
import { BreadcrumbItem } from '../components/breadcrumb.component';

export interface DocumentMetadata {
  title: string;
  description: string;
  category: string;
  tags?: string[];
  order?: number;
}

export interface CodeExample {
  title?: string;
  description?: string;
  language: string;
  code: string;
  framework?: string;
  difficulty?: string;
  filename?: string;
}

@Injectable({
  providedIn: 'root'
})
export class StructuredDataService {
  private readonly baseUrl = 'https://whizba.ng';

  /**
   * Generate comprehensive structured data for a documentation page
   */
  generateDocumentationStructuredData(
    url: string, 
    metadata: DocumentMetadata, 
    breadcrumbs: BreadcrumbItem[] = [],
    codeExamples: CodeExample[] = []
  ): string {
    const structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        this.generateWebSiteSchema(),
        this.generateOrganizationSchema(),
        this.generateTechArticleSchema(url, metadata, codeExamples),
        ...this.generateBreadcrumbListSchema(breadcrumbs),
        ...this.generateSoftwareSourceCodeSchemas(codeExamples)
      ]
    };

    return JSON.stringify(structuredData, null, 2);
  }

  /**
   * Generate WebSite schema for the entire documentation site
   */
  private generateWebSiteSchema(): any {
    return {
      "@type": "WebSite",
      "@id": `${this.baseUrl}/#website`,
      "url": `${this.baseUrl}/`,
      "name": "Whizbang Documentation",
      "description": "Comprehensive documentation for the Whizbang .NET library - CQRS, Event Sourcing, and Projections made simple",
      "publisher": {
        "@id": `${this.baseUrl}/#organization`
      },
      "potentialAction": [
        {
          "@type": "SearchAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": `${this.baseUrl}/?search={search_term_string}`
          },
          "query-input": "required name=search_term_string"
        }
      ],
      "inLanguage": "en-US"
    };
  }

  /**
   * Generate Organization schema for Whizbang project
   */
  private generateOrganizationSchema(): any {
    return {
      "@type": "Organization",
      "@id": `${this.baseUrl}/#organization`,
      "name": "Whizbang Library",
      "url": `${this.baseUrl}/`,
      "logo": {
        "@type": "ImageObject",
        "url": `${this.baseUrl}/assets/logo.png`,
        "width": 512,
        "height": 512
      },
      "sameAs": [
        "https://github.com/whizbang-lib/whizbang"
      ],
      "description": "Open-source .NET library for CQRS, Event Sourcing, and Projections"
    };
  }

  /**
   * Generate TechArticle schema for documentation pages
   */
  private generateTechArticleSchema(url: string, metadata: DocumentMetadata, codeExamples: CodeExample[]): any {
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url.startsWith('/') ? url : '/' + url}`;
    
    // Determine specific article type based on content
    const articleType = this.determineArticleType(metadata, codeExamples);
    
    const article: any = {
      "@type": articleType,
      "@id": `${fullUrl}#article`,
      "url": fullUrl,
      "headline": metadata.title,
      "description": metadata.description,
      "datePublished": new Date().toISOString().split('T')[0], // Current date as fallback
      "dateModified": new Date().toISOString().split('T')[0],
      "author": {
        "@type": "Organization",
        "@id": `${this.baseUrl}/#organization`
      },
      "publisher": {
        "@id": `${this.baseUrl}/#organization`
      },
      "isPartOf": {
        "@id": `${this.baseUrl}/#website`
      },
      "inLanguage": "en-US",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": fullUrl
      }
    };

    // Add category-specific properties
    if (metadata.category) {
      article.articleSection = metadata.category;
    }

    // Add tags as keywords
    if (metadata.tags && metadata.tags.length > 0) {
      article.keywords = metadata.tags.join(', ');
    }

    // Add programming language and framework context for technical articles
    if (codeExamples.length > 0) {
      const languages = [...new Set(codeExamples.map(ex => ex.language))];
      const frameworks = [...new Set(codeExamples.map(ex => ex.framework).filter(Boolean))];
      
      article.programmingLanguage = languages;
      
      if (frameworks.length > 0) {
        article.applicationCategory = frameworks.join(', ');
      }

      // Add about property for technical content
      article.about = [
        {
          "@type": "SoftwareApplication",
          "name": "Whizbang .NET Library",
          "applicationCategory": "DeveloperApplication",
          "operatingSystem": ".NET"
        }
      ];
    }

    // Add difficulty level if available
    const difficulties = codeExamples.map(ex => ex.difficulty).filter(Boolean);
    if (difficulties.length > 0) {
      article.educationalLevel = difficulties[0]; // Use first example's difficulty
    }

    return article;
  }

  /**
   * Generate BreadcrumbList schema from breadcrumb navigation
   */
  private generateBreadcrumbListSchema(breadcrumbs: BreadcrumbItem[]): any[] {
    if (breadcrumbs.length === 0) {
      return [];
    }

    const breadcrumbList = {
      "@type": "BreadcrumbList",
      "@id": `${this.baseUrl}/#breadcrumblist`,
      "itemListElement": breadcrumbs
        .filter(item => item.url) // Only include items with URLs
        .map((item, index) => ({
          "@type": "ListItem",
          "position": index + 1,
          "name": item.label,
          "item": {
            "@type": "WebPage",
            "@id": item.url!.startsWith('http') ? item.url! : `${this.baseUrl}${item.url!.startsWith('/') ? item.url! : '/' + item.url!}`
          }
        }))
    };

    return [breadcrumbList];
  }

  /**
   * Generate SoftwareSourceCode schemas for code examples
   */
  private generateSoftwareSourceCodeSchemas(codeExamples: CodeExample[]): any[] {
    if (codeExamples.length === 0) {
      return [];
    }

    return codeExamples.map((example, index) => {
      const sourceCode: any = {
        "@type": "SoftwareSourceCode",
        "@id": `#code-example-${index + 1}`,
        "programmingLanguage": {
          "@type": "ComputerLanguage",
          "name": this.getLanguageDisplayName(example.language)
        },
        "codeValue": example.code,
        "description": example.description || `${this.getLanguageDisplayName(example.language)} code example`
      };

      // Add title if available
      if (example.title) {
        sourceCode.name = example.title;
      }

      // Add filename if available
      if (example.filename) {
        sourceCode.fileName = example.filename;
      }

      // Add framework context
      if (example.framework) {
        sourceCode.runtimePlatform = example.framework;
      }

      // Add educational level
      if (example.difficulty) {
        sourceCode.educationalLevel = example.difficulty;
      }

      // Link to the containing article
      sourceCode.isPartOf = {
        "@type": "TechArticle",
        "@id": "#article"
      };

      return sourceCode;
    });
  }

  /**
   * Determine the most appropriate article type based on content
   */
  private determineArticleType(metadata: DocumentMetadata, codeExamples: CodeExample[]): string {
    const title = metadata.title.toLowerCase();
    const category = metadata.category.toLowerCase();
    
    // API Reference for technical specifications
    if (title.includes('api') || title.includes('reference') || 
        category.includes('api') || metadata.tags?.some(tag => tag.toLowerCase().includes('api'))) {
      return 'APIReference';
    }
    
    // HowTo for tutorials and guides
    if (title.includes('getting started') || title.includes('how to') || title.includes('tutorial') ||
        category.includes('getting started') || category.includes('tutorial') ||
        codeExamples.length > 0) {
      return 'HowTo';
    }
    
    // TechArticle for general technical documentation
    return 'TechArticle';
  }

  /**
   * Get display name for programming language
   */
  private getLanguageDisplayName(language: string): string {
    const languageMap: { [key: string]: string } = {
      'csharp': 'C#',
      'javascript': 'JavaScript',
      'typescript': 'TypeScript',
      'json': 'JSON',
      'bash': 'Bash',
      'yaml': 'YAML',
      'xml': 'XML',
      'sql': 'SQL'
    };
    
    return languageMap[language.toLowerCase()] || language;
  }

  /**
   * Add structured data to page head
   */
  addStructuredDataToPage(structuredData: string, dataId: string = 'structured-data'): void {
    // Remove existing structured data with this ID
    this.removeStructuredDataFromPage(dataId);

    // Add new structured data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-structured-data', dataId);
    script.textContent = structuredData;
    document.head.appendChild(script);
  }

  /**
   * Remove structured data from page head
   */
  removeStructuredDataFromPage(dataId: string = 'structured-data'): void {
    const existingScript = document.querySelector(`script[data-structured-data="${dataId}"]`);
    if (existingScript) {
      existingScript.remove();
    }
  }

  /**
   * Extract code examples from parsed content (utility method)
   */
  extractCodeExamplesFromContent(content: string): CodeExample[] {
    const codeExamples: CodeExample[] = [];
    
    // Match code blocks with metadata
    const codeBlockRegex = /```(\w+)\{([^}]*)\}?\n([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, language, metadataStr, code] = match;
      
      // Parse metadata
      const metadata: any = {};
      if (metadataStr) {
        // Simple key-value parsing for metadata like title: "Example", difficulty: "BEGINNER"
        const metadataMatches = metadataStr.match(/(\w+):\s*"([^"]*)"|\w+:\s*(\w+)/g);
        if (metadataMatches) {
          metadataMatches.forEach(m => {
            const [key, ...valueParts] = m.split(':');
            const value = valueParts.join(':').trim().replace(/^"(.*)"$/, '$1');
            metadata[key.trim()] = value;
          });
        }
      }
      
      codeExamples.push({
        language: language,
        code: code.trim(),
        title: metadata.title,
        description: metadata.description,
        framework: metadata.framework,
        difficulty: metadata.difficulty,
        filename: metadata.filename
      });
    }
    
    return codeExamples;
  }
}