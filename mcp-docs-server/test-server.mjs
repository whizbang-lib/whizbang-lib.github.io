#!/usr/bin/env node

/**
 * Test script to verify MCP server functionality
 * This tests the resource handlers directly
 */

import { FileLoader } from './build/utils/file-loader.js';
import { listDocsResources, readDocsResource } from './build/resources/docs-resources.js';
import { listRoadmapResources } from './build/resources/roadmap-resources.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testServer() {
  console.log('🧪 Testing Whizbang MCP Docs Server...\n');

  // Validate the PACKAGED artifact (bundled-assets, which carries the generated
  // indexes like docs-list.json) when present — that's what npm consumers get,
  // and it's the only complete tree in CI (the repo's src/assets/*.json indexes
  // are gitignored). Fall back to the repo tree for local dev.
  const bundledDocs = path.join(__dirname, 'bundled-assets/docs');
  const repoDocs = path.join(__dirname, '../src/assets/docs');
  const config = {
    docsSource: 'local',
    docsPath: fs.existsSync(bundledDocs) ? bundledDocs : repoDocs,
    docsBaseUrl: 'https://whizba.ng'
  };

  console.log('📝 Configuration:', config);
  console.log('');

  const fileLoader = new FileLoader(config);
  let testsRun = 0;
  let testsPassed = 0;

  // Test 1: List documentation resources
  console.log('🔍 Test 1: Listing documentation resources...');
  try {
    const docs = await listDocsResources(fileLoader);
    console.log(`   Found ${docs.length} documentation resources`);

    if (docs.length > 0) {
      console.log(`   Sample: ${docs[0].uri} - ${docs[0].name}`);
      testsPassed++;
    } else {
      console.log('   ⚠️  Warning: No docs found');
    }
    testsRun++;
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    testsRun++;
  }
  console.log('');

  // Test 2: Read a specific documentation file
  console.log('🔍 Test 2: Reading specific documentation...');
  try {
    const content = await readDocsResource('doc://v1.0.0/getting-started/quick-start', fileLoader);

    // Assert it's a non-trivial markdown doc with an H1 — don't hardcode a
    // specific title (content evolves; a brittle string check masked the real
    // resolution as "invalid content").
    if (content && content.length > 200 && /^#\s+\S/m.test(content)) {
      console.log('   ✅ Successfully read v1.0.0/getting-started/quick-start.md');
      console.log(`   Content length: ${content.length} characters`);
      testsPassed++;
    } else {
      console.log('   ❌ Content appears invalid');
    }
    testsRun++;
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    testsRun++;
  }
  console.log('');

  // Test 3: List roadmap resources
  console.log('🔍 Test 3: Listing roadmap resources...');
  try {
    const roadmap = await listRoadmapResources(fileLoader);
    console.log(`   Found ${roadmap.length} roadmap resources`);

    if (roadmap.length > 0) {
      console.log(`   Sample: ${roadmap[0].uri} - ${roadmap[0].name}`);
    }
    testsPassed++;
    testsRun++;
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    testsRun++;
  }
  console.log('');

  // Summary
  console.log('═══════════════════════════════════════');
  console.log(`Tests run: ${testsRun}`);
  console.log(`Tests passed: ${testsPassed}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  if (testsPassed === testsRun) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }

  console.log('');
  console.log('To test interactively, use MCP Inspector:');
  console.log('  npm run inspector');
  console.log('');
  console.log('Or add to Claude Code:');
  console.log('  claude mcp add whizbang-docs \\');
  console.log('    -e DOCS_SOURCE=local \\');
  console.log(`    -e DOCS_PATH=${config.docsPath} \\`);
  console.log(`    -- node ${path.join(__dirname, 'build/index.js')}`);
}

testServer().catch((error) => {
  console.error('❌ Test failed with exception:', error);
  process.exit(1);
});
