#!/usr/bin/env node

import { McpDocsServer, McpDocsServerConfig } from './server.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Docs asset resolution, in order:
//   1. DOCS_PATH env — contributor mode, point at a docs-repo checkout
//   2. Repo-sibling layout — running from a checkout of the docs repo
//   3. bundled-assets/ — npm-installed consumer mode (snapshot bundled at
//      publish time; live test-status is always fetched remotely)
const repoDocsPath = path.join(__dirname, '../../src/assets/docs');
const bundledDocsPath = path.join(__dirname, '../bundled-assets/docs');
const resolvedDocsPath =
  process.env.DOCS_PATH ??
  (fs.existsSync(repoDocsPath) ? repoDocsPath : fs.existsSync(bundledDocsPath) ? bundledDocsPath : repoDocsPath);
const resolvedAssetsPath = path.join(resolvedDocsPath, '..');

// Parse environment variables
const docsSource = (process.env.DOCS_SOURCE || 'local') as 'local' | 'remote';
const docsPath = resolvedDocsPath;
const docsBaseUrl = process.env.DOCS_BASE_URL || 'https://whizba.ng';
const searchIndexPath = process.env.SEARCH_INDEX_PATH || resolvedAssetsPath;
const enableSemanticSearch = process.env.ENABLE_SEMANTIC_SEARCH !== 'false';

// Build configuration
const config: McpDocsServerConfig = {
  docsSource,
  docsPath,
  docsBaseUrl,
  searchIndexPath,
  enableSemanticSearch
};

// Create and start server
const server = new McpDocsServer(config);

async function main() {
  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Shutting down MCP server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down MCP server...');
  process.exit(0);
});

main();
