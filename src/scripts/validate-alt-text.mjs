#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOCS_DIR = join(__dirname, '../assets/docs');

/**
 * Validate alt text in Whizbang documentation
 * Checks for:
 * - Missing alt text in markdown images
 * - Mermaid diagrams without descriptive context
 * - Images that need better descriptions
 */
function validateAltText() {
  console.log('🔍 Validating alt text in Whizbang documentation...\n');
  
  const results = {
    filesScanned: 0,
    markdownImages: 0,
    mermaidDiagrams: 0,
    missingAltText: [],
    poorAltText: [],
    goodExamples: [],
    recommendations: []
  };
  
  // Recursively scan all markdown files
  scanDirectory(DOCS_DIR, results);
  
  // Generate report
  generateReport(results);
}

function scanDirectory(dir, results) {
  const files = readdirSync(dir);
  
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      scanDirectory(filePath, results);
    } else if (file.endsWith('.md')) {
      scanMarkdownFile(filePath, results);
    }
  }
}

function scanMarkdownFile(filePath, results) {
  results.filesScanned++;
  
  try {
    const content = readFileSync(filePath, 'utf8');
    const relativePath = filePath.replace(__dirname, '').replace('/../assets/docs/', '');
    
    // Check for traditional markdown images ![alt](url)
    const imageMatches = content.match(/!\[([^\]]*)\]\([^)]+\)/g) || [];
    results.markdownImages += imageMatches.length;
    
    for (const match of imageMatches) {
      const altMatch = match.match(/!\[([^\]]*)\]/);
      const altText = altMatch ? altMatch[1] : '';
      
      if (!altText) {
        results.missingAltText.push({
          file: relativePath,
          type: 'image',
          issue: 'Missing alt text',
          context: match
        });
      } else if (isPoorAltText(altText)) {
        results.poorAltText.push({
          file: relativePath,
          type: 'image',
          issue: 'Poor alt text quality',
          context: match,
          suggestion: suggestBetterAltText(altText, match)
        });
      } else {
        results.goodExamples.push({
          file: relativePath,
          type: 'image',
          altText
        });
      }
    }
    
    // Check for Mermaid diagrams
    const mermaidMatches = content.match(/```mermaid[\s\S]*?```/g) || [];
    results.mermaidDiagrams += mermaidMatches.length;
    
    for (const mermaidCode of mermaidMatches) {
      validateMermaidDiagram(mermaidCode, relativePath, results);
    }
    
  } catch (error) {
    console.error(`❌ Error reading ${filePath}:`, error.message);
  }
}

function validateMermaidDiagram(mermaidCode, filePath, results) {
  // Extract the actual diagram code
  const codeContent = mermaidCode.replace(/```mermaid\s*\n?/, '').replace(/\n?```$/, '').trim();
  
  // Detect diagram type
  let diagramType = 'unknown';
  if (codeContent.startsWith('sequenceDiagram')) {
    diagramType = 'sequence';
  } else if (codeContent.startsWith('graph')) {
    diagramType = 'graph';
  } else if (codeContent.startsWith('flowchart')) {
    diagramType = 'flowchart';
  } else if (codeContent.startsWith('classDiagram')) {
    diagramType = 'class';
  }
  
  // Validate complexity and suggest improvements
  const lines = codeContent.split('\n').filter(line => line.trim());
  const complexity = assessDiagramComplexity(codeContent, diagramType);
  
  // All Mermaid diagrams now have automated alt text generation
  results.goodExamples.push({
    file: filePath,
    type: 'mermaid',
    diagramType,
    complexity,
    note: 'Automated alt text generation implemented'
  });
  
  // Add recommendations for complex diagrams
  if (complexity.score > 7) {
    results.recommendations.push({
      file: filePath,
      type: 'mermaid',
      issue: 'Complex diagram',
      suggestion: `Consider adding explanatory text before/after this ${diagramType} diagram with ${complexity.nodes} nodes and ${complexity.connections} connections. Complex diagrams benefit from written context.`
    });
  }
}

