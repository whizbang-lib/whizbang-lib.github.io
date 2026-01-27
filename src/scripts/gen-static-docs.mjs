#!/usr/bin/env node
/**
 * Generates a static, no-JavaScript documentation page for AI consumption.
 * Creates a hierarchical HTML page with all documentation content embedded.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const DOC_DIR = 'src/assets/docs';
const OUTPUT_DIR = 'src/static';
const OUTPUT_FILE = 'docs.html';

// Folders to process in order
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;
const STATE_FOLDERS = ['drafts', 'proposals', 'backlog'];
const SPECIAL_FOLDERS = ['migrate-from-marten-wolverine', 'roadmap'];

// Simple markdown to HTML conversion (basic but sufficient for AI)
function markdownToHtml(md) {
  return md
    // Code blocks (must be before inline code)
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Headers
    .replace(/^#{6}\s+(.*)$/gm, '<h6>$1</h6>')
    .replace(/^#{5}\s+(.*)$/gm, '<h5>$1</h5>')
    .replace(/^#{4}\s+(.*)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Unordered lists
    .replace(/^[\-\*]\s+(.*)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>')
    // Blockquotes
    .replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Paragraphs (lines with content not already tagged)
    .replace(/^(?!<[a-z])((?!^$).+)$/gm, '<p>$1</p>')
    // Clean up empty paragraphs
    .replace(/<p><\/p>/g, '')
    // Wrap consecutive list items
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getDirectories(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

async function getMarkdownFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== '_folder.md')
      .map(e => e.name);
  } catch {
    return [];
  }
}

async function processMarkdownFile(filePath, docPath) {
  const content = await fs.readFile(filePath, 'utf8');
  const { data, content: body } = matter(content);

  const title = data.title || path.basename(filePath, '.md').replace(/-/g, ' ');
  const description = data.description || '';

  return {
    path: docPath,
    title,
    description,
    content: body,
    frontmatter: data
  };
}

async function processDirectory(dir, basePath = '', depth = 0) {
  const results = {
    path: basePath,
    name: path.basename(dir),
    files: [],
    subdirs: []
  };

  // Get markdown files in this directory
  const mdFiles = await getMarkdownFiles(dir);
  for (const file of mdFiles.sort()) {
    const filePath = path.join(dir, file);
    const docPath = basePath ? `${basePath}/${file.replace('.md', '')}` : file.replace('.md', '');
    const doc = await processMarkdownFile(filePath, docPath);
    results.files.push(doc);
  }

  // Get subdirectories
  const subdirs = await getDirectories(dir);
  for (const subdir of subdirs.sort()) {
    // Skip internal-docs and hidden folders
    if (subdir === 'internal-docs' || subdir.startsWith('.')) continue;

    const subdirPath = path.join(dir, subdir);
    const subdirBasePath = basePath ? `${basePath}/${subdir}` : subdir;
    const subdirResults = await processDirectory(subdirPath, subdirBasePath, depth + 1);
    if (subdirResults.files.length > 0 || subdirResults.subdirs.length > 0) {
      results.subdirs.push(subdirResults);
    }
  }

  return results;
}

function generateTocHtml(tree, depth = 0) {
  let html = '';
  const indent = '  '.repeat(depth);

  if (tree.files.length > 0 || tree.subdirs.length > 0) {
    html += `${indent}<ul>\n`;

    // Files first
    for (const file of tree.files) {
      const anchor = slugify(file.path);
      html += `${indent}  <li><a href="#${anchor}">${escapeHtml(file.title)}</a></li>\n`;
    }

    // Then subdirectories
    for (const subdir of tree.subdirs) {
      const displayName = subdir.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      html += `${indent}  <li>\n`;
      html += `${indent}    <strong>${escapeHtml(displayName)}</strong>\n`;
      html += generateTocHtml(subdir, depth + 2);
      html += `${indent}  </li>\n`;
    }

    html += `${indent}</ul>\n`;
  }

  return html;
}

function generateContentHtml(tree, depth = 0) {
  let html = '';

  // Files
  for (const file of tree.files) {
    const anchor = slugify(file.path);
    const headerLevel = Math.min(depth + 2, 6);

    html += `<article id="${anchor}" class="doc-section">\n`;
    html += `  <h${headerLevel}>${escapeHtml(file.title)}</h${headerLevel}>\n`;
    html += `  <p class="doc-path"><code>${escapeHtml(file.path)}</code></p>\n`;
    if (file.description) {
      html += `  <p class="doc-description"><em>${escapeHtml(file.description)}</em></p>\n`;
    }
    html += `  <div class="doc-content">\n`;
    html += markdownToHtml(file.content);
    html += `  </div>\n`;
    html += `  <p><a href="#top">[Back to top]</a></p>\n`;
    html += `</article>\n\n`;
  }

  // Subdirectories
  for (const subdir of tree.subdirs) {
    const displayName = subdir.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const headerLevel = Math.min(depth + 2, 6);

    html += `<section class="doc-category">\n`;
    html += `  <h${headerLevel} class="category-header">${escapeHtml(displayName)}</h${headerLevel}>\n`;
    html += generateContentHtml(subdir, depth + 1);
    html += `</section>\n\n`;
  }

  return html;
}

async function generateStaticDocs() {
  console.log('Generating static documentation for AI consumption...\n');

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Collect all documentation
  const allDocs = {
    versions: [],
    states: [],
    special: []
  };

  // Get all folders in docs directory
  const allFolders = await getDirectories(DOC_DIR);

  // Process version folders
  const versionFolders = allFolders.filter(f => VERSION_PATTERN.test(f)).sort().reverse();
  for (const version of versionFolders) {
    console.log(`Processing version: ${version}`);
    const tree = await processDirectory(path.join(DOC_DIR, version), version);
    allDocs.versions.push({ name: version, tree });
  }

  // Process special folders (migration guides, etc.)
  for (const folder of SPECIAL_FOLDERS) {
    if (allFolders.includes(folder)) {
      console.log(`Processing special: ${folder}`);
      const tree = await processDirectory(path.join(DOC_DIR, folder), folder);
      allDocs.special.push({ name: folder, tree });
    }
  }

  // Process state folders
  for (const state of STATE_FOLDERS) {
    if (allFolders.includes(state)) {
      console.log(`Processing state: ${state}`);
      const tree = await processDirectory(path.join(DOC_DIR, state), state);
      allDocs.states.push({ name: state, tree });
    }
  }

  // Generate HTML
  const now = new Date().toISOString();

  let tocHtml = '';
  let contentHtml = '';

  // Versions
  if (allDocs.versions.length > 0) {
    tocHtml += '<h3>Released Versions</h3>\n';
    for (const { name, tree } of allDocs.versions) {
      tocHtml += `<h4>${name}</h4>\n`;
      tocHtml += generateTocHtml(tree);
    }

    contentHtml += '<section id="versions"><h2>Released Versions</h2>\n';
    for (const { name, tree } of allDocs.versions) {
      contentHtml += `<section id="${slugify(name)}"><h3>${name}</h3>\n`;
      contentHtml += generateContentHtml(tree);
      contentHtml += '</section>\n';
    }
    contentHtml += '</section>\n\n';
  }

  // Special (migration guides, etc.)
  if (allDocs.special.length > 0) {
    tocHtml += '<h3>Guides</h3>\n';
    for (const { name, tree } of allDocs.special) {
      const displayName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      tocHtml += `<h4>${displayName}</h4>\n`;
      tocHtml += generateTocHtml(tree);
    }

    contentHtml += '<section id="guides"><h2>Guides</h2>\n';
    for (const { name, tree } of allDocs.special) {
      const displayName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      contentHtml += `<section id="${slugify(name)}"><h3>${displayName}</h3>\n`;
      contentHtml += generateContentHtml(tree);
      contentHtml += '</section>\n';
    }
    contentHtml += '</section>\n\n';
  }

  // States (drafts, proposals)
  if (allDocs.states.length > 0) {
    tocHtml += '<h3>Development</h3>\n';
    for (const { name, tree } of allDocs.states) {
      const displayName = name.replace(/\b\w/g, c => c.toUpperCase());
      tocHtml += `<h4>${displayName}</h4>\n`;
      tocHtml += generateTocHtml(tree);
    }

    contentHtml += '<section id="development"><h2>Development</h2>\n';
    for (const { name, tree } of allDocs.states) {
      const displayName = name.replace(/\b\w/g, c => c.toUpperCase());
      contentHtml += `<section id="${slugify(name)}"><h3>${displayName}</h3>\n`;
      contentHtml += generateContentHtml(tree);
      contentHtml += '</section>\n';
    }
    contentHtml += '</section>\n\n';
  }

  // Count total docs
  function countDocs(tree) {
    let count = tree.files.length;
    for (const subdir of tree.subdirs) {
      count += countDocs(subdir);
    }
    return count;
  }

  let totalDocs = 0;
  for (const { tree } of [...allDocs.versions, ...allDocs.special, ...allDocs.states]) {
    totalDocs += countDocs(tree);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>Whizbang Documentation - Static Index</title>
  <meta name="description" content="Complete Whizbang documentation in a single static HTML page. Optimized for AI consumption and offline reading.">
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a1a;
      --code-bg: #f4f4f4;
      --border: #e0e0e0;
      --link: #0066cc;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --text: #e0e0e0;
        --code-bg: #2d2d2d;
        --border: #404040;
        --link: #66b3ff;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: var(--bg);
      color: var(--text);
    }
    a { color: var(--link); }
    code, pre {
      background: var(--code-bg);
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }
    code { padding: 2px 6px; font-size: 0.9em; }
    pre {
      padding: 16px;
      overflow-x: auto;
      border: 1px solid var(--border);
    }
    pre code { padding: 0; background: none; }
    .header {
      border-bottom: 2px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .quick-links {
      background: var(--code-bg);
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .quick-links ul { margin: 10px 0; padding-left: 20px; }
    nav {
      background: var(--code-bg);
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    nav ul { padding-left: 20px; margin: 5px 0; }
    nav li { margin: 3px 0; }
    .doc-section {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .doc-path { font-size: 0.85em; color: #666; }
    .doc-description { font-style: italic; color: #555; }
    .category-header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    blockquote {
      border-left: 4px solid var(--border);
      margin: 10px 0;
      padding-left: 20px;
      color: #666;
    }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid var(--border); padding: 8px; text-align: left; }
    th { background: var(--code-bg); }
    hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
    .stats { font-size: 0.9em; color: #666; }
  </style>
</head>
<body>
  <div id="top"></div>

  <header class="header">
    <h1>Whizbang Documentation</h1>
    <p>A comprehensive .NET library for building event-driven, CQRS, and event-sourced applications with zero reflection and AOT compatibility.</p>

    <div class="quick-links">
      <h3>Quick Links</h3>
      <ul>
        <li><strong>Library Source:</strong> <a href="https://github.com/whizbang-lib/whizbang">github.com/whizbang-lib/whizbang</a></li>
        <li><strong>VSCode Extension:</strong> <a href="https://github.com/whizbang-lib/whizbang-vscode">github.com/whizbang-lib/whizbang-vscode</a></li>
        <li><strong>Documentation Site:</strong> <a href="https://whizbang-lib.github.io">whizbang-lib.github.io</a></li>
        <li><strong>NuGet Packages:</strong> <a href="https://www.nuget.org/profiles/SoftwareExtravaganza">nuget.org/profiles/SoftwareExtravaganza</a></li>
      </ul>
    </div>

    <div class="quick-links">
      <h3>For AI Assistants: MCP Server</h3>
      <p>For enhanced documentation access, run the Whizbang MCP (Model Context Protocol) server locally with your AI assistant:</p>
      <pre><code># Clone and install
git clone https://github.com/whizbang-lib/whizbang-lib.github.io.git
cd whizbang-lib.github.io/mcp-docs-server
npm install && npm run build

# Add to your AI assistant's MCP configuration
# Claude Desktop: ~/.config/claude/claude_desktop_config.json
# Claude Code: claude mcp add whizbang-docs node /path/to/mcp-docs-server/build/index.js
# Other MCP-compatible AI tools: refer to their documentation
{
  "mcpServers": {
    "whizbang-docs": {
      "command": "node",
      "args": ["/path/to/mcp-docs-server/build/index.js"]
    }
  }
}

# Available MCP tools:
# - search-docs: Search documentation by query
# - find-examples: Find code examples by topic
# - get-code-location: Find library code implementing a concept
# - get-related-docs: Find docs for a code symbol
# - get-tests-for-code: Find tests for library code</code></pre>
    </div>

    <p class="stats">Generated: ${now} | Total documents: ${totalDocs}</p>
  </header>

  <nav>
    <h2>Table of Contents</h2>
${tocHtml}
  </nav>

  <main>
${contentHtml}
  </main>

  <footer style="border-top: 1px solid var(--border); margin-top: 40px; padding-top: 20px; text-align: center;">
    <p>Whizbang Documentation | <a href="https://github.com/whizbang-lib/whizbang">GitHub</a> | <a href="https://whizbang-lib.github.io">Interactive Site</a></p>
  </footer>
</body>
</html>`;

  // Write output
  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  await fs.writeFile(outputPath, html);

  console.log(`\n✅ Static documentation generated:`);
  console.log(`   - Output: ${outputPath}`);
  console.log(`   - Total documents: ${totalDocs}`);
  console.log(`   - Versions: ${allDocs.versions.map(v => v.name).join(', ') || 'none'}`);
  console.log(`   - Guides: ${allDocs.special.map(s => s.name).join(', ') || 'none'}`);
  console.log(`   - Development: ${allDocs.states.map(s => s.name).join(', ') || 'none'}`);
}

generateStaticDocs().catch(err => {
  console.error('Error generating static docs:', err);
  process.exit(1);
});
