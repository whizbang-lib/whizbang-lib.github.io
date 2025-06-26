# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm start      # Start dev server with HMR at http://localhost:4200
npm run build  # Production build with output hashing
npm run preview # Serve production build locally
```

**Important**: The development server (`npm start`) is always running and automatically picks up live changes. Never run `npm start` during development sessions as it's already active.

### Build Process
The `npm start` and `npm run build` commands automatically execute:
1. `node src/scripts/gen-docs-list.mjs` - Generates documentation listing
2. `./build-search-index.sh` - Builds search indices  
3. `node src/scripts/gen-docs-index.mjs` (build only) - Creates docs index

### Testing
No standard Angular testing framework is configured. Testing is done through:
- Standalone HTML test files (e.g., `test-*.html`)
- Verification scripts (e.g., `verify-*.sh`)

## Architecture

### Core Framework
- Angular 20.0.1 application for documentation and code examples
- Component prefix: `wb`
- Strict TypeScript configuration

### Key Dependencies
- **UI**: PrimeNG 19.1.3 + PrimeFlex for components
- **Markdown**: ngx-markdown 20.0.0 for documentation rendering
- **Syntax Highlighting**: Multiple options - PrismJS, Shiki, Highlight.js
- **Search**: MiniSearch 7.1.2 + Fuse.js 7.1.0 for full-text search

### Project Structure
```
src/app/
├── components/       # Reusable UI (enhanced-code-block*, search, galleries)
├── services/         # Business logic (docs, search, syntax highlighting)
├── pages/           # Route components (home, docs, examples, videos)
├── layout/          # App layout components
└── config/          # Configuration modules

src/assets/
├── docs/            # Markdown documentation files
├── code-samples/    # Example code files
└── *.json          # Generated index files (do not edit manually)
```

### Key Components
- **EnhancedCodeBlockV2Component**: Advanced code display with syntax highlighting
- **EnhancedSearchComponent**: Full-text search with fuzzy matching
- **CodeSampleGalleryComponent**: Browse and display code examples

### Important Services
- **DocsService**: Handles documentation loading and navigation
- **SearchService**: Implements MiniSearch and Fuse.js for different search types
- **ShikiHighlightService/PrismService**: Syntax highlighting providers

### Build Outputs
- Development: Served from memory with HMR
- Production: `dist/whizbang-site/` with hashed assets

## Development Notes

1. The app uses a custom documentation system that automatically indexes markdown files from `src/assets/docs/`
2. Code samples in `src/assets/code-samples/` are indexed for the gallery
3. Search indices are generated during build - do not edit `*.json` index files manually
4. Multiple syntax highlighting libraries are available - the app can switch between them
5. C# code examples have special handling in the enhanced code block components

## Planning System

The `plans/` folder contains structured development plans for complex features and enhancements. This system helps track progress and maintain organization across Claude sessions.

### When to Use Planning
- Complex multi-step features requiring 3+ distinct actions
- Non-trivial tasks that need careful planning
- When user provides multiple tasks or features to implement
- Before starting any significant development work

### Plan Structure
Plans are organized in category folders:
- `search-enhancements/` - Search functionality improvements
- `ui-improvements/` - User interface enhancements  
- `performance-optimizations/` - Performance improvements
- `content-management/` - Content creation and organization
- `templates/` - Standardized plan templates

### Using the Planning System
1. **Check existing plans** before starting new work - update existing plans rather than creating duplicates
2. **Create new plans** using templates from `templates/` folder
3. **Update progress** using status conventions: ❌ Not Started, 🔄 In Progress, ⚠️ Blocked, ✅ Complete, 🧪 Testing
4. **Document decisions** and approach changes in Progress Tracking sections
5. **Be specific** with task descriptions and realistic with time estimates

### CRITICAL: Real-Time Plan Updates
**ALWAYS update plans in real-time as you work - this is mandatory for all sessions:**
- Mark tasks as `🔄 In Progress` when you START working on them
- Update with specific implementation details as you complete each step
- Mark as `✅ Complete` IMMEDIATELY when finished
- Track actual time spent vs estimates
- Document any deviations, additional work discovered, or technical decisions made
- Update progress percentages and phase status as work progresses
- Note any blockers or issues encountered in real-time

Plans must be living documents that accurately track the development process, not just end-state summaries. Update plans throughout the work session, not just at the end.

Always reference and update relevant plans during development sessions to maintain continuity.

## Temporary Files

Use the `claude-scratch/` folder for any temporary files including screenshots, test scripts, or other temporary assets. This keeps the project root clean and organized.