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
- **Planning System**: Use `plans/` folder for complex features (see **[PLANNING-SYSTEM.md](ai-docs/PLANNING-SYSTEM.md)**)
- **Temporary Files**: Use `claude-scratch/` for temporary files, screenshots, etc.
