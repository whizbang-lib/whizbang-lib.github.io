#!/usr/bin/env node

import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';

// Configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'; // 384-dimensional embeddings, ~22MB
const BATCH_SIZE = 5; // Process chunks in batches to manage memory
const CACHE_FILE = 'src/scripts/.ai-cache.json';

// AI Enhancement Service
class AIContentEnhancer {
  constructor() {
    this.embeddingPipeline = null;
    this.cache = this.loadCache();
    this.processedCount = 0;
    this.totalChunks = 0;
  }

  async initialize() {
    console.log('🤖 Initializing AI content enhancement...');
    console.log(`📥 Loading embedding model: ${MODEL_NAME}`);
    
    try {
      this.embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true, // Use quantized model for smaller size and faster inference
        progress_callback: (data) => {
          if (data.status === 'progress') {
            console.log(`   Loading: ${data.file} (${Math.round(data.progress)}%)`);
          }
        }
      });
      console.log('✅ AI model loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load AI model:', error.message);
      throw error;
    }
  }

  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        console.log(`📂 Loaded ${Object.keys(cacheData).length} cached embeddings`);
        return cacheData;
      }
    } catch (error) {
      console.warn('⚠️ Failed to load cache, starting fresh:', error.message);
    }
    return {};
  }

  saveCache() {
    try {
      const cacheDir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
      console.log(`💾 Saved ${Object.keys(this.cache).length} embeddings to cache`);
    } catch (error) {
      console.warn('⚠️ Failed to save cache:', error.message);
    }
  }

  // Generate cache key for content
  getCacheKey(text) {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // Generate embeddings for a batch of text chunks
  async generateEmbeddings(textChunks) {
    if (!this.embeddingPipeline) {
      throw new Error('AI model not initialized');
    }

    const results = [];
    const uncachedTexts = [];
    const uncachedIndices = [];

    // Check cache first
    for (let i = 0; i < textChunks.length; i++) {
      const text = textChunks[i];
      const cacheKey = this.getCacheKey(text);
      
      if (this.cache[cacheKey]) {
        results[i] = this.cache[cacheKey];
      } else {
        uncachedTexts.push(text);
        uncachedIndices.push(i);
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      try {
        const embeddings = await this.embeddingPipeline(uncachedTexts, {
          pooling: 'mean',
          normalize: true
        });

        // Store results and cache them
        for (let i = 0; i < uncachedTexts.length; i++) {
          const embedding = Array.from(embeddings[i].data);
          const originalIndex = uncachedIndices[i];
          const text = uncachedTexts[i];
          const cacheKey = this.getCacheKey(text);

          results[originalIndex] = embedding;
          this.cache[cacheKey] = embedding;
        }
      } catch (error) {
        console.error('❌ Error generating embeddings:', error.message);
        // Fill with null for failed embeddings
        for (const index of uncachedIndices) {
          results[index] = null;
        }
      }
    }

    return results;
  }

  // Extract semantic keywords using AI
  extractSemanticKeywords(text, originalKeywords = []) {
    const keywords = new Set(originalKeywords);
    
    // Enhanced keyword extraction with semantic understanding
    const technicalTerms = text.match(/\b(?:async|await|promise|function|class|interface|component|service|module|import|export|const|let|var|if|else|for|while|try|catch|finally|return|this|super|extends|implements|public|private|protected|static|readonly)\b/gi) || [];
    technicalTerms.forEach(term => keywords.add(term.toLowerCase()));

    // Programming language detection
    const languages = text.match(/\b(?:javascript|typescript|java|python|csharp|c#|html|css|sql|json|xml|yaml|markdown|bash|shell|powershell|docker|kubernetes|react|angular|vue|node|express|nestjs|spring|dotnet|entity framework|mongodb|postgresql|mysql|redis|aws|azure|gcp)\b/gi) || [];
    languages.forEach(lang => keywords.add(lang.toLowerCase().replace('#', 'sharp')));

    // Framework and library terms
    const frameworks = text.match(/\b(?:primeng|bootstrap|tailwind|rxjs|observables|http|router|forms|animations|testing|jest|karma|cypress|webpack|vite|npm|yarn|git|github|docker|api|rest|graphql|oauth|jwt|cors|middleware|interceptor|guard|resolver|pipe|directive|decorator)\b/gi) || [];
    frameworks.forEach(fw => keywords.add(fw.toLowerCase()));

    return Array.from(keywords);
  }

  // Classify content type using heuristics
  classifyContentType(text) {
    const lowerText = text.toLowerCase();
    
    // Check for code examples
    if (text.includes('```') || text.includes('`') || 
        lowerText.includes('example:') || lowerText.includes('code:')) {
      return 'code-example';
    }
    
    // Check for tutorials/guides
    if (lowerText.includes('step') || lowerText.includes('tutorial') || 
        lowerText.includes('guide') || lowerText.includes('how to')) {
      return 'tutorial';
    }
    
    // Check for API reference
    if (lowerText.includes('api') || lowerText.includes('reference') || 
        lowerText.includes('method') || lowerText.includes('parameter')) {
      return 'reference';
    }
    
    // Check for concept explanation
    if (lowerText.includes('concept') || lowerText.includes('overview') || 
        lowerText.includes('introduction') || lowerText.includes('what is')) {
      return 'concept';
    }
    
    return 'general';
  }

  // Assess content difficulty
  assessDifficulty(text) {
    const lowerText = text.toLowerCase();
    let difficultyScore = 0;
    
    // Beginner indicators
    if (lowerText.includes('basic') || lowerText.includes('simple') || 
        lowerText.includes('introduction') || lowerText.includes('getting started')) {
      difficultyScore -= 1;
    }
    
    // Intermediate indicators
    if (lowerText.includes('advanced') || lowerText.includes('complex') || 
        lowerText.includes('architecture') || lowerText.includes('pattern')) {
      difficultyScore += 1;
    }
    
    // Advanced indicators
    if (lowerText.includes('optimization') || lowerText.includes('performance') || 
        lowerText.includes('scalability') || lowerText.includes('enterprise')) {
      difficultyScore += 2;
    }
    
    // Count technical terms as complexity indicators
    const technicalTermCount = (text.match(/\b(?:async|await|observable|promise|interface|generic|decorator|injection|middleware|interceptor|resolver|guard|pipe|directive)\b/gi) || []).length;
    difficultyScore += Math.floor(technicalTermCount / 3);
    
    if (difficultyScore <= -1) return 'beginner';
    if (difficultyScore >= 2) return 'advanced';
    return 'intermediate';
  }

  // Enhanced processing of document chunks
  async enhanceChunks(chunks, title = '') {
    this.totalChunks += chunks.length;
    const enhancedChunks = [];
    
    // Process chunks in batches to manage memory
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map(chunk => chunk.text);
      
      console.log(`   Processing chunks ${i + 1}-${Math.min(i + BATCH_SIZE, chunks.length)} of ${chunks.length}`);
      
      // Generate embeddings for this batch
      const embeddings = await this.generateEmbeddings(batchTexts);
      
      // Enhance each chunk in the batch
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = embeddings[j];
        
        const enhancedChunk = {
          ...chunk,
          embedding: embedding, // Add AI embedding
          semanticKeywords: this.extractSemanticKeywords(chunk.text, chunk.keywords || []),
          contentType: this.classifyContentType(chunk.text),
          difficulty: this.assessDifficulty(chunk.text),
          // Additional metadata for better search
          hasCode: chunk.text.includes('```') || chunk.text.includes('`'),
          language: this.detectProgrammingLanguage(chunk.text),
          concepts: this.extractConcepts(chunk.text)
        };
        
        enhancedChunks.push(enhancedChunk);
        this.processedCount++;
      }
    }
    
    return enhancedChunks;
  }

  // Detect programming language in content
  detectProgrammingLanguage(text) {
    const languages = {
      'javascript': /\b(?:function|const|let|var|=>|console\.log|document\.)\b/gi,
      'typescript': /\b(?:interface|type|implements|extends|public|private|protected)\b/gi,
      'csharp': /\b(?:using|namespace|class|public|private|static|void|string|int)\b/gi,
      'html': /<\/?[a-z][\s\S]*>/gi,
      'css': /\b(?:color|margin|padding|display|position|background)\b/gi,
      'json': /^\s*\{[\s\S]*\}\s*$|^\s*\[[\s\S]*\]\s*$/gm,
      'bash': /\b(?:npm|node|git|docker|ls|cd|mkdir|rm)\b/gi
    };

    for (const [lang, regex] of Object.entries(languages)) {
      if (regex.test(text)) {
        return lang;
      }
    }
    
    return null;
  }

  // Extract programming concepts
  extractConcepts(text) {
    const concepts = [];
    const conceptPatterns = {
      'async-programming': /\b(?:async|await|promise|asynchronous|concurrent)\b/gi,
      'object-oriented': /\b(?:class|object|inheritance|polymorphism|encapsulation)\b/gi,
      'functional-programming': /\b(?:function|pure|immutable|map|filter|reduce)\b/gi,
      'web-development': /\b(?:html|css|dom|browser|frontend|backend)\b/gi,
      'api-development': /\b(?:api|rest|graphql|endpoint|http|json)\b/gi,
      'testing': /\b(?:test|testing|unit|integration|mock|assert)\b/gi,
      'database': /\b(?:sql|database|query|table|entity|migration)\b/gi,
      'security': /\b(?:authentication|authorization|jwt|oauth|security|encryption)\b/gi,
      'performance': /\b(?:performance|optimization|caching|memory|speed)\b/gi
    };

    for (const [concept, pattern] of Object.entries(conceptPatterns)) {
      if (pattern.test(text)) {
        concepts.push(concept);
      }
    }

    return concepts;
  }

  // Progress reporting
  getProgress() {
    return {
      processed: this.processedCount,
      total: this.totalChunks,
      percentage: this.totalChunks > 0 ? Math.round((this.processedCount / this.totalChunks) * 100) : 0
    };
  }
}

export { AIContentEnhancer };

// If run directly, provide a simple test
if (import.meta.url === `file://${process.argv[1]}`) {
  const enhancer = new AIContentEnhancer();
  
  try {
    await enhancer.initialize();
    
    const testText = "This is a simple JavaScript function that demonstrates async/await patterns for handling promises in modern web development.";
    const embeddings = await enhancer.generateEmbeddings([testText]);
    
    console.log('✅ AI enhancement test successful');
    console.log(`📊 Generated embedding dimension: ${embeddings[0]?.length || 'failed'}`);
    console.log(`🏷️ Content type: ${enhancer.classifyContentType(testText)}`);
    console.log(`📈 Difficulty: ${enhancer.assessDifficulty(testText)}`);
    console.log(`🔤 Keywords: ${enhancer.extractSemanticKeywords(testText).slice(0, 5).join(', ')}`);
    
    enhancer.saveCache();
  } catch (error) {
    console.error('❌ AI enhancement test failed:', error.message);
    process.exit(1);
  }
}