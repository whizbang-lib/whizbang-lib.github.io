#!/usr/bin/env node

/**
 * @fileoverview Documentation Version Migration Tool
 *
 * Migrates documentation from one version folder to another, updating all
 * version references in content, frontmatter, and cross-references.
 *
 * @example
 * # Preview migration (always do this first)
 * npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --dry-run
 *
 * # Execute migration with source content winning conflicts
 * npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --conflict-strategy source-wins
 *
 * # Migrate and clean up source folder
 * npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --delete-source
 *
 * @see /docs/MIGRATION-GUIDE.md for detailed usage
 */

import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DOCS_DIR = join(__dirname, '../assets/docs');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    source: null,
    target: null,
    dryRun: false,
    conflictStrategy: 'source-wins',
    deleteSource: false,
    stripEvolution: false,
    updateCrossRefs: true,
    verbose: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--source':
        options.source = args[++i];
        break;
      case '--target':
        options.target = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--conflict-strategy':
        options.conflictStrategy = args[++i];
        break;
      case '--delete-source':
        options.deleteSource = true;
        break;
      case '--strip-evolution':
        options.stripEvolution = true;
        break;
      case '--no-cross-refs':
        options.updateCrossRefs = false;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Documentation Version Migration Tool

Usage:
  npm run migrate-docs -- [options]

Options:
  --source <version>       Source version folder (e.g., v0.1.0) [required]
  --target <version>       Target version folder (e.g., v1.0.0) [required]
  --dry-run                Preview changes without writing
  --conflict-strategy      How to handle existing files:
                           - source-wins: Overwrite target with source (default)
                           - target-wins: Keep target, skip source
                           - abort: Stop on first conflict
  --delete-source          Delete source folder after successful migration
  --strip-evolution        Remove evolves-to frontmatter and "Coming in vX.X.X" sections
  --no-cross-refs          Skip updating drafts/proposals folders
  --verbose                Show detailed progress
  --help, -h               Show this help message

Examples:
  # Preview migration
  npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --dry-run --verbose

  # Consolidate v0.1.0 into v1.0.0
  npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --conflict-strategy source-wins

  # Full migration with cleanup
  npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --delete-source --strip-evolution
`);
}

// ============================================================================
// Statistics Tracking
// ============================================================================

class MigrationStats {
  constructor() {
    this.filesScanned = 0;
    this.filesCopied = 0;
    this.filesSkipped = 0;
    this.filesOverwritten = 0;
    this.crossRefsUpdated = 0;
    this.changes = {
      frontmatterVersion: 0,
      frontmatterTags: 0,
      evolvesToRemoved: 0,
      badgeUrls: 0,
      absoluteLinks: 0,
      relativeLinks: 0,
      inlineVersionText: 0,
      evolutionSectionsRemoved: 0
    };
    this.errors = [];
    this.warnings = [];
  }

  printSummary(options) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));

    console.log(`\n📁 Files:`);
    console.log(`   Scanned:     ${this.filesScanned}`);
    console.log(`   Copied:      ${this.filesCopied}`);
    console.log(`   Skipped:     ${this.filesSkipped}`);
    console.log(`   Overwritten: ${this.filesOverwritten}`);
    if (options.updateCrossRefs) {
      console.log(`   Cross-refs:  ${this.crossRefsUpdated}`);
    }

    const totalChanges = Object.values(this.changes).reduce((a, b) => a + b, 0);
    if (totalChanges > 0) {
      console.log(`\n📝 Changes Applied (${totalChanges} total):`);
      if (this.changes.frontmatterVersion > 0) {
        console.log(`   Frontmatter version:    ${this.changes.frontmatterVersion}`);
      }
      if (this.changes.frontmatterTags > 0) {
        console.log(`   Frontmatter tags:       ${this.changes.frontmatterTags}`);
      }
      if (this.changes.evolvesToRemoved > 0) {
        console.log(`   evolves-to removed:     ${this.changes.evolvesToRemoved}`);
      }
      if (this.changes.badgeUrls > 0) {
        console.log(`   Badge URLs:             ${this.changes.badgeUrls}`);
      }
      if (this.changes.absoluteLinks > 0) {
        console.log(`   Absolute links:         ${this.changes.absoluteLinks}`);
      }
      if (this.changes.relativeLinks > 0) {
        console.log(`   Relative links:         ${this.changes.relativeLinks}`);
      }
      if (this.changes.inlineVersionText > 0) {
        console.log(`   Inline version text:    ${this.changes.inlineVersionText}`);
      }
      if (this.changes.evolutionSectionsRemoved > 0) {
        console.log(`   Evolution sections:     ${this.changes.evolutionSectionsRemoved}`);
      }
    }

    if (this.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${this.warnings.length}):`);
      this.warnings.slice(0, 10).forEach(w => console.log(`   - ${w}`));
      if (this.warnings.length > 10) {
        console.log(`   ... and ${this.warnings.length - 10} more`);
      }
    }

    if (this.errors.length > 0) {
      console.log(`\n❌ Errors (${this.errors.length}):`);
      this.errors.forEach(e => console.log(`   - ${e}`));
    }

    console.log('\n' + '='.repeat(60));
    if (this.errors.length === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('❌ Migration completed with errors.');
    }
    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// Directory Scanning
// ============================================================================

async function scanDirectory(dir, basePath = dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...await scanDirectory(fullPath, basePath));
      } else if (entry.name.endsWith('.md')) {
        files.push({
          absolutePath: fullPath,
          relativePath: relative(basePath, fullPath)
        });
      }
    }
  } catch (error) {
    // Directory doesn't exist or isn't accessible
  }

  return files;
}

// ============================================================================
// Version Reference Transformers
// ============================================================================

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function transformContent(content, sourceVersion, targetVersion, options, stats) {
  let result = content;

  // Extract version numbers (without 'v' prefix)
  const srcNum = sourceVersion.replace(/^v/, '');
  const tgtNum = targetVersion.replace(/^v/, '');

  // Badge URLs: "badge/version-0.1.0-blue" -> "badge/version-1.0.0-blue"
  const badgePattern = new RegExp(`badge/version-${escapeRegex(srcNum)}-`, 'g');
  const badgeMatches = result.match(badgePattern);
  if (badgeMatches) {
    result = result.replace(badgePattern, `badge/version-${tgtNum}-`);
    stats.changes.badgeUrls += badgeMatches.length;
  }

  // Absolute doc links: "/docs/v0.1.0/" -> "/docs/v1.0.0/"
  const absLinkPattern = new RegExp(`/docs/${escapeRegex(sourceVersion)}/`, 'g');
  const absLinkMatches = result.match(absLinkPattern);
  if (absLinkMatches) {
    result = result.replace(absLinkPattern, `/docs/${targetVersion}/`);
    stats.changes.absoluteLinks += absLinkMatches.length;
  }

  // Relative version links: "../../v0.1.0/" -> "../../v1.0.0/"
  const relLinkPattern = new RegExp(`\\.\\./\\.\\./v${escapeRegex(srcNum)}/`, 'g');
  const relLinkMatches = result.match(relLinkPattern);
  if (relLinkMatches) {
    result = result.replace(relLinkPattern, `../../${targetVersion}/`);
    stats.changes.relativeLinks += relLinkMatches.length;
  }

  // Inline version references: "v0.1.0" -> "v1.0.0" (be careful with this one)
  // Only replace in specific contexts to avoid false positives
  const contextualVersionPattern = new RegExp(
    `(Version |version |\\bv)${escapeRegex(srcNum)}\\b`,
    'g'
  );
  const inlineMatches = result.match(contextualVersionPattern);
  if (inlineMatches) {
    result = result.replace(contextualVersionPattern, `$1${tgtNum}`);
    stats.changes.inlineVersionText += inlineMatches.length;
  }

  // Strip evolution sections if requested
  if (options.stripEvolution) {
    // Remove :::planned blocks containing "Coming in v0.x.0"
    const plannedBlockPattern = /:::planned[\s\S]*?(?:Coming in v\d+\.\d+\.\d+|See .+ features →)[\s\S]*?:::/g;
    const plannedMatches = result.match(plannedBlockPattern);
    if (plannedMatches) {
      result = result.replace(plannedBlockPattern, '');
      stats.changes.evolutionSectionsRemoved += plannedMatches.length;
    }

    // Remove "Evolution Timeline" mermaid diagrams
    const evolutionDiagramPattern = /## Evolution Timeline[\s\S]*?```mermaid[\s\S]*?```\s*/g;
    const diagramMatches = result.match(evolutionDiagramPattern);
    if (diagramMatches) {
      result = result.replace(evolutionDiagramPattern, '');
      stats.changes.evolutionSectionsRemoved += diagramMatches.length;
    }

    // Remove cross-version links like "[See pipeline features →](../../v0.2.0/...)"
    const crossVersionLinkPattern = /\[See [^\]]+\]\(\.\.\/\.\.\/v\d+\.\d+\.\d+\/[^)]+\)\s*/g;
    const crossLinkMatches = result.match(crossVersionLinkPattern);
    if (crossLinkMatches) {
      result = result.replace(crossVersionLinkPattern, '');
      stats.changes.evolutionSectionsRemoved += crossLinkMatches.length;
    }

    // Remove "Next Update" badge lines
    const nextUpdatePattern = /!\[Next Update\].*\n?/g;
    const nextUpdateMatches = result.match(nextUpdatePattern);
    if (nextUpdateMatches) {
      result = result.replace(nextUpdatePattern, '');
      stats.changes.evolutionSectionsRemoved += nextUpdateMatches.length;
    }
  }

  // Clean up multiple consecutive blank lines
  result = result.replace(/\n{4,}/g, '\n\n\n');

  return result;
}

