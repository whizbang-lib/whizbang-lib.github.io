#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateProductionDocsConfig() {
  const docsPath = join(__dirname, '../assets/docs');
  const outputPath = join(__dirname, '../assets/docs-config.json');
  
  try {
    console.log('🏭 Generating production docs configuration...');
    
    // Read all markdown files
    const files = await readdir(docsPath);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    
    const docsConfig = [];
    
    for (const file of markdownFiles) {
      const slug = file.replace('.md', '');
      const filePath = join(docsPath, file);
      
      try {
        const content = await readFile(filePath, 'utf-8');
        const metadata = extractMetadata(content, slug);
        docsConfig.push(metadata);
        console.log(`✅ Processed: ${file} -> ${metadata.title}`);
      } catch (error) {
        console.warn(`⚠️  Warning: Could not read ${file}:`, error.message);
      }
    }
    
    // Sort by category and order
    docsConfig.sort((a, b) => {
      if (a.category !== b.category) {
        return (a.category || 'zzz').localeCompare(b.category || 'zzz');
      }
      return (a.order || 999) - (b.order || 999);
    });
    
    // Write JSON configuration for production
    await writeFile(outputPath, JSON.stringify(docsConfig, null, 2));
    
    console.log('🎉 Production docs configuration generated:');
    console.log(`   - ${docsConfig.length} documents processed`);
    console.log(`   - Configuration saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error generating production docs config:', error);
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

generateProductionDocsConfig();
