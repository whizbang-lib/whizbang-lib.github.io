#!/usr/bin/env node

/**
 * Generates a unified JSON feed for the Whizbang VSCode extension.
 *
 * Combines:
 * - code-docs-map.json (symbol → documentation path)
 * - code-tests-map.json (symbol → test locations)
 * - docs-index-versioned.json (doc metadata for titles)
 *
 * Output: src/assets/vscode-feed.json (copied to dist during build)
 *
 * Published at: https://whizbang-lib.github.io/assets/vscode-feed.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ASSETS_DIR = resolve(__dirname, '../assets');
const CODE_DOCS_MAP = resolve(ASSETS_DIR, 'code-docs-map.json');
const CODE_TESTS_MAP = resolve(ASSETS_DIR, 'code-tests-map.json');
const DOCS_INDEX = resolve(ASSETS_DIR, 'docs-index-versioned.json');
const OUTPUT_PATH = resolve(ASSETS_DIR, 'vscode-feed.json');

const BASE_URL = 'https://whizbang-lib.github.io/docs';
const DOCS_VERSION = 'v1.0.0';

function loadJson(filePath, description) {
  if (!existsSync(filePath)) {
    console.warn(`Warning: ${description} not found at ${filePath}`);
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Build a slug-to-title lookup from the versioned docs index.
 * The index is an array of version objects, each with a docs array.
 */
function buildTitleLookup(docsIndex) {
  const lookup = {};
  if (!docsIndex || !Array.isArray(docsIndex)) {
    return lookup;
  }

  for (const versionEntry of docsIndex) {
    if (!versionEntry.docs) continue;
    for (const doc of versionEntry.docs) {
      // Strip version prefix from slug for matching against code-docs paths
      // e.g., "v1.0.0/fundamentals/dispatcher/dispatcher" → "fundamentals/dispatcher/dispatcher"
      const slug = doc.slug || '';
      const versionPrefix = (versionEntry.version || '') + '/';
      const strippedSlug = slug.startsWith(versionPrefix)
        ? slug.substring(versionPrefix.length)
        : slug;

      if (strippedSlug && doc.title) {
        lookup[strippedSlug] = doc.title;
      }
    }
  }

  return lookup;
}

/**
 * Build a symbol-to-tests lookup from the code-tests map.
 * The map has { codeToTests: { symbolName: [{ testFile, testMethod, linkSource }] } }
 */
function buildTestsLookup(codeTestsMap) {
  if (!codeTestsMap || !codeTestsMap.codeToTests) {
    return {};
  }
  return codeTestsMap.codeToTests;
}

function main() {
  console.log('Generating VSCode extension feed...');

  // Load source data
  const codeDocsMap = loadJson(CODE_DOCS_MAP, 'code-docs-map.json');
  const codeTestsMap = loadJson(CODE_TESTS_MAP, 'code-tests-map.json');
  const docsIndex = loadJson(DOCS_INDEX, 'docs-index-versioned.json');

  if (!codeDocsMap) {
    console.error('Error: code-docs-map.json is required. Run generate-code-docs-map.mjs first.');
    process.exit(1);
  }

  const titleLookup = buildTitleLookup(docsIndex);
  const testsLookup = buildTestsLookup(codeTestsMap);

  // Build the feed
  const types = {};

  for (const [symbolName, entry] of Object.entries(codeDocsMap)) {
    const docsPath = entry.docs;

    // Strip fragment for title lookup (e.g., "messaging/transports/rabbitmq#connection-retry" → "messaging/transports/rabbitmq")
    const pathWithoutFragment = docsPath.split('#')[0];
    const title = titleLookup[pathWithoutFragment] || '';

    // Find tests for this symbol
    const tests = testsLookup[symbolName] || [];
    const testMethods = tests.map(t => `${t.testFile}:${t.testMethod}`);

    types[symbolName] = {
      docs: docsPath,
      title: title,
      file: entry.file,
      line: entry.line,
    };

    // Only include tests if there are any (keep feed compact)
    if (testMethods.length > 0) {
      types[symbolName].tests = testMethods;
    }
  }

  const feed = {
    version: '1.0',
    generated: new Date().toISOString(),
    baseUrl: BASE_URL,
    docsVersion: DOCS_VERSION,
    types: types,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(feed, null, 2), 'utf-8');

  console.log(`VSCode feed written to: ${OUTPUT_PATH}`);
  console.log(`Total types: ${Object.keys(types).length}`);
  console.log(`Types with titles: ${Object.values(types).filter(t => t.title).length}`);
  console.log(`Types with tests: ${Object.values(types).filter(t => t.tests).length}`);
}

main();