// ============================================================================
// File Processing
// ============================================================================

function processFile(filePath, sourceVersion, targetVersion, options, stats) {
  const content = readFileSync(filePath, 'utf8');
  const { data: frontmatter, content: body } = matter(content);

  const srcNum = sourceVersion.replace(/^v/, '');
  const tgtNum = targetVersion.replace(/^v/, '');

  let updatedFrontmatter = { ...frontmatter };
  let hasChanges = false;

  // Update frontmatter version field
  if (frontmatter.version === srcNum) {
    updatedFrontmatter.version = tgtNum;
    stats.changes.frontmatterVersion++;
    hasChanges = true;
  }

  // Remove evolves-to field if stripping evolution
  if (options.stripEvolution && frontmatter['evolves-to']) {
    delete updatedFrontmatter['evolves-to'];
    stats.changes.evolvesToRemoved++;
    hasChanges = true;
  }

  // Update tags array
  if (Array.isArray(frontmatter.tags)) {
    const originalTags = JSON.stringify(frontmatter.tags);
    updatedFrontmatter.tags = frontmatter.tags
      .map(tag => {
        if (tag === `v${srcNum}` || tag === srcNum) {
          return `v${tgtNum}`;
        }
        // Remove future version tags if stripping evolution
        if (options.stripEvolution && /^v?\d+\.\d+\.\d+$/.test(tag)) {
          const tagNum = tag.replace(/^v/, '');
          if (tagNum !== srcNum && tagNum !== tgtNum) {
            return null; // Will be filtered out
          }
        }
        return tag;
      })
      .filter(tag => tag !== null);

    if (JSON.stringify(updatedFrontmatter.tags) !== originalTags) {
      stats.changes.frontmatterTags++;
      hasChanges = true;
    }
  }

  // Transform body content
  const updatedBody = transformContent(body, sourceVersion, targetVersion, options, stats);
  const bodyChanged = updatedBody !== body;

  // Reconstruct file
  const result = matter.stringify(updatedBody, updatedFrontmatter);

  return {
    original: content,
    updated: result,
    hasChanges: hasChanges || bodyChanged
  };
}

// ============================================================================
// Conflict Resolution
// ============================================================================

function resolveConflict(targetPath, strategy) {
  const targetExists = existsSync(targetPath);

  if (!targetExists) {
    return { action: 'copy', reason: 'target-missing' };
  }

  switch (strategy) {
    case 'target-wins':
      return { action: 'skip', reason: 'target-exists' };
    case 'source-wins':
      return { action: 'overwrite', reason: 'source-priority' };
    case 'abort':
      throw new Error(`Conflict: ${targetPath} already exists`);
    default:
      throw new Error(`Unknown conflict strategy: ${strategy}`);
  }
}

// ============================================================================
// Cross-Reference Updates
// ============================================================================

