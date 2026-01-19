import matter from 'gray-matter';

/**
 * Documentation frontmatter structure
 */
export interface DocFrontmatter {
  title?: string;
  category?: string;
  order?: number;
  tags?: string[];
  description?: string;
  unreleased?: boolean;
  targetVersion?: string;
  status?: 'planned' | 'in-development' | 'experimental';
  lastUpdated?: string;
  difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}

/**
 * Parsed markdown document with frontmatter and content
 */
export interface ParsedMarkdown {
  frontmatter: DocFrontmatter;
  content: string;
  excerpt?: string;
}

/**
 * Parse markdown content and extract frontmatter
 */
export function parseMarkdown(content: string): ParsedMarkdown {
  const parsed = matter(content, {
    excerpt: true,
    excerpt_separator: '<!-- more -->'
  });

  return {
    frontmatter: parsed.data as DocFrontmatter,
    content: parsed.content,
    excerpt: parsed.excerpt
  };
}

/**
 * Check if a document is a roadmap item (unreleased feature)
 */
export function isRoadmapDoc(frontmatter: DocFrontmatter): boolean {
  return frontmatter.unreleased === true || !!frontmatter.status;
}

/**
 * Get display title for a document
 */
export function getDocTitle(frontmatter: DocFrontmatter, fallbackPath: string): string {
  if (frontmatter.title) {
    return frontmatter.title;
  }

  // Extract title from path (e.g., "getting-started" -> "Getting Started")
  const pathParts = fallbackPath.split('/');
  const filename = pathParts[pathParts.length - 1];
  const titleFromPath = filename
    .replace(/\.md$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return titleFromPath;
}

/**
 * Get document description for search results
 */
export function getDocDescription(frontmatter: DocFrontmatter, excerpt?: string): string {
  if (frontmatter.description) {
    return frontmatter.description;
  }

  if (excerpt) {
    return excerpt.substring(0, 200);
  }

  return '';
}

/**
 * Create resource metadata from frontmatter
 */
export function createResourceMetadata(frontmatter: DocFrontmatter): Record<string, string | number | boolean> {
  const metadata: Record<string, string | number | boolean> = {};

  if (frontmatter.category) {
    metadata.category = frontmatter.category;
  }

  if (frontmatter.order !== undefined) {
    metadata.order = frontmatter.order;
  }

  if (frontmatter.tags && frontmatter.tags.length > 0) {
    metadata.tags = frontmatter.tags.join(', ');
  }

  if (frontmatter.difficulty) {
    metadata.difficulty = frontmatter.difficulty;
  }

  if (frontmatter.unreleased) {
    metadata.unreleased = true;
  }

  if (frontmatter.status) {
    metadata.status = frontmatter.status;
  }

  if (frontmatter.targetVersion) {
    metadata.targetVersion = frontmatter.targetVersion;
  }

  return metadata;
}
