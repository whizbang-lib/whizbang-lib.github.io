import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { FileLoader } from '../utils/file-loader.js';
import { parseMarkdown, getDocTitle, getDocDescription, createResourceMetadata, isRoadmapDoc } from '../utils/frontmatter.js';
import { parseUri, uriToFilePath } from '../utils/uri-parser.js';

/**
 * List all documentation resources (doc:// URIs)
 */
export async function listDocsResources(fileLoader: FileLoader): Promise<Resource[]> {
  const docFiles = await fileLoader.listDocFiles();
  const resources: Resource[] = [];

  for (const file of docFiles) {
    // Skip roadmap docs (they have their own handler)
    if (file.uri.startsWith('roadmap://')) {
      continue;
    }

    try {
      const content = await fileLoader.readDocFile(file.path);
      const parsed = parseMarkdown(content);

      // Skip unreleased docs in the regular docs listing
      if (isRoadmapDoc(parsed.frontmatter)) {
        continue;
      }

      const title = getDocTitle(parsed.frontmatter, file.path);
      const description = getDocDescription(parsed.frontmatter, parsed.excerpt);

      resources.push({
        uri: file.uri,
        name: title,
        mimeType: 'text/markdown',
        description: description || `Documentation: ${title}`,
        metadata: createResourceMetadata(parsed.frontmatter)
      });
    } catch (error) {
      console.error(`Failed to process doc ${file.path}:`, error);
      // Continue with other files
    }
  }

  // Sort by category and order
  resources.sort((a, b) => {
    const metaA = a.metadata as Record<string, any> || {};
    const metaB = b.metadata as Record<string, any> || {};
    const categoryA = (metaA['category'] as string) || '';
    const categoryB = (metaB['category'] as string) || '';
    const orderA = (metaA['order'] as number) || 999;
    const orderB = (metaB['order'] as number) || 999;

    if (categoryA !== categoryB) {
      return categoryA.localeCompare(categoryB);
    }
    return orderA - orderB;
  });

  return resources;
}

/**
 * Read a specific documentation resource by URI
 */
export async function readDocsResource(uri: string, fileLoader: FileLoader): Promise<string> {
  try {
    // Parse URI and convert to file path
    const parsed = parseUri(uri);

    if (parsed.scheme !== 'doc') {
      throw new Error(`Invalid scheme for docs resource: ${parsed.scheme}`);
    }

    const filePath = uriToFilePath(uri);

    // Read the file
    const content = await fileLoader.readDocFile(filePath);

    // Parse and validate
    const doc = parseMarkdown(content);

    // Check if this is actually a roadmap doc
    if (isRoadmapDoc(doc.frontmatter)) {
      throw new Error('This is a roadmap document. Use roadmap:// URI instead.');
    }

    return content;
  } catch (error) {
    throw new Error(`Failed to read documentation resource ${uri}: ${error}`);
  }
}

/**
 * Get documentation resource metadata
 */
export async function getDocsResourceMetadata(uri: string, fileLoader: FileLoader) {
  const filePath = uriToFilePath(uri);
  const content = await fileLoader.readDocFile(filePath);
  const parsed = parseMarkdown(content);

  return {
    title: getDocTitle(parsed.frontmatter, filePath),
    description: getDocDescription(parsed.frontmatter, parsed.excerpt),
    frontmatter: parsed.frontmatter,
    isRoadmap: isRoadmapDoc(parsed.frontmatter)
  };
}
