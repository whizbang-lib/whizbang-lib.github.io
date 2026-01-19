#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SITE_URL = 'https://whizbang-lib.github.io';

function generateSitemap() {
  try {
    // Read the docs index
    const docsIndexPath = join(__dirname, '../assets/docs-index.json');
    const docsIndex = JSON.parse(readFileSync(docsIndexPath, 'utf8'));
    
    // Get current date in ISO format for lastmod
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Start XML sitemap
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    // Add homepage
    sitemap += '  <url>\n';
    sitemap += `    <loc>${SITE_URL}</loc>\n`;
    sitemap += `    <lastmod>${currentDate}</lastmod>\n`;
    sitemap += '    <changefreq>weekly</changefreq>\n';
    sitemap += '    <priority>1.0</priority>\n';
    sitemap += '  </url>\n';
    
    // Add documentation pages
    for (const doc of docsIndex) {
      const url = `${SITE_URL}/docs/${doc.slug}`;
      
      // Determine priority based on category and content
      let priority = '0.8'; // Default for documentation pages
      
      // Higher priority for key pages
      if (doc.category === 'Getting Started') {
        priority = '0.9';
      } else if (doc.category === 'Core Concepts') {
        priority = '0.9';
      } else if (doc.category === 'Architecture & Design') {
        priority = '0.8';
      } else if (doc.category === 'Roadmap') {
        priority = '0.6'; // Lower priority for future features
      }
      
      // Determine change frequency based on category
      let changefreq = 'monthly';
      if (doc.category === 'Getting Started' || doc.category === 'Core Concepts') {
        changefreq = 'weekly'; // More stable, foundational content
      } else if (doc.category === 'Roadmap') {
        changefreq = 'weekly'; // Roadmap items change frequently
      }
      
      sitemap += '  <url>\n';
      sitemap += `    <loc>${url}</loc>\n`;
      sitemap += `    <lastmod>${currentDate}</lastmod>\n`;
      sitemap += `    <changefreq>${changefreq}</changefreq>\n`;
      sitemap += `    <priority>${priority}</priority>\n`;
      sitemap += '  </url>\n';
    }
    
    // Close XML sitemap
    sitemap += '</urlset>\n';
    
    // Write sitemap to public directory
    const sitemapPath = join(__dirname, '../assets/sitemap.xml');
    writeFileSync(sitemapPath, sitemap, 'utf8');
    
    console.log(`✅ Generated sitemap with ${docsIndex.length + 1} URLs at ${sitemapPath}`);
    console.log(`📄 Homepage: ${SITE_URL}`);
    console.log(`📚 Documentation pages: ${docsIndex.length}`);
    
    // Show a sample of the generated URLs
    console.log('\n📋 Sample URLs:');
    console.log(`   ${SITE_URL} (priority: 1.0)`);
    docsIndex.slice(0, 3).forEach(doc => {
      const priority = doc.category === 'Getting Started' ? '0.9' : '0.8';
      console.log(`   ${SITE_URL}/docs/${doc.slug} (priority: ${priority})`);
    });
    
    if (docsIndex.length > 3) {
      console.log(`   ... and ${docsIndex.length - 3} more documentation pages`);
    }
    
  } catch (error) {
    console.error('❌ Error generating sitemap:', error);
    process.exit(1);
  }
}

// Run the generator
generateSitemap();