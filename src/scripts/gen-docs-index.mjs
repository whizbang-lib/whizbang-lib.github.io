import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const DOC_DIR = 'src/assets/docs';
const out = [];

// Map kebab-case folder names to display names
const FOLDER_DISPLAY_NAMES = {
  'advanced': 'Advanced',
  'architecture-design': 'Architecture & Design',
  'commands': 'Commands',
  'contributors': 'Contributors',
  'core-concepts': 'Core Concepts',
  'design': 'Design',
  'examples': 'Examples',
  'getting-started': 'Getting Started',
  'observability': 'Observability',
  'projections': 'Projections',
  'roadmap': 'Roadmap'
};

async function processDirectory(dir, relativeDir = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      await processDirectory(fullPath, relativePath);
    } else if (entry.name.endsWith('.md')) {
      const { data } = matter(await fs.readFile(fullPath, 'utf8'));
      const filename = path.basename(entry.name, '.md');
      const slug = data.slug || (relativeDir ? `${relativeDir}/${filename}` : filename);
      
      // Determine category - use file's category or infer from folder
      let category = data.category;
      if (!category && relativeDir) {
        const folderName = relativeDir.split('/')[0]; // Get first folder in path
        category = FOLDER_DISPLAY_NAMES[folderName] || folderName;
      }
      
      // Create clean index routes for files that match their folder name
      let finalSlug = slug;
      if (relativeDir && filename === relativeDir.split('/')[0]) {
        // This is an index file (e.g., getting-started/getting-started.md)
        finalSlug = relativeDir.split('/')[0]; // Use just the folder name
      }
      
      out.push({
        slug: finalSlug,
        title: data.title || filename,
        category: category,
        order: data.order,
        videos: data.videos ?? [],
        examples: data.examples ?? []
      });
    }
  }
}

await processDirectory(DOC_DIR);

await fs.writeFile(
  'src/assets/docs-index.json',
  JSON.stringify(out, null, 2)
);
console.log('docs-index.json generated with', out.length, 'entries');