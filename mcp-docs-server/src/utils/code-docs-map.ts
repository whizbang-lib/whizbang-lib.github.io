import { readFileSync } from 'fs';
import path from 'path';

export interface CodeDocsMapping {
  file: string;
  line: number;
  symbol: string;
  docs: string;
}

export type CodeDocsMap = Record<string, CodeDocsMapping>;

/**
 * Loads the code-docs mapping from JSON file
 */
export function loadCodeDocsMap(assetsPath: string): CodeDocsMap {
  const mapPath = path.join(assetsPath, 'code-docs-map.json');

  try {
    const content = readFileSync(mapPath, 'utf-8');
    return JSON.parse(content) as CodeDocsMap;
  } catch (error) {
    console.error(`Failed to load code-docs map from ${mapPath}:`, error);
    return {};
  }
}

/**
 * Finds code location by documentation URL or concept name
 */
export function findCodeByDocs(map: CodeDocsMap, docsUrlOrConcept: string): CodeDocsMapping | null {
  // Normalize input (remove leading slash, version prefix)
  const normalized = docsUrlOrConcept
    .replace(/^\/+/, '')
    .replace(/^v[\d.]+\//, '')
    .replace(/\.md$/, '');

  // Search for matching docs URL
  for (const [, mapping] of Object.entries(map)) {
    if (mapping.docs === normalized || mapping.docs.includes(normalized)) {
      return mapping;
    }
  }

  return null;
}

/**
 * Finds documentation URL by symbol name
 */
export function findDocsBySymbol(map: CodeDocsMap, symbol: string): CodeDocsMapping | null {
  return map[symbol] || null;
}

/**
 * Validates all documentation links
 */
export function validateLinks(map: CodeDocsMap, validDocsUrls: Set<string>): {
  valid: number;
  broken: number;
  details: Array<{ symbol: string; docs: string; status: 'valid' | 'broken' }>;
} {
  const details: Array<{ symbol: string; docs: string; status: 'valid' | 'broken' }> = [];
  let valid = 0;
  let broken = 0;

  for (const [symbol, mapping] of Object.entries(map)) {
    const isValid = validDocsUrls.has(mapping.docs);

    if (isValid) {
      valid++;
    } else {
      broken++;
    }

    details.push({
      symbol,
      docs: mapping.docs,
      status: isValid ? 'valid' : 'broken'
    });
  }

  return { valid, broken, details };
}
