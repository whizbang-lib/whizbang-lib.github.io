# Documentation Version Migration Guide

This guide explains how to use the `migrate-docs` tool to move documentation between versions.

## Overview

The migration tool consolidates documentation from one version folder to another, updating all version references in:
- Frontmatter (version, tags, evolves-to)
- Badge URLs
- Internal links (absolute and relative)
- Inline version text
- Cross-references in drafts/proposals

## Quick Start

```bash
# Preview what will change (always do this first)
npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --dry-run

# Execute the migration
npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --conflict-strategy source-wins

# Full migration with cleanup
npm run migrate-docs -- --source v0.1.0 --target v1.0.0 --delete-source --strip-evolution
```

## CLI Reference

### Required Options

| Option | Description |
|--------|-------------|
| `--source <version>` | Source version folder (e.g., `v0.1.0`) |
| `--target <version>` | Target version folder (e.g., `v1.0.0`) |

### Optional Flags

| Option | Default | Description |
|--------|---------|-------------|
| `--dry-run` | false | Preview changes without writing files |
| `--conflict-strategy` | `source-wins` | How to handle conflicts (see below) |
| `--delete-source` | false | Delete source folder after successful migration |
| `--strip-evolution` | false | Remove evolution sections (see below) |
| `--no-cross-refs` | false | Skip updating drafts/proposals folders |
| `--verbose` | false | Show detailed progress |

### Conflict Strategies

- **source-wins**: Overwrite target files with source content (default)
- **target-wins**: Keep existing target files, skip conflicting source files
- **abort**: Stop migration on first conflict

### Evolution Stripping

The `--strip-evolution` flag removes:
- `:::planned` blocks containing "Coming in vX.X.X"
- Evolution Timeline mermaid diagrams
- `evolves-to` frontmatter fields
- Cross-version navigation links
- "Next Update" badge lines

Use this when consolidating pre-release versions into a stable release.

## Common Scenarios

### Consolidating Alpha/Beta to Stable

When multiple 0.x versions are pre-releases of v1.0.0:

```bash
npm run migrate-docs -- \
  --source v0.1.0 \
  --target v1.0.0 \
  --conflict-strategy source-wins \
  --strip-evolution \
  --delete-source
```

### Moving Released Version to Archive

```bash
npm run migrate-docs -- \
  --source v1.0.0 \
  --target archived/v1.0.0 \
  --conflict-strategy source-wins
```

### Previewing Major Changes

Always run a dry-run first:

```bash
npm run migrate-docs -- \
  --source v0.1.0 \
  --target v1.0.0 \
  --dry-run \
  --verbose
```

## What Gets Updated

### Frontmatter

```yaml
# Before
version: 0.1.0
tags: [dispatcher, v0.1.0]
evolves-to: v0.2.0/enhancements/dispatcher.md

# After (with --strip-evolution)
version: 1.0.0
tags: [dispatcher, v1.0.0]
```

### Badge URLs

```markdown
<!-- Before -->
![Version](https://img.shields.io/badge/version-0.1.0-blue)

<!-- After -->
![Version](https://img.shields.io/badge/version-1.0.0-blue)
```

### Links

```markdown
<!-- Before -->
[See docs](/docs/v0.1.0/core-concepts/dispatcher)
[Related](../../v0.1.0/components/ledger.md)

<!-- After -->
[See docs](/docs/v1.0.0/core-concepts/dispatcher)
[Related](../../v1.0.0/components/ledger.md)
```

## Post-Migration Steps

1. **Regenerate indexes**:
   ```bash
   npm run prebuild
   ```

2. **Verify the site builds**:
   ```bash
   npm start
   ```

3. **Check navigation and links**

4. **Commit changes**

## For Library Code

When migrating documentation versions, also update `<docs>` tags in library code.

### Best Practice: Use Versionless Paths

```csharp
// GOOD - versionless, works with any production version
/// <docs>core-concepts/dispatcher</docs>

// BAD - versioned, breaks when docs move
/// <docs>v0.1.0/core-concepts/dispatcher</docs>
```

### Updating Versioned Tags

To strip version prefixes from all `<docs>` tags:

```bash
cd /path/to/whizbang
grep -r "<docs>v[0-9]" src/ --include="*.cs" -l | \
  xargs sed -i '' 's/<docs>v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\//<docs>/g'
```

Then regenerate the code-docs mapping:

```bash
cd /path/to/whizbang-lib.github.io
node src/scripts/generate-code-docs-map.mjs
```

## Troubleshooting

### Migration fails with "Source directory not found"

Ensure the source version folder exists:
```bash
ls src/assets/docs/
```

### Files not being copied

Check the conflict strategy. With `--conflict-strategy target-wins`, existing files are skipped.

### Links still point to old version

1. Ensure you're not using `--no-cross-refs`
2. Check drafts/proposals folders manually
3. Run the full prebuild to regenerate indexes

### Changes not visible on site

Run the full prebuild pipeline:
```bash
npm run prebuild
npm start
```
