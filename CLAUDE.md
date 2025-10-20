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
2. `node src/scripts/gen-docs-index.mjs` - Creates docs index with metadata
3. `./build-search-index.sh` - Builds search indices

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

## Key Principles

- **C# Code Style**: All examples MUST follow K&R/Egyptian braces (opening brace on same line)
- **Documentation-First**: Write docs BEFORE implementation
- **Test-Driven Examples**: All examples must have corresponding tests
- **Mobile-First Design**: Progressive disclosure, touch-friendly
- **Roadmap Separation**: Unreleased features in `Roadmap/` directory only

## Current Development Status

**AI-Enhanced Search**: Phase 1 Complete (build-time processing with embeddings). Phase 2+ ready to begin.

For detailed status of all initiatives, see **[DEVELOPMENT-INITIATIVES.md](ai-docs/DEVELOPMENT-INITIATIVES.md)**.

## Notes

- **MCP Server**: Documentation server in `mcp-docs-server/` provides programmatic access to docs (see **[MCP-SERVERS.md](ai-docs/MCP-SERVERS.md)**)
- **Planning System**: Use `plans/` folder for complex features (see **[PLANNING-SYSTEM.md](ai-docs/PLANNING-SYSTEM.md)**)
- **Temporary Files**: Use `claude-scratch/` for temporary files, screenshots, etc.
