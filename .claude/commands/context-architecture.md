Load documentation site architecture and technical details.

Read these files to understand the site architecture:
- ai-docs/architecture.md - Technical architecture, Angular 20, build process
- ai-docs/versioning-system.md - Version management with signals
- ai-docs/mcp-servers.md - MCP documentation server integration

Key components:
- **Angular 20** - Static site generation
- **Version management** - VersionService with signals
- **Search system** - AI-enhanced search with embeddings
- **MCP server** - Programmatic documentation access

Auto-build scripts:
- `gen-docs-list.mjs` - Documentation listing
- `gen-docs-index-versioned.mjs` - Version-aware index
- `build-search-index.sh` - Search indices

Services:
- **VersionService** - Core version management
- **HeaderProcessorService** - Automatic header processing
- **CalloutProcessorService** - Enhanced callout system

Use this command when:
- Working on site architecture
- Debugging build issues
- Understanding component relationships
