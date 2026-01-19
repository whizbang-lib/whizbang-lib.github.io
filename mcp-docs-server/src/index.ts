#!/usr/bin/env node

import { McpDocsServer, McpDocsServerConfig } from './server.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse environment variables
const docsSource = (process.env.DOCS_SOURCE || 'local') as 'local' | 'remote';
const docsPath = process.env.DOCS_PATH || path.join(__dirname, '../../src/assets/docs');
const docsBaseUrl = process.env.DOCS_BASE_URL || 'https://whizbang-lib.github.io';
const searchIndexPath = process.env.SEARCH_INDEX_PATH || path.join(__dirname, '../../src/assets');
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
