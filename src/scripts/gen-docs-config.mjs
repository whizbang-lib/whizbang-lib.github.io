#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateDocsConfig() {
  const docsPath = join(__dirname, '../assets/docs');
  const configDir = join(__dirname, '../app/config');
  
  try {
    // Ensure config directory exists
    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }
    
    // Read all markdown files
    const files = await readdir(docsPath);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    
    console.log(`Found ${markdownFiles.length} markdown files:`, markdownFiles);
    
    const docsConfig = [];
    
    for (const file of markdownFiles) {
      const slug = file.replace('.md', '');
      const filePath = join(docsPath, file);
      
      try {
        const content = await readFile(filePath, 'utf-8');
        const metadata = extractMetadata(content, slug);
        docsConfig.push(metadata);
        console.log(`Processed: ${file} -> ${metadata.title} (${metadata.category || 'No category'})`);
      } catch (error) {
        console.warn(`Warning: Could not read ${file}:`, error.message);
      }
    }
    
    // Sort by category and order
    docsConfig.sort((a, b) => {
      if (a.category !== b.category) {
        return (a.category || 'zzz').localeCompare(b.category || 'zzz');
      }
      return (a.order || 999) - (b.order || 999);
    });
    
    // Generate TypeScript config
    const configContent = `// Auto-generated docs configuration
// Run 'npm run gen-docs' to regenerate this file

export const DOCS_CONFIG = ${JSON.stringify(docsConfig, null, 2)};
`;
    
    const configPath = join(configDir, 'docs.config.ts');
    await writeFile(configPath, configContent);
    
    console.log('✅ Generated docs configuration:');
    console.log(`   - ${docsConfig.length} documents found`);
    console.log(`   - Configuration saved to: ${configPath}`);
    
  } catch (error) {
    console.error('❌ Error generating docs config:', error);
    process.exit(1);
  }
}

function extractMetadata(content, slug) {
  const metadata = {
    slug,
    title: null,
    category: null,
    order: null
  };
  
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    
    // Extract title
    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim().replace(/['"]/g, '');
    }
    
    // Extract category
    const categoryMatch = frontmatter.match(/^category:\s*(.+)$/m);
    if (categoryMatch) {
      metadata.category = categoryMatch[1].trim().replace(/['"]/g, '');
    }
    
    // Extract order
    const orderMatch = frontmatter.match(/^order:\s*(\d+)$/m);
    if (orderMatch) {
      metadata.order = parseInt(orderMatch[1]);
    }
  }
  
  // Fall back to first H1 for title
  if (!metadata.title) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      metadata.title = h1Match[1].trim();
    } else {
      // Generate title from slug as last resort
      metadata.title = slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  }
  
  return metadata;
}

generateDocsConfig();
