#!/usr/bin/env node

import { watch } from 'fs';
import { readdir, writeFile } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimpleDocsWatcher {
  constructor() {
    this.docsPath = join(__dirname, '../assets/docs');
    this.outputPath = join(__dirname, '../assets/docs-list.json');
  }

  async start() {
    console.log('📁 Starting simple docs watcher...');
    console.log(`   Watching: ${this.docsPath}`);
    
    // Generate initial docs list
    await this.updateDocsList();
    
    // Watch for any changes in the docs directory
    watch(this.docsPath, { recursive: true }, async (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log(`📝 File ${eventType}: ${filename}`);
        await this.updateDocsList();
      }
    });
    
    console.log('👀 Watching for markdown file changes...');
  }

  async updateDocsList() {
    try {
      const markdownFiles = await this.findMarkdownFiles(this.docsPath);
      await writeFile(this.outputPath, JSON.stringify(markdownFiles, null, 2));
      console.log(`✅ Updated docs-list.json with ${markdownFiles.length} files`);
      
    } catch (error) {
      console.error('❌ Error updating docs list:', error);
    }
  }

  async findMarkdownFiles(dir, relativePath = '') {
    const results = [];
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await this.findMarkdownFiles(fullPath, entryRelativePath);
        results.push(...subFiles);
      } else if (entry.name.endsWith('.md')) {
        // Add markdown file (without .md extension, with path)
        const slug = entryRelativePath.replace('.md', '');
        results.push(slug);
      }
    }
    
    return results.sort();
  }
}

const watcher = new SimpleDocsWatcher();
watcher.start();
