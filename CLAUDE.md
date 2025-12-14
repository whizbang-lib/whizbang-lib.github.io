# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This is a concise index. For detailed information on specific topics, refer to the focused documentation files in the `ai-docs/` directory.

## Quick Reference

### Essential Commands
```bash
npm start      # Start dev server with HMR at http://localhost:4200
npm run build  # Production build with output hashing
npm run preview # Serve production build locally
```

**Important**: The development server (`npm start`) is always running and automatically picks up live changes. Never run `npm start` during development sessions as it's already active.

### Build Process
The `npm start` and `npm run build` commands automatically execute:
1. `node src/scripts/gen-docs-list.mjs` - Generates documentation listing
2. `node src/scripts/gen-docs-index-versioned.mjs` - Creates version-aware docs index with metadata
3. `./build-search-index.sh` - Builds search indices with version support

### Code-Docs Linking System

This project implements bidirectional linking between library source code and documentation:

**Architecture**:
1. **`<docs>` XML tags** - Added to library source code (e.g., `/// <docs>core-concepts/dispatcher</docs>`)
2. **generate-code-docs-map.mjs** - Script that scans library code and extracts mappings
3. **code-docs-map.json** - Generated mapping file (file, line, symbol, docs URL)
4. **MCP Server Tools** - Programmatic access to mappings

**MCP Tools Available**:
- `mcp__whizbang-docs__get-code-location` - Find code implementing a documentation concept
- `mcp__whizbang-docs__get-related-docs` - Find documentation for a code symbol
- `mcp__whizbang-docs__validate-doc-links` - Validate all code-docs links

**Usage Examples**:
```typescript
// Find where IDispatcher is implemented
mcp__whizbang-docs__get-code-location({ concept: "dispatcher" })
// Returns: { found: true, file: "src/Whizbang.Core/IDispatcher.cs", line: 14, ... }

// Find docs for IReceptor symbol
mcp__whizbang-docs__get-related-docs({ symbol: "IReceptor" })
// Returns: { found: true, url: "core-concepts/receptors", title: "Receptors", ... }

// Validate all links
mcp__whizbang-docs__validate-doc-links()
// Returns: { valid: 5, broken: 0, details: [...] }
```

**Workflow**:
1. Add `<docs>` tags to library source code (in sibling `whizbang/` repository)
2. Run `node src/scripts/generate-code-docs-map.mjs` to regenerate mapping
3. Use MCP tools to query and validate links
4. Slash commands: `/rebuild-mcp` and `/verify-links` (see below)

### Code-Tests Linking System

**NEW**: Bidirectional linking between library source code and tests for improved test coverage awareness:

**Architecture**:
1. **Convention-based discovery** - Automatically links tests to code via naming patterns (e.g., `DispatcherTests` → `Dispatcher`)
2. **`<tests>` XML tags** (optional) - Manual override for complex cases (e.g., `/// <tests>Whizbang.Core.Tests/DispatcherTests.cs:Dispatch_SendsMessageToCorrectReceptorAsync</tests>`)
3. **generate-code-tests-map.mjs** - Script that scans tests and source code
4. **code-tests-map.json** - Bidirectional mapping file (code→tests, tests→code)
5. **MCP Server Tools** - Programmatic access to test mappings

**MCP Tools Available**:
- `mcp__whizbang-docs__get-tests-for-code` - Find all tests for a code symbol
- `mcp__whizbang-docs__get-code-for-test` - Find code tested by a test method
- `mcp__whizbang-docs__validate-test-links` - Validate all code-test links
- `mcp__whizbang-docs__get-coverage-stats` - Get test coverage statistics

**Usage Examples**:
```typescript
// Find tests for IDispatcher
mcp__whizbang-docs__get-tests-for-code({ symbol: "Dispatcher" })
// Returns: { found: true, tests: [...], testCount: 15 }

// Find code tested by a specific test
mcp__whizbang-docs__get-code-for-test({ testKey: "DispatcherTests.Dispatch_SendsMessageToCorrectReceptorAsync" })
// Returns: { found: true, code: [...], codeCount: 1 }

// Get coverage statistics
mcp__whizbang-docs__get-coverage-stats()
// Returns: { totalCodeSymbols: 86, totalTestMethods: 1303, averageTestsPerSymbol: 15.1, ... }
```

**Workflow**:
1. Write tests following naming convention (`ClassNameTests` tests `ClassName`)
2. Optionally add `<tests>` tags for explicit links
3. Run `node src/scripts/generate-code-tests-map.mjs` to regenerate mapping
4. Use MCP tools to query test coverage

**Status**: Phase 1 complete - Script-based generation and MCP tools operational. Source generator and analyzer planned for v2.

### Change Verification Requirements

**CRITICAL**: Claude MUST verify all UI/visual changes using Playwright browser automation before considering work complete:
1. Make changes to code
2. Use `mcp__playwright__browser_navigate` to visit the affected page
3. Use `mcp__playwright__browser_take_screenshot` to capture the current state
4. Examine the screenshot to verify the change worked as intended
5. If the change didn't work, investigate and fix before claiming completion

**DO NOT** rely on user verification - Claude must validate changes independently using browser automation tools.

## Site Overview

