import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const DOC_DIR = 'src/assets/docs';
const out = [];

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
      
      out.push({
        slug: slug,
        title: data.title || filename,
        category: data.category,
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