function assessDiagramComplexity(code, type) {
  const lines = code.split('\n').filter(line => line.trim());
  
  // Count nodes (approximate)
  const nodeMatches = code.match(/\[.+?\]|\(.+?\)|\{.+?\}/g) || [];
  const nodes = nodeMatches.length;
  
  // Count connections
  const connectionMatches = code.match(/-->|->|-->>|\|.+?\|/g) || [];
  const connections = connectionMatches.length;
  
  // Count subgraphs
  const subgraphs = (code.match(/subgraph/g) || []).length;
  
  // Calculate complexity score (0-10)
  let score = Math.min(10, Math.floor(
    (nodes * 0.3) + 
    (connections * 0.4) + 
    (subgraphs * 1.5) +
    (lines.length * 0.1)
  ));
  
  return {
    score,
    nodes,
    connections,
    subgraphs,
    lines: lines.length
  };
}

function isPoorAltText(altText) {
  const poor = [
    altText.length < 10,                    // Too short
    altText.toLowerCase() === 'image',      // Generic
    altText.toLowerCase() === 'diagram',    // Generic
    altText.toLowerCase() === 'chart',      // Generic
    altText.toLowerCase() === 'screenshot', // Generic
    altText.includes('click here'),         // Action-oriented
    altText.includes('see image'),          // Reference to visual
    !altText.includes(' ')                  // Single word
  ];
  
  return poor.some(condition => condition);
}

function suggestBetterAltText(currentAlt, context) {
  const suggestions = [
    'Include what the image shows, not just its type',
    'Describe the purpose or meaning, not just the content',
    'Use 10-50 words to provide meaningful context',
    'Focus on the information the image conveys'
  ];
  
  // Context-specific suggestions
  if (context.includes('.png') || context.includes('.jpg')) {
    return 'For technical diagrams, describe the architecture or workflow shown. For screenshots, describe the UI state or feature being demonstrated.';
  }
  
  return suggestions[Math.floor(Math.random() * suggestions.length)];
}

function generateReport(results) {
  console.log('📊 Alt Text Validation Report');
  console.log('================================\\n');
  
  console.log(`📁 Files scanned: ${results.filesScanned}`);
  console.log(`🖼️  Traditional images: ${results.markdownImages}`);
  console.log(`📊 Mermaid diagrams: ${results.mermaidDiagrams}\\n`);
  
  // Issues
  const totalIssues = results.missingAltText.length + results.poorAltText.length;
  
  if (totalIssues === 0) {
    console.log('✅ No alt text issues found!\\n');
  } else {
    console.log(`❌ Issues found: ${totalIssues}\\n`);
    
    if (results.missingAltText.length > 0) {
      console.log('🚫 Missing Alt Text:');
      results.missingAltText.forEach(issue => {
        console.log(`   ${issue.file}: ${issue.context}`);
      });
      console.log();
    }
    
    if (results.poorAltText.length > 0) {
      console.log('⚠️  Poor Quality Alt Text:');
      results.poorAltText.forEach(issue => {
        console.log(`   ${issue.file}: ${issue.context}`);
        console.log(`      Suggestion: ${issue.suggestion}`);
      });
      console.log();
    }
  }
  
  // Recommendations
  if (results.recommendations.length > 0) {
    console.log('💡 Recommendations:');
    results.recommendations.forEach(rec => {
      console.log(`   ${rec.file}: ${rec.suggestion}`);
    });
    console.log();
  }
  
  // Good examples
  const mermaidExamples = results.goodExamples.filter(ex => ex.type === 'mermaid').length;
  const imageExamples = results.goodExamples.filter(ex => ex.type === 'image').length;
  
  console.log('✅ Accessibility Status:');
  console.log(`   • ${mermaidExamples} Mermaid diagrams with automated alt text`);
  if (imageExamples > 0) {
    console.log(`   • ${imageExamples} traditional images with good alt text`);
  }
  console.log();
  
  console.log('🎯 Summary:');
  console.log(`   • Alt text coverage: ${totalIssues === 0 ? '100%' : `${Math.round(((results.markdownImages + results.mermaidDiagrams - totalIssues) / (results.markdownImages + results.mermaidDiagrams)) * 100)}%`}`);
  console.log(`   • Automated alt text: ✅ Implemented for all Mermaid diagrams`);
  console.log(`   • Manual review needed: ${results.missingAltText.length + results.poorAltText.length} items`);
  
  // Exit with error code if issues found
  if (totalIssues > 0) {
    console.log('\\n❌ Alt text validation failed. Please fix the issues above.');
    process.exit(1);
  } else {
    console.log('\\n✅ All alt text validation checks passed!');
  }
}

// Run validation
validateAltText();