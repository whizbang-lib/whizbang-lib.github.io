#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { AIContentEnhancer } from './ai-enhance-content.mjs';

const DOCS_DIR = 'src/assets/docs';
const OUTPUT_FILE = 'src/assets/search-index.json';
const ENHANCED_OUTPUT_FILE = 'src/assets/enhanced-search-index.json';

function extractFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, content };
  }
  
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, content };
  }
  
  const frontmatterText = content.substring(3, endIndex).trim();
  const bodyContent = content.substring(endIndex + 3).trim();
  
  // Simple YAML parser for our needs
  const frontmatter = {};
  frontmatterText.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim().replace(/['"]/g, '');
      frontmatter[key] = value;
    }
  });
  
  return { frontmatter, content: bodyContent };
}

function extractKeywords(text, frontmatter) {
  const keywords = new Set();
  
  // Add frontmatter keywords
  if (frontmatter.keywords) {
    frontmatter.keywords.split(',').forEach(k => keywords.add(k.trim().toLowerCase()));
  }
  
  if (frontmatter.tags) {
    frontmatter.tags.split(',').forEach(t => keywords.add(t.trim().toLowerCase()));
  }
  
  // Extract key phrases and terms from content
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const wordFreq = {};
  
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1;
  });
  
  // Add frequently mentioned words as keywords
  Object.entries(wordFreq)
    .filter(([word, freq]) => freq > 2 && word.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([word]) => keywords.add(word));
  
  return Array.from(keywords);
}

function createSmartChunks(content, title = '', chunkSize = 300, overlap = 50) {
  // Split by sentences first to avoid breaking mid-sentence
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = content.split(/\s+/);
  const chunks = [];
  
  if (words.length <= chunkSize) {
    // If content is short enough, return as single chunk
    return [{
      text: content,
      startIndex: 0,
      wordCount: words.length,
      importance: title ? 1.0 : 0.8 // Higher importance if it's a titled section
    }];
  }
  
  let currentChunk = '';
  let currentWordCount = 0;
  let startIndex = 0;
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    const sentenceWords = sentence.split(/\s+/);
    
    if (currentWordCount + sentenceWords.length > chunkSize && currentChunk) {
      // Save current chunk
      chunks.push({
        text: currentChunk.trim(),
        startIndex,
        wordCount: currentWordCount,
        importance: calculateChunkImportance(currentChunk, title)
      });
      
      // Start new chunk with overlap
      const overlapWords = Math.min(overlap, currentWordCount);
      const chunkWords = currentChunk.split(/\s+/);
      currentChunk = chunkWords.slice(-overlapWords).join(' ') + ' ' + sentence;
      currentWordCount = overlapWords + sentenceWords.length;
      startIndex = content.indexOf(sentence);
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentWordCount += sentenceWords.length;
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      startIndex,
      wordCount: currentWordCount,
      importance: calculateChunkImportance(currentChunk, title)
    });
  }
  
  return chunks;
}

function calculateChunkImportance(chunk, title) {
  let importance = 0.5; // Base importance
  
  // Higher importance for chunks containing title words
  if (title) {
    const titleWords = title.toLowerCase().split(/\s+/);
    const chunkLower = chunk.toLowerCase();
    const titleWordMatches = titleWords.filter(word => chunkLower.includes(word)).length;
    importance += (titleWordMatches / titleWords.length) * 0.3;
  }
  
  // Higher importance for chunks with code examples
  if (chunk.includes('```') || chunk.includes('`')) {
    importance += 0.2;
  }
  
  // Higher importance for chunks with headings (remaining #)
  if (chunk.includes('#')) {
    importance += 0.1;
  }
  
  // Higher importance for longer chunks (more content)
  const wordCount = chunk.split(/\s+/).length;
  if (wordCount > 100) {
    importance += 0.1;
  }
  
  return Math.min(importance, 1.0);
}

function findMarkdownFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    // Skip internal-docs folder - not included in public site search
    if (item === 'internal-docs') {
      console.log(`⏭️  Skipping internal-docs folder (not included in search index)`);
      continue;
    }
    
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath, baseDir));
    } else if (item.endsWith('.md')) {
      const relativePath = path.relative(baseDir, fullPath);
      const slug = relativePath.replace(/\.md$/, '').replace(/\\/g, '/');
      files.push({ slug, fullPath });
    }
  }
  
  return files;
}

async function generateEnhancedSearchIndex() {
  const searchIndex = [];
  const enhancedIndex = [];
  const files = findMarkdownFiles(DOCS_DIR);
  
  console.log(`Found ${files.length} markdown files`);
  
  // Initialize AI content enhancer
  const aiEnhancer = new AIContentEnhancer();
  let useAI = true;
  
  try {
    console.log('\n🤖 Initializing AI content enhancement...');
    await aiEnhancer.initialize();
    console.log('✅ AI enhancement ready\n');
  } catch (error) {
    console.warn('⚠️  AI enhancement failed, proceeding without AI features:', error.message);
    useAI = false;
  }
  
  for (const { slug, fullPath } of files) {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const { frontmatter, content: bodyContent } = extractFrontmatter(content);
      
      // Clean content (remove markdown syntax)
      const cleanContent = bodyContent
        .replace(/#{1,6}\s+/g, '') // Remove headers
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
        .replace(/\*(.*?)\*/g, '$1') // Remove italic
        .replace(/`(.*?)`/g, '$1') // Remove inline code
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove links, keep text
        .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1') // Remove images
        .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
        .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
        .replace(/\n\s*\n/g, '\n') // Remove extra newlines
        .trim();
      
      // Extract keywords for enhanced search
      const keywords = extractKeywords(cleanContent, frontmatter);
      
      // Create smart chunks
      const chunks = createSmartChunks(cleanContent, frontmatter.title);
      
      // Enhance chunks with AI if available
      let enhancedChunks = chunks;
      if (useAI) {
        try {
          console.log(`   🧠 AI enhancing ${chunks.length} chunks...`);
          enhancedChunks = await aiEnhancer.enhanceChunks(chunks, frontmatter.title);
        } catch (error) {
          console.warn(`   ⚠️  AI enhancement failed for ${slug}, using basic chunks:`, error.message);
          enhancedChunks = chunks;
        }
      }
      
      // Create standard document entry (for backward compatibility)
      const docEntry = {
        type: 'document',
        slug,
        title: frontmatter.title || slug,
        category: frontmatter.category || 'General',
        url: `/docs/${slug}`,
        chunks: chunks.map((chunk, index) => ({
          id: `${slug}-chunk-${index}`,
          text: chunk.text,
          startIndex: chunk.startIndex,
          preview: chunk.text.substring(0, 150) + (chunk.text.length > 150 ? '...' : '')
        }))
      };
      
      // Create enhanced document entry with AI metadata
      const enhancedDocEntry = {
        ...docEntry,
        keywords,
        description: frontmatter.description || '',
        order: parseInt(frontmatter.order) || 999,
        lastModified: fs.statSync(fullPath).mtime.toISOString(),
        chunks: enhancedChunks.map((chunk, index) => ({
          id: `${slug}-chunk-${index}`,
          text: chunk.text,
          startIndex: chunk.startIndex,
          wordCount: chunk.wordCount,
          importance: chunk.importance,
          preview: chunk.text.substring(0, 150) + (chunk.text.length > 150 ? '...' : ''),
          keywords: extractKeywords(chunk.text, {}),
          // AI-enhanced metadata
          embedding: chunk.embedding || null,
          semanticKeywords: chunk.semanticKeywords || [],
          contentType: chunk.contentType || 'general',
          difficulty: chunk.difficulty || 'intermediate',
          hasCode: chunk.hasCode || false,
          language: chunk.language || null,
          concepts: chunk.concepts || []
        }))
      };
      
      searchIndex.push(docEntry);
      enhancedIndex.push(enhancedDocEntry);
      
      const aiInfo = useAI ? `, AI-enhanced` : '';
      console.log(`Indexed: ${slug} (${chunks.length} chunks, ${keywords.length} keywords${aiInfo})`);
      
    } catch (error) {
      console.error(`Error processing ${fullPath}:`, error.message);
    }
  }
  
  // Save AI cache if we used AI
  if (useAI) {
    aiEnhancer.saveCache();
    const progress = aiEnhancer.getProgress();
    console.log(`\n🧠 AI Enhancement Summary:`);
    console.log(`   - Processed: ${progress.processed} chunks`);
    console.log(`   - Success rate: ${progress.percentage}%`);
  }
  
  // Write both indices
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Standard index (backward compatibility)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(searchIndex, null, 2));
  console.log(`Standard search index generated: ${OUTPUT_FILE}`);
  
  // Enhanced index
  fs.writeFileSync(ENHANCED_OUTPUT_FILE, JSON.stringify(enhancedIndex, null, 2));
  console.log(`Enhanced search index generated: ${ENHANCED_OUTPUT_FILE}`);
  
  console.log(`Total documents: ${searchIndex.length}`);
  console.log(`Total chunks: ${searchIndex.reduce((sum, doc) => sum + doc.chunks.length, 0)}`);
  console.log(`Average keywords per document: ${(enhancedIndex.reduce((sum, doc) => sum + doc.keywords.length, 0) / enhancedIndex.length).toFixed(1)}`);
}

generateEnhancedSearchIndex().catch(error => {
  console.error('❌ Failed to generate enhanced search index:', error);
  process.exit(1);
});
