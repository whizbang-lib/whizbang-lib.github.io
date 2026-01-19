import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { FileLoader } from '../utils/file-loader.js';
import { parseMarkdown, getDocTitle, getDocDescription, createResourceMetadata, isRoadmapDoc } from '../utils/frontmatter.js';
import { parseUri, uriToFilePath } from '../utils/uri-parser.js';

/**
 * List all roadmap resources (roadmap:// URIs)
 */
export async function listRoadmapResources(fileLoader: FileLoader): Promise<Resource[]> {
  const docFiles = await fileLoader.listDocFiles();
  const resources: Resource[] = [];

  for (const file of docFiles) {
    // Only process roadmap URIs
    if (!file.uri.startsWith('roadmap://')) {
      // Also check regular docs that might be marked as unreleased
      if (file.uri.startsWith('doc://')) {
        try {
          const content = await fileLoader.readDocFile(file.path);
          const parsed = parseMarkdown(content);

          if (isRoadmapDoc(parsed.frontmatter)) {
            // This is a roadmap doc in the regular docs folder
            const title = getDocTitle(parsed.frontmatter, file.path);
            const description = getDocDescription(parsed.frontmatter, parsed.excerpt);

            const metadata = createResourceMetadata(parsed.frontmatter);
            metadata.warning = 'This feature is not yet released';

            resources.push({
              uri: file.uri.replace('doc://', 'roadmap://'),
              name: `[Roadmap] ${title}`,
              mimeType: 'text/markdown',
              description: description || `Planned feature: ${title}`,
              metadata
            });
          }
        } catch (error) {
          console.error(`Failed to check roadmap status for ${file.path}:`, error);
        }
      }
      continue;
    }

    try {
      const content = await fileLoader.readDocFile(file.path);
      const parsed = parseMarkdown(content);

      const title = getDocTitle(parsed.frontmatter, file.path);
      const description = getDocDescription(parsed.frontmatter, parsed.excerpt);

      const metadata = createResourceMetadata(parsed.frontmatter);
      metadata.warning = 'This feature is not yet released';

      // Add status badge to name
      const statusBadge = parsed.frontmatter.status
        ? `[${parsed.frontmatter.status.toUpperCase()}]`
        : '[PLANNED]';

      resources.push({
        uri: file.uri,
        name: `${statusBadge} ${title}`,
        mimeType: 'text/markdown',
        description: description || `Planned feature: ${title}`,
        metadata
      });
    } catch (error) {
      console.error(`Failed to process roadmap doc ${file.path}:`, error);
    }
  }

  // Sort by status and order
  resources.sort((a, b) => {
    const statusOrder: Record<string, number> = {
      'experimental': 1,
      'in-development': 2,
      'planned': 3
    };

    const metaA = a.metadata as Record<string, any> || {};
    const metaB = b.metadata as Record<string, any> || {};
    const statusA = (metaA['status'] as string) || 'planned';
    const statusB = (metaB['status'] as string) || 'planned';
    const orderA = (metaA['order'] as number) || 999;
    const orderB = (metaB['order'] as number) || 999;

    const statusComparison = (statusOrder[statusA] || 999) - (statusOrder[statusB] || 999);
    if (statusComparison !== 0) {
      return statusComparison;
    }

    return orderA - orderB;
  });

  return resources;
}

/**
 * Read a specific roadmap resource by URI
 */
export async function readRoadmapResource(uri: string, fileLoader: FileLoader): Promise<string> {
  try {
    // Parse URI and convert to file path
    const parsed = parseUri(uri);

    if (parsed.scheme !== 'roadmap') {
      throw new Error(`Invalid scheme for roadmap resource: ${parsed.scheme}`);
    }

    const filePath = uriToFilePath(uri);

    // Read the file
    const content = await fileLoader.readDocFile(filePath);

    // Add warning banner to content
    const warningBanner = `> **⚠️ ROADMAP FEATURE**
> This documentation describes a feature that is not yet released.
> The API and behavior described here may change before release.

---

`;

    return warningBanner + content;
  } catch (error) {
    throw new Error(`Failed to read roadmap resource ${uri}: ${error}`);
  }
}

/**
 * Filter roadmap resources by status
 */
export function filterRoadmapByStatus(
  resources: Resource[],
  status?: 'planned' | 'in-development' | 'experimental'
): Resource[] {
  if (!status) {
    return resources;
  }

  return resources.filter((r) => {
    const meta = r.metadata as Record<string, any> || {};
    return meta['status'] === status;
  });
}
