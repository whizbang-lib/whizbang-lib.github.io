# Architecture & Technical Stack

## Core Framework
- Angular 20.0.1 application for documentation and code examples
- Component prefix: `wb`
- Strict TypeScript configuration

## Key Dependencies
- **UI**: PrimeNG 19.1.3 + PrimeFlex for components
- **Markdown**: ngx-markdown 20.0.0 for documentation rendering
- **Diagrams**: Mermaid 11.12.0 for architectural diagrams and flowcharts
- **Syntax Highlighting**: Multiple options - PrismJS, Shiki, Highlight.js
- **Search**: MiniSearch 7.1.2 + Fuse.js 7.1.0 for full-text search

## Project Structure
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

## Key Components
- **EnhancedCodeBlockV2Component**: Advanced code display with syntax highlighting
- **EnhancedSearchComponent**: Full-text search with fuzzy matching
- **CodeSampleGalleryComponent**: Browse and display code examples

## Important Services
- **DocsService**: Handles documentation loading and navigation
- **SearchService**: Implements MiniSearch and Fuse.js for different search types
- **ShikiHighlightService/PrismService**: Syntax highlighting providers

## Build Outputs
- Development: Served from memory with HMR
- Production: `dist/whizbang-site/` with hashed assets

## Key Technical Decisions

### Mobile-First Design
- **Breakpoints**: 768px (tablet), 480px (mobile) matching design tokens
- **Touch Targets**: 44px minimum (tablet), 48px (small mobile) for WCAG compliance
- **Content Strategy**: Hide non-essential metadata on mobile to reduce clutter
- **Progressive Enhancement**: Mobile experience first, enhance for desktop

### Progressive Disclosure Pattern
- Essential information visible by default
- Secondary details behind "More Info" toggle (desktop) or modal (mobile)
- Chips hidden on mobile to maximize content focus
- Graceful degradation for all features

### AI/Search Architecture
- Build-time processing preferred over runtime for performance
- Pre-computed embeddings and metadata included in search index
- Hybrid scoring combines semantic similarity with keyword matching
- Zero impact on current search quality - AI enhances, never replaces

### Code Display Excellence
- Special handling for C# syntax highlighting
- Multiple syntax highlighters available (PrismJS, Shiki, Highlight.js)
- Enhanced code blocks with metadata, actions, and progressive disclosure
- Dark header forced in all themes for consistent branding