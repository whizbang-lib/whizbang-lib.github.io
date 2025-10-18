import fs from 'fs/promises';
import path from 'path';

export interface FileLoaderConfig {
  docsSource: 'local' | 'remote';
  docsPath: string;
  docsBaseUrl?: string;
}

export interface DocFileInfo {
  path: string;
  uri: string;
  category?: string;
}

/**
 * Utility for loading documentation files from local filesystem or remote URLs
 */
export class FileLoader {
  constructor(private config: FileLoaderConfig) {}

  /**
   * Read a documentation file by its relative path
   */
  async readDocFile(relativePath: string): Promise<string> {
    if (this.config.docsSource === 'local') {
      return this.readLocalFile(relativePath);
    } else {
      return this.readRemoteFile(relativePath);
    }
  }

  /**
   * Read a local file from the docs directory
   */
  private async readLocalFile(relativePath: string): Promise<string> {
    const fullPath = path.join(this.config.docsPath, relativePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Documentation file not found: ${relativePath}`);
      }
      throw error;
    }
  }

  /**
   * Read a remote file from the documentation website
   */
  private async readRemoteFile(relativePath: string): Promise<string> {
    const url = `${this.config.docsBaseUrl}/assets/docs/${relativePath}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      throw new Error(`Failed to fetch remote documentation: ${error}`);
    }
  }

  /**
   * List all available documentation files from docs-list.json
   */
  async listDocFiles(): Promise<DocFileInfo[]> {
    try {
      const docsListPath = path.join(this.config.docsPath, '../docs-list.json');
      const content = await fs.readFile(docsListPath, 'utf-8');
      const docsList = JSON.parse(content);

      const files: DocFileInfo[] = [];

      // docs-list.json is an array of paths (without .md extension)
      if (Array.isArray(docsList)) {
        for (const docPath of docsList) {
          // Add .md extension to get the actual file path
          const filePath = `${docPath}.md`;

          // Extract category from path if it contains a directory
          let category: string | undefined;
          if (docPath.includes('/')) {
            category = docPath.split('/')[0];
          }

          files.push({
            path: filePath,
            uri: this.pathToUri(filePath),
            category: category
          });
        }
      }

      return files;
    } catch (error) {
      console.error('Failed to load docs-list.json:', error);
      return [];
    }
  }

  /**
   * Check if a file exists
   */
  async fileExists(relativePath: string): Promise<boolean> {
    if (this.config.docsSource === 'local') {
      const fullPath = path.join(this.config.docsPath, relativePath);
      try {
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    } else {
      // For remote, we'd need to try fetching
      try {
        await this.readRemoteFile(relativePath);
        return true;
      } catch {
        return false;
      }
    }
  }

  // Note: Code samples are embedded in markdown documentation with enhanced metadata.
  // They are accessed through doc:// URIs, not as separate code:// resources.
  // The code:// URI scheme is reserved for future use if we extract code blocks.

  /**
   * Convert file path to MCP URI
   */
  private pathToUri(filePath: string): string {
    // Remove .md extension
    const withoutExt = filePath.replace(/\.md$/, '');

    // Determine category from path
    if (withoutExt.includes('Roadmap/')) {
      return `roadmap://${withoutExt.replace('Roadmap/', '')}`;
    }

    // Convert to doc:// URI
    return `doc://${withoutExt.toLowerCase().replace(/\//g, '/')}`;
  }
}