async function updateCrossReferences(sourceVersion, targetVersion, options, stats) {
  const folders = ['drafts', 'proposals', 'backlog'];

  console.log('\n🔗 Updating cross-references in state folders...');

  for (const folder of folders) {
    const dir = join(DOCS_DIR, folder);
    if (!existsSync(dir)) continue;

    const files = await scanDirectory(dir);

    for (const file of files) {
      try {
        const result = processFile(file.absolutePath, sourceVersion, targetVersion, options, stats);

        if (result.hasChanges) {
          if (!options.dryRun) {
            writeFileSync(file.absolutePath, result.updated, 'utf8');
          }
          stats.crossRefsUpdated++;
          if (options.verbose) {
            console.log(`   📝 ${folder}/${file.relativePath}`);
          }
        }
      } catch (error) {
        stats.warnings.push(`${folder}/${file.relativePath}: ${error.message}`);
      }
    }
  }
}

// ============================================================================
// Main Migration Function
// ============================================================================

async function migrate(options) {
  const stats = new MigrationStats();
  const sourceDir = join(DOCS_DIR, options.source);
  const targetDir = join(DOCS_DIR, options.target);

  console.log('\n' + '='.repeat(60));
  console.log('🚀 Documentation Version Migration');
  console.log('='.repeat(60));
  console.log(`\n   Source:   ${options.source}`);
  console.log(`   Target:   ${options.target}`);
  console.log(`   Mode:     ${options.dryRun ? '🔍 DRY RUN' : '✏️  LIVE'}`);
  console.log(`   Strategy: ${options.conflictStrategy}`);
  if (options.stripEvolution) {
    console.log(`   Strip:    Evolution sections enabled`);
  }
  if (options.deleteSource) {
    console.log(`   Cleanup:  Delete source after migration`);
  }

  // Validate source exists
  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  // Create target directory if needed
  if (!options.dryRun && !existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    console.log(`\n📁 Created target directory: ${options.target}`);
  }

  // Scan source files
  const sourceFiles = await scanDirectory(sourceDir);
  console.log(`\n📂 Found ${sourceFiles.length} files to migrate\n`);

  // Process each file
  for (const file of sourceFiles) {
    stats.filesScanned++;
    const targetPath = join(targetDir, file.relativePath);

    try {
      const resolution = resolveConflict(targetPath, options.conflictStrategy);

      if (resolution.action === 'skip') {
        stats.filesSkipped++;
        if (options.verbose) {
          console.log(`⏭️  Skip: ${file.relativePath}`);
        }
        continue;
      }

      // Process content
      const result = processFile(file.absolutePath, options.source, options.target, options, stats);

      // Write file
      if (!options.dryRun) {
        const targetDirPath = dirname(targetPath);
        if (!existsSync(targetDirPath)) {
          mkdirSync(targetDirPath, { recursive: true });
        }
        writeFileSync(targetPath, result.updated, 'utf8');
      }

      if (resolution.action === 'overwrite') {
        stats.filesOverwritten++;
        if (options.verbose) {
          console.log(`🔄 Overwrite: ${file.relativePath}`);
        }
      } else {
        stats.filesCopied++;
        if (options.verbose) {
          console.log(`✅ Copy: ${file.relativePath}`);
        }
      }

    } catch (error) {
      stats.errors.push(`${file.relativePath}: ${error.message}`);
      console.error(`❌ Error: ${file.relativePath}: ${error.message}`);
    }
  }

  // Update cross-references in drafts/proposals
  if (options.updateCrossRefs) {
    await updateCrossReferences(options.source, options.target, options, stats);
  }

  // Delete source if requested
  if (options.deleteSource && !options.dryRun && stats.errors.length === 0) {
    console.log(`\n🗑️  Deleting source directory: ${options.source}`);
    rmSync(sourceDir, { recursive: true, force: true });
  }

  stats.printSummary(options);

  // Post-migration instructions
  console.log('📋 Next Steps:');
  console.log('   1. Run: npm run prebuild');
  console.log('   2. Verify: npm start');
  console.log('   3. Check navigation and links');
  if (!options.dryRun) {
    console.log('   4. Commit changes\n');
  } else {
    console.log('\n💡 This was a dry run. Re-run without --dry-run to apply changes.\n');
  }

  return stats;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.source || !options.target) {
    console.error('❌ Error: --source and --target are required\n');
    showHelp();
    process.exit(1);
  }

  try {
    const stats = await migrate(options);
    process.exit(stats.errors.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
