# CLAUDE.md

> **Navigation Index**: Quick reference for working on the Whizbang documentation website. For detailed guidance on specific topics, refer to focused ai-docs.

---

## Site Overview

This is a documentation website for the **Whizbang .NET library** - built with Angular 20. It provides API docs, tutorials, and C# code examples with advanced search and syntax highlighting.

**Documentation Philosophy**: This serves as both user-facing documentation AND the living specification for the Whizbang library. Documentation drives API design. A feature is not complete until fully documented with examples.

---

## Essential Commands

```bash
npm start      # Start dev server with HMR at http://localhost:4200
npm run build  # Production build with output hashing
npm run preview # Serve production build locally
```

**IMPORTANT**: The development server (`npm start`) is **always running** during development sessions and automatically picks up live changes. **Never run `npm start`** during development sessions as it's already active.

---

## Build Process

The `npm start` and `npm run build` commands automatically execute:
1. `node src/scripts/gen-docs-list.mjs` - Generates documentation listing
2. `node src/scripts/gen-docs-index-versioned.mjs` - Creates version-aware docs index with metadata
3. `./build-search-index.sh` - Builds search indices with version support

---

## Change Verification - CRITICAL

**Claude MUST verify all UI/visual changes using Playwright browser automation before considering work complete**:

1. Make changes to code
2. Use `mcp__playwright__browser_navigate` to visit the affected page
3. Use `mcp__playwright__browser_take_screenshot` to capture the current state
4. Examine the screenshot to verify the change worked as intended
5. If the change didn't work, investigate and fix before claiming completion

**DO NOT** rely on user verification - Claude must validate changes independently using browser automation tools.

📖 **Use slash command**: `/verify` for browser verification workflow

---

## When to Read ai-docs/

### 📖 **[PROJECT-VISION.md](ai-docs/PROJECT-VISION.md)**
**Read when**:
- Starting work on the documentation site
- Need to understand documentation philosophy
- Making major architectural decisions

### 📖 **[ARCHITECTURE.md](ai-docs/ARCHITECTURE.md)**
**Read when**:
- Working on Angular 20 components or services
- Need to understand project structure
- Adding new features to the site

### 📖 **[STANDARDS.md](ai-docs/STANDARDS.md)**
**Read when**:
- Writing or editing documentation content
- Need code style guidelines (K&R/Egyptian braces for C# examples)
- Reviewing anti-patterns to avoid

### 📖 **[DESIGN-SYSTEM.md](ai-docs/DESIGN-SYSTEM.md)**
**Read when**:
- Working on UI/UX components
- Need visual design standards
- Making accessibility improvements

### 📖 **[MERMAID-DIAGRAMS.md](ai-docs/MERMAID-DIAGRAMS.md)**
**Read when**:
- Creating or editing diagrams
- Need color schemes and styling guidelines
- Working on visual documentation

### 📖 **[MCP-SERVERS.md](ai-docs/MCP-SERVERS.md)**
**Read when**:
- Working with MCP documentation server
- Need to understand MCP tool usage
- Debugging MCP integration

### 📖 **[ROADMAP-DOCS.md](ai-docs/ROADMAP-DOCS.md)**
**Read when**:
- Documenting unreleased features
- Working with drafts/, proposals/, or backlog/ folders
- Need versioning guidance

### 📖 **[DEVELOPMENT-INITIATIVES.md](ai-docs/DEVELOPMENT-INITIATIVES.md)**
**Read when**:
- Need current project status
- Starting new initiative
- Reviewing completed work

### 📖 **[PLANNING-SYSTEM.md](ai-docs/PLANNING-SYSTEM.md)**
**Read when**:
- Planning complex features
- Creating planning documents in plans/ folder
- Need requirements documentation structure

### 📖 **[versioning-system.md](ai-docs/versioning-system.md)**
**Read when**:
- Working with version folders (v1.0.0/, v1.1.0/, etc.)
- Need to understand version dropdown or state navigation
- Implementing version-aware features

### 📖 **[alt-text-standards.md](ai-docs/alt-text-standards.md)**
**Read when**:
- Adding or editing images
- Need SEO optimization guidance
- Working on accessibility improvements

---

## Slash Commands (`.claude/commands/`)

Quick access to common workflows via `/command-name`:

- `/verify` - **CRITICAL**: Verify UI changes with Playwright browser automation
- `/build` - Production build with all pre-build steps
- `/search-docs` - Search Whizbang documentation via MCP server
- `/rebuild-mcp` - Rebuild code-docs map and restart MCP server
- `/verify-links` - Validate all `<docs>` tags point to valid documentation
- `/context-architecture` - Load site architecture and Angular 20 documentation
- `/context-standards` - Load documentation and code standards
- `/context-seo` - Load SEO optimization guidelines
- `/context-versioning` - Load version management system documentation
- `/context-planning` - Load planning system for complex features

---

## Code-Docs Linking System

Bidirectional linking between library source code and documentation:

**Architecture**:
1. **`<docs>` XML tags** - Added to library source code (e.g., `/// <docs>core-concepts/dispatcher</docs>`)
2. **generate-code-docs-map.mjs** - Script that scans library code and extracts mappings
3. **code-docs-map.json** - Generated mapping file (file, line, symbol, docs URL)
4. **MCP Server Tools** - Programmatic access to mappings

**MCP Tools**:
- `mcp__whizbang-docs__get-code-location` - Find code implementing a documentation concept
- `mcp__whizbang-docs__get-related-docs` - Find documentation for a code symbol
- `mcp__whizbang-docs__validate-doc-links` - Validate all code-docs links

**Workflow**:
1. Add `<docs>` tags to library source code (in sibling `whizbang/` repository)
2. Run `node src/scripts/generate-code-docs-map.mjs` to regenerate mapping
3. Use MCP tools to query and validate links
4. Slash commands: `/rebuild-mcp` and `/verify-links`

---

## Code-Tests Linking System

Bidirectional linking between library source code and tests for test coverage awareness:

**Architecture**:
1. **Convention-based discovery** - Automatically links tests via naming patterns (e.g., `DispatcherTests` → `Dispatcher`)
2. **`<tests>` XML tags** (optional) - Manual override for complex cases
3. **generate-code-tests-map.mjs** - Script that scans tests and source code
4. **code-tests-map.json** - Bidirectional mapping file
5. **MCP Server Tools** - Programmatic access to test mappings

**MCP Tools**:
- `mcp__whizbang-docs__get-tests-for-code` - Find all tests for a code symbol
- `mcp__whizbang-docs__get-code-for-test` - Find code tested by a test method
- `mcp__whizbang-docs__validate-test-links` - Validate all code-test links
- `mcp__whizbang-docs__get-coverage-stats` - Get test coverage statistics

**Workflow**:
1. Write tests following naming convention (`ClassNameTests` tests `ClassName`)
2. Optionally add `<tests>` tags for explicit links
3. Run `node src/scripts/generate-code-tests-map.mjs` to regenerate mapping
4. Use MCP tools to query test coverage

**Status**: Phase 1 complete - Script-based generation and MCP tools operational.

---

## Versioning System

Comprehensive documentation versioning with filesystem-based organization:

### Version Structure
```
src/assets/docs/
├── v1.0.0/           # Released versions
├── v1.1.0/
├── v1.2.0/
├── drafts/           # Draft documentation (unreleased)
├── proposals/        # Feature proposals
├── backlog/          # Future features
└── declined/         # Declined features
```

### Key Features
- **Version Dropdown**: Dynamic version selector showing released, development, and planned versions
- **Interactive Headers**: Auto-generated kebab-case anchors with hover link icons and copy-to-clipboard
- **Enhanced Callouts**: Five callout types (`:::new`, `:::updated`, `:::deprecated`, `:::planned`, `:::new{type="breaking"}`)
- **Cross-Version Linking**: Planned callouts can link to future versions with validation
- **Version-Aware Search**: Filter by current version with "All versions" option
- **State Navigation**: Browse drafts, proposals, backlog, declined

### Services
- **VersionService** (`src/app/services/version.service.ts`): Core version management with Angular signals
- **HeaderProcessorService** (`src/app/services/header-processor.service.ts`): Automatic header processing
- **CalloutProcessorService** (`src/app/services/callout-processor.service.ts`): Enhanced callout system

### Configuration
Each version/state folder contains `_folder.md` with metadata:
```yaml
---
title: "Version 1.0.0"
description: "Initial stable release"
releaseDate: "2024-01-15"
status: "released"
---
```

📖 **Read**: `ai-docs/versioning-system.md` for complete versioning documentation

---

## Key Principles

- **C# Code Style**: All examples MUST follow K&R/Egyptian braces (opening brace on same line)
- **Documentation-First**: Write docs BEFORE implementation
- **Test-Driven Examples**: All examples must have corresponding tests in library repo
- **Mobile-First Design**: Progressive disclosure, touch-friendly
- **Version-Based Organization**: Released features in version folders, unreleased in state folders
- **SEO Optimization**: Comprehensive structured data automatically generated
- **Browser Verification**: All UI changes must be validated with Playwright

---

## Current Development Status

**Documentation Versioning System**: Complete - Comprehensive filesystem-based versioning with interactive features

**SEO Enhancement**: Complete - Comprehensive structured data, meta descriptions, XML sitemap, and alt text optimization

**AI-Enhanced Search**: Phase 1 Complete (build-time processing with embeddings). Phase 2+ ready to begin.

📖 **Read**: `ai-docs/DEVELOPMENT-INITIATIVES.md` for detailed initiative status

---

## Cross-Repository Context

**Workspace CLAUDE.md**: `/Users/philcarbone/src/CLAUDE.md` - Navigation between repos
**Library Repo**: `/Users/philcarbone/src/whizbang/` - .NET library implementation
**VSCode Extension**: `/Users/philcarbone/src/whizbang-vscode/` - IDE integration

📖 **Read workspace CLAUDE.md** when working across multiple repositories

---

## Notes

- **MCP Server**: Documentation server in `mcp-docs-server/` provides programmatic access to docs
- **Code-Docs Linking**: Bidirectional navigation via `<docs>` tags, code-docs-map.json, and MCP tools
- **Code-Tests Linking**: Test coverage awareness via convention-based mapping and MCP tools
- **Documentation Maintenance**: When library code changes public APIs, docs must be updated (see `/Users/philcarbone/src/whizbang/ai-docs/documentation-maintenance.md`)
- **Planning System**: Use `plans/` folder for complex features (see ai-docs/PLANNING-SYSTEM.md)
- **Temporary Files**: Use `claude-scratch/` for temporary files, screenshots, etc.
- **This file is intentionally concise** - detailed guidance lives in ai-docs/
