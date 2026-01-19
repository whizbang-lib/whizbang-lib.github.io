import { FileLoader } from '../utils/file-loader.js';
import { parseMarkdown } from '../utils/frontmatter.js';

/**
 * Enhanced code block metadata extracted from markdown
 */
export interface CodeExample {
  slug: string;
  docTitle: string;
  docUri: string;
  title?: string;
  description?: string;
  framework?: string;
  category?: string;
  difficulty?: string;
  tags?: string[];
  testFile?: string;
  testMethod?: string;
  language: string;
  codeSnippet: string; // First 200 chars of code
}

/**
 * Search parameters for finding code examples
 */
export interface FindExamplesParams {
  query?: string;
  framework?: string;
  difficulty?: string;
  category?: string;
  tags?: string[];
  limit?: number;
}

/**
 * Parse enhanced code block metadata from markdown content
 * Format: ```csharp{ metadata }
 */
function parseCodeBlockMetadata(codeBlock: string): Record<string, any> | null {
  // Match code blocks with metadata: ```lang{ ... }
  const metadataPattern = /```(\w+)\{([^}]+)\}/;
  const match = codeBlock.match(metadataPattern);

  if (!match) {
    return null;
  }

  const language = match[1];
  const metadataText = match[2];

  try {
    // Parse metadata (simplified YAML-like format)
    const metadata: Record<string, any> = { language };

    metadataText.split('\n').forEach((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value: any = line.substring(colonIndex + 1).trim();

        // Remove quotes
        value = value.replace(/^["']|["']$/g, '');

        // Parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value
            .slice(1, -1)
            .split(',')
            .map((v: string) => v.trim().replace(/^["']|["']$/g, ''));
        }

        metadata[key] = value;
      }
    });

    return metadata;
  } catch (error) {
    console.error('Failed to parse code block metadata:', error);
    return null;
  }
}

/**
 * Extract code examples from markdown content
 */
function extractCodeExamples(
  content: string,
  slug: string,
  docTitle: string,
  docUri: string
): CodeExample[] {
  const examples: CodeExample[] = [];

  // Find all enhanced code blocks
  const codeBlockPattern = /```(\w+)\{([^}]+)\}([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockPattern.exec(content)) !== null) {
    const fullBlock = match[0];
    const language = match[1];
    const code = match[3].trim();

    const metadata = parseCodeBlockMetadata(fullBlock);

    if (metadata) {
      examples.push({
        slug,
        docTitle,
        docUri,
        title: metadata.title,
        description: metadata.description,
        framework: metadata.framework,
        category: metadata.category,
        difficulty: metadata.difficulty,
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        testFile: metadata.testFile,
        testMethod: metadata.testMethod,
        language,
        codeSnippet: code.substring(0, 200) // Preview
      });
    }
  }

  return examples;
}

/**
 * Find code examples across all documentation
 */
export async function findExamples(
  params: FindExamplesParams,
  fileLoader: FileLoader
): Promise<CodeExample[]> {
  const { query, framework, difficulty, category, tags, limit = 20 } = params;

  // Load all documentation
  const docFiles = await fileLoader.listDocFiles();
  const allExamples: CodeExample[] = [];

  // Extract code examples from each document
  for (const file of docFiles) {
    try {
      const content = await fileLoader.readDocFile(file.path);
      const parsed = parseMarkdown(content);

      const examples = extractCodeExamples(
        content,
        file.path.replace('.md', ''),
        parsed.frontmatter.title || file.path,
        file.uri
      );

      allExamples.push(...examples);
    } catch (error) {
      console.error(`Failed to extract examples from ${file.path}:`, error);
    }
  }

  // Filter examples
  let filtered = allExamples;

  if (query) {
    const lowerQuery = query.toLowerCase();
    filtered = filtered.filter(
      (ex) =>
        ex.title?.toLowerCase().includes(lowerQuery) ||
        ex.description?.toLowerCase().includes(lowerQuery) ||
        ex.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery)) ||
        ex.codeSnippet.toLowerCase().includes(lowerQuery)
    );
  }

  if (framework) {
    filtered = filtered.filter(
      (ex) => ex.framework?.toLowerCase() === framework.toLowerCase()
    );
  }

  if (difficulty) {
    filtered = filtered.filter(
      (ex) => ex.difficulty?.toLowerCase() === difficulty.toLowerCase()
    );
  }

  if (category) {
    filtered = filtered.filter(
      (ex) => ex.category?.toLowerCase().includes(category.toLowerCase())
    );
  }

  if (tags && tags.length > 0) {
    filtered = filtered.filter((ex) =>
      tags.some((tag) => ex.tags?.some((exTag) => exTag.toLowerCase().includes(tag.toLowerCase())))
    );
  }

  // Return limited results
  return filtered.slice(0, limit);
}
