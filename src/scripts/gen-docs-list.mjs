#!/usr/bin/env node

import { readdir, writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function findMarkdownFiles(dir, baseDir = dir) {
  const files = [];
  const items = await readdir(dir);
  
  for (const item of items) {
    // Skip internal-docs folder - not included in public site
    if (item === 'internal-docs') {
      console.log(`⏭️  Skipping internal-docs folder (not included in public site)`);
      continue;
    }
    
    const fullPath = join(dir, item);
    const statResult = await stat(fullPath);
    
    if (statResult.isDirectory()) {
      files.push(...await findMarkdownFiles(fullPath, baseDir));
    } else if (item.endsWith('.md')) {
      const relativePath = fullPath.replace(baseDir + '/', '');
      const slug = relativePath.replace(/\.md$/, '').replace(/\\/g, '/');
      files.push(slug);
    }
  }
  
  return files;
}

async function generateDocsList() {
  const docsPath = join(__dirname, '../assets/docs');
  const outputPath = join(__dirname, '../assets/docs-list.json');
  
  try {
    // Find all markdown files recursively
    const markdownFiles = await findMarkdownFiles(docsPath);
    
    console.log(`Found ${markdownFiles.length} markdown files:`, markdownFiles);
    
    // Write the list as JSON
    await writeFile(outputPath, JSON.stringify(markdownFiles, null, 2));
    
    console.log('✅ Generated docs list:');
    console.log(`   - ${markdownFiles.length} documents found`);
    console.log(`   - List saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error generating docs list:', error);
    process.exit(1);
  }
}

generateDocsList();
