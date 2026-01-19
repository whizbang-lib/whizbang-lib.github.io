import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const DOC_DIR = 'src/assets/docs';
// Automatically discover all version folders (pattern: v*.*.*)
async function getVersionFolders() {
  const entries = await fs.readdir(DOC_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort(); // Sort versions
}
const STATE_FOLDERS = ['drafts', 'proposals', 'backlog', 'declined'];

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
  'roadmap': 'Roadmap',
  'usage-patterns': 'Usage Patterns'
};

async function processVersionDirectory(versionDir, version) {
  const out = [];
  
  console.log(`Processing version: ${version}`);
  
  // Read _folder.md if it exists to get version metadata
  let versionMetadata = {};
  try {
    const folderPath = path.join(versionDir, '_folder.md');
    const folderContent = await fs.readFile(folderPath, 'utf8');
    const { data } = matter(folderContent);
    versionMetadata = data;
  } catch (error) {
    console.warn(`No _folder.md found for ${version}`);
  }
  
  // Process all subdirectories and files
  await processDirectory(versionDir, '', version, out);
  
  return { version, metadata: versionMetadata, docs: out };
}

async function processStateDirectory(stateDir, state) {
  const out = [];
  
  console.log(`Processing state: ${state}`);
  
  // Read _folder.md if it exists to get state metadata
  let stateMetadata = {};
  try {
    const folderPath = path.join(stateDir, '_folder.md');
    const folderContent = await fs.readFile(folderPath, 'utf8');
    const { data } = matter(folderContent);
    stateMetadata = data;
  } catch (error) {
    console.warn(`No _folder.md found for ${state}`);
  }
  
  // Process all subdirectories and files
  await processDirectory(stateDir, '', state, out);
  
  return { state, metadata: stateMetadata, docs: out };
}

async function processDirectory(dir, relativeDir = '', versionOrState = '', out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    // Skip _folder.md files as they're processed separately
    if (entry.name === '_folder.md') continue;
    
    const fullPath = path.join(dir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      await processDirectory(fullPath, relativePath, versionOrState, out);
    } else if (entry.name.endsWith('.md')) {
      const content = await fs.readFile(fullPath, 'utf8');
      const { data, excerpt } = matter(content, { excerpt: true });
      const filename = path.basename(entry.name, '.md');
      
      // Build slug including version/state prefix
      const baseSlug = data.slug || (relativeDir ? `${relativeDir}/${filename}` : filename);
      const slug = `${versionOrState}/${baseSlug}`;
      
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
        finalSlug = `${versionOrState}/${relativeDir.split('/')[0]}`; // Use just the folder name with version
      }
      
      out.push({
        slug: finalSlug,
        title: data.title || filename.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        category: category || 'General',
        order: data.order || 999,
        description: data.description || excerpt || '',
        tags: data.tags || [],
        version: versionOrState,
        lastUpdated: data.lastUpdated,
        difficulty: data.difficulty,
        unreleased: data.unreleased,
        status: data.status,
        completionLevel: data.completionLevel
      });
    }
  }
}

async function generateVersionedDocsIndex() {
  try {
    const allVersions = [];
    
    // Discover and process version directories
    const versionFolders = await getVersionFolders();
    console.log(`Discovered version folders: ${versionFolders.join(', ')}`);
    
    for (const version of versionFolders) {
      const versionDir = path.join(DOC_DIR, version);
      try {
        await fs.access(versionDir);
        const versionData = await processVersionDirectory(versionDir, version);
        allVersions.push(versionData);
      } catch (error) {
        console.warn(`Version directory ${version} not found or inaccessible`);
      }
    }
    
    // Process state directories
    for (const state of STATE_FOLDERS) {
      const stateDir = path.join(DOC_DIR, state);
      try {
        await fs.access(stateDir);
        const stateData = await processStateDirectory(stateDir, state);
        allVersions.push(stateData);
      } catch (error) {
        console.warn(`State directory ${state} not found or inaccessible`);
      }
    }
    
    // Generate combined index for current production version (backwards compatibility)
    const productionVersion = allVersions.find(v => v.version === 'v1.0.0');
    if (productionVersion) {
      await fs.writeFile('src/assets/docs-index.json', JSON.stringify(productionVersion.docs, null, 2));
      console.log(`✅ Generated docs-index.json with ${productionVersion.docs.length} documents`);
    }
    
    // Generate versioned index with all versions
    await fs.writeFile('src/assets/docs-index-versioned.json', JSON.stringify(allVersions, null, 2));
    console.log(`✅ Generated docs-index-versioned.json with ${allVersions.length} versions/states`);
    
    // Generate summary statistics
    const totalDocs = allVersions.reduce((sum, v) => sum + (v.docs?.length || 0), 0);
    console.log(`📊 Total documents across all versions: ${totalDocs}`);
    
    allVersions.forEach(v => {
      const identifier = v.version || v.state;
      const count = v.docs?.length || 0;
      const status = v.metadata?.status || v.metadata?.state || 'unknown';
      console.log(`   - ${identifier}: ${count} docs (${status})`);
    });
    
  } catch (error) {
    console.error('❌ Error generating versioned docs index:', error);
    process.exit(1);
  }
}

generateVersionedDocsIndex();