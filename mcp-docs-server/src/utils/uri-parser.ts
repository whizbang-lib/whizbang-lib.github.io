/**
 * Parsed MCP URI components
 *
 * Note: The 'code' scheme is reserved for future use.
 * Currently, code samples are embedded in markdown documentation
 * and accessed through 'doc://' URIs with enhanced metadata.
 */
export interface ParsedUri {
  scheme: 'doc' | 'roadmap' | 'code';
  path: string;
  category?: string;
  language?: string;
}

/**
 * Parse an MCP URI into its components
 *
 * Supported formats:
 * - doc://getting-started
 * - doc://tutorials/basic-setup
 * - roadmap://event-sourcing
 * - code://csharp/aggregates/OrderAggregate.cs
 */
export function parseUri(uri: string): ParsedUri {
  const uriPattern = /^(doc|roadmap|code):\/\/(.+)$/;
  const match = uri.match(uriPattern);

  if (!match) {
    throw new Error(`Invalid URI format: ${uri}. Expected format: scheme://path`);
  }

  const scheme = match[1] as 'doc' | 'roadmap' | 'code';
  const fullPath = match[2];

  const result: ParsedUri = {
    scheme,
    path: fullPath
  };

  // Extract category from path
  if (fullPath.includes('/')) {
    const parts = fullPath.split('/');
    result.category = parts[0];
  }

  // Extract language for code URIs
  if (scheme === 'code' && fullPath.includes('/')) {
    const parts = fullPath.split('/');
    result.language = parts[0]; // e.g., 'csharp'
  }

  return result;
}

/**
 * Convert MCP URI to file system path
 *
 * Examples:
 * - doc://getting-started -> getting-started.md
 * - doc://tutorials/basic-setup -> Tutorials/basic-setup.md
 * - roadmap://event-sourcing -> Roadmap/event-sourcing.md
 * - code://csharp/aggregates/Order.cs -> aggregates/Order.cs
 */
export function uriToFilePath(uri: string): string {
  const parsed = parseUri(uri);

  if (parsed.scheme === 'doc') {
    // Convert to proper case for directories
    const path = parsed.path
      .split('/')
      .map((part, index) => {
        // First part might be a category (capitalize first letter)
        if (index === 0 && parsed.category) {
          return part.charAt(0).toUpperCase() + part.slice(1);
        }
        return part;
      })
      .join('/');
    return `${path}.md`;
  }

  if (parsed.scheme === 'roadmap') {
    return `Roadmap/${parsed.path}.md`;
  }

  if (parsed.scheme === 'code') {
    // Remove language prefix (e.g., 'csharp/')
    if (parsed.language) {
      const pathWithoutLang = parsed.path.substring(parsed.language.length + 1);
      return pathWithoutLang;
    }
    return parsed.path;
  }

  throw new Error(`Unsupported URI scheme: ${parsed.scheme}`);
}

/**
 * Convert file path to MCP URI
 *
 * Examples:
 * - getting-started.md -> doc://getting-started
 * - Tutorials/basic-setup.md -> doc://tutorials/basic-setup
 * - Roadmap/event-sourcing.md -> roadmap://event-sourcing
 * - aggregates/Order.cs -> code://csharp/aggregates/Order.cs
 */
export function filePathToUri(filePath: string): string {
  // Remove extension
  const withoutExt = filePath.replace(/\.(md|cs)$/, '');

  // Check if it's a roadmap document
  if (withoutExt.startsWith('Roadmap/')) {
    const path = withoutExt.substring('Roadmap/'.length);
    return `roadmap://${path.toLowerCase()}`;
  }

  // Check if it's a code sample
  if (filePath.endsWith('.cs')) {
    return `code://csharp/${withoutExt}`;
  }

  // Otherwise it's a regular doc
  return `doc://${withoutExt.toLowerCase()}`;
}

/**
 * Validate URI format
 */
export function isValidUri(uri: string): boolean {
  try {
    parseUri(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get URI scheme
 */
export function getUriScheme(uri: string): string | null {
  const match = uri.match(/^([^:]+):\/\//);
  return match ? match[1] : null;
}
