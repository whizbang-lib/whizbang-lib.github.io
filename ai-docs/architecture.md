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
├── docs/            # Markdown documentation files (folder hierarchy IS the nav tree)
├── code-samples/    # Example code files
├── docs-index.json          # Flat index for v1.0.0 (backward compat, generated)
├── docs-index-versioned.json # Flat index all versions (generated)
├── docs-nav-tree.json       # Nested nav tree from folder hierarchy (generated)
└── *.json                   # Other generated index files (do not edit manually)
```

## Sidebar Navigation System

The sidebar menu is **folder-driven** — the folder hierarchy under `src/assets/docs/` IS the navigation tree. No `category` frontmatter needed for navigation grouping.

### How it works
1. **`gen-docs-index-versioned.mjs`** recursively walks each version/state directory, building a nested tree. Each folder's `_folder.md` provides `title`, `order`, and optional `icon`. Output: `docs-nav-tree.json`.
2. **`hamburger-menu.component.ts`** loads `docs-nav-tree.json` via HTTP and converts it to `CustomMenuItem[]` recursively. Active route auto-expands the full folder chain.
3. **`custom-navigation-menu.component.ts`** renders the recursive tree with 4 visual tiers:
   - **Level 0** (top-level): Home, Examples, Documentation — nav items
   - **Level 1** (second-level): Doc folders like Configuration, Components — uppercase section headers
   - **Level 2** (third-level): Pages + subfolders inside those folders
   - **Level 3+** (deep-level): Progressively indented with colored left borders (purple → pink → orange)
4. **`breadcrumb.service.ts`** uses the nav tree to build full folder-path breadcrumbs with proper titles from `_folder.md`.

### Adding new doc folders
- Create a folder under a version directory (e.g., `v1.0.0/my-section/`)
- Add a `_folder.md` with `title` and `order` in frontmatter
- Add `.md` files inside — they appear as pages
- Subfolders nest automatically to any depth
- Run `node src/scripts/gen-docs-index-versioned.mjs` to regenerate (also runs in `prestart`/`prebuild`)

### Adding new versions
- Create a folder matching `v*.*.* ` pattern (e.g., `src/assets/docs/v2.0.0/`)
- Add a `_folder.md` with version metadata
- The script auto-discovers it — no config changes needed

### Generated outputs (do not edit)
- **`docs-index.json`** — flat index for v1.0.0 production (backward compat for search, breadcrumbs, structured data)
- **`docs-index-versioned.json`** — flat index for all versions/states
- **`docs-nav-tree.json`** — nested tree for sidebar navigation

### Brand styling
Active states use a brand gradient left border (`#ff7c00 → #ff0066 → #7b3ff8`). The brand colors are defined as CSS custom properties in `_design-tokens.scss` (`--brand-orange`, `--brand-pink`, `--brand-purple`).

### z-index layers
The home page starfield uses `z-index: 9990`. The sidebar and header use `z-index: 10000`. PrimeNG overlays (version popover, search, tooltips) use `baseZIndex: 10001+`.

## Key Components
- **EnhancedCodeBlockV2Component**: Advanced code display with syntax highlighting
- **EnhancedSearchComponent**: Full-text search with fuzzy matching
- **CodeSampleGalleryComponent**: Browse and display code examples
- **CustomNavigationMenuComponent**: Recursive sidebar menu with unlimited nesting depth
- **HamburgerMenuComponent**: Push sidebar housing navigation, version selector, and settings

## Important Services
- **DocsService**: Handles documentation loading and navigation
- **SearchService**: Implements MiniSearch and Fuse.js for different search types
- **BreadcrumbService**: Builds folder-path breadcrumbs using the nav tree
- **VersionService**: Version management with Angular signals, auto-discovers version folders
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