This is a documentation website for the **Whizbang .NET library** - a comprehensive .NET/C# library. Built with Angular 20, it provides API docs, tutorials, and C# code examples with advanced search and syntax highlighting.

## Documentation Philosophy

This documentation serves as both user-facing documentation AND the living specification for the Whizbang library. Documentation drives API design, and examples validate usability. A feature is not complete until fully documented with examples.

## Detailed Documentation

For comprehensive information on specific topics, refer to these focused documentation files:

### 📁 Core Documentation (`ai-docs/`)

- **[PROJECT-VISION.md](ai-docs/PROJECT-VISION.md)** - Project goals, vision, and documentation philosophy
- **[ARCHITECTURE.md](ai-docs/ARCHITECTURE.md)** - Technical architecture, project structure, key components
- **[STANDARDS.md](ai-docs/STANDARDS.md)** - Code standards, documentation requirements, anti-patterns
- **[DESIGN-SYSTEM.md](ai-docs/DESIGN-SYSTEM.md)** - UI/UX standards, visual design, accessibility
- **[MERMAID-DIAGRAMS.md](ai-docs/MERMAID-DIAGRAMS.md)** - Visual diagram guidelines and color schemes
- **[MCP-SERVERS.md](ai-docs/MCP-SERVERS.md)** - MCP server integration and configuration
- **[ROADMAP-DOCS.md](ai-docs/ROADMAP-DOCS.md)** - How to document unreleased features
- **[DEVELOPMENT-INITIATIVES.md](ai-docs/DEVELOPMENT-INITIATIVES.md)** - Current and completed development initiatives
- **[PLANNING-SYSTEM.md](ai-docs/PLANNING-SYSTEM.md)** - Development planning system and requirements

### 📁 Other Important Files

- **[CODE_SAMPLES.editorconfig](CODE_SAMPLES.editorconfig)** - C# code style for examples (K&R/Egyptian braces)
- **[DOCUMENTATION-STANDARDS.md](DOCUMENTATION-STANDARDS.md)** - Comprehensive documentation standards

### ⚡ Slash Commands (`.claude/commands/`)

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

See `.claude/commands/` for all available commands.

## Key Principles

- **C# Code Style**: All examples MUST follow K&R/Egyptian braces (opening brace on same line)
- **Documentation-First**: Write docs BEFORE implementation
- **Test-Driven Examples**: All examples must have corresponding tests
- **Mobile-First Design**: Progressive disclosure, touch-friendly
- **Version-Based Organization**: Released features in version folders (v1.0.0/, v1.1.0/), unreleased in state folders (drafts/, proposals/, backlog/, declined/)
- **SEO Optimization**: Comprehensive structured data automatically generated for all pages

## Versioning System

This project implements a comprehensive documentation versioning system with filesystem-based organization:

### Version Structure
```
src/assets/docs/
├── v1.0.0/           # Released versions (folders with version numbers)
├── v1.1.0/
├── v1.2.0/
├── drafts/           # Draft documentation for unreleased features
├── proposals/        # Feature proposals and design documents
├── backlog/          # Future feature documentation
└── declined/         # Declined feature documentation
```

### Key Features
- **Version Dropdown**: Dynamic version selector in header showing released, development, and planned versions
- **Interactive Headers**: All headers auto-generate kebab-case anchors with hover link icons and copy-to-clipboard
- **Enhanced Callouts**: Five callout types (`:::new`, `:::updated`, `:::deprecated`, `:::planned`, `:::new{type="breaking"}`)
- **Cross-Version Linking**: Planned callouts can link to future versions with validation
- **Version-Aware Search**: Search results filter by current version with "All versions" option
- **State Navigation**: Browse drafts, proposals, backlog, and declined features

### Services
- **VersionService** (`src/app/services/version.service.ts`): Core version management with Angular signals
- **HeaderProcessorService** (`src/app/services/header-processor.service.ts`): Automatic header processing and anchor generation  
- **CalloutProcessorService** (`src/app/services/callout-processor.service.ts`): Enhanced callout system with styling

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

## Current Development Status

**Documentation Versioning System**: Complete - Comprehensive filesystem-based versioning with interactive features.

**SEO Enhancement**: Complete - Comprehensive structured data, meta descriptions, XML sitemap, and alt text optimization.

**AI-Enhanced Search**: Phase 1 Complete (build-time processing with embeddings). Phase 2+ ready to begin.

For detailed status of all initiatives, see **[DEVELOPMENT-INITIATIVES.md](ai-docs/DEVELOPMENT-INITIATIVES.md)**.

## Notes

- **MCP Server**: Documentation server in `mcp-docs-server/` provides programmatic access to docs (see **[MCP-SERVERS.md](ai-docs/MCP-SERVERS.md)**)
- **Code-Docs Linking**: Bidirectional navigation via `<docs>` tags, code-docs-map.json, and MCP tools (see Code-Docs Linking System above)
- **Documentation Maintenance**: When library code changes public APIs, docs must be updated (see `/Users/philcarbone/src/whizbang/ai-docs/documentation-maintenance.md`)
- **Planning System**: Use `plans/` folder for complex features (see **[PLANNING-SYSTEM.md](ai-docs/PLANNING-SYSTEM.md)**)
- **Temporary Files**: Use `claude-scratch/` for temporary files, screenshots, etc.
