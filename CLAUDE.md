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

## Project Vision & Goals

### Site Purpose
This is a documentation website for the **Whizbang .NET library** - a comprehensive .NET/C# library for [library purpose]. The site provides:
- Complete API documentation and reference guides
- C# code examples demonstrating library usage
- Getting started tutorials and advanced configuration guides
- Interactive code samples and demonstrations

### Content Focus
- **Primary Language**: C# (.NET)
- **Documentation Types**: API references, tutorials, philosophy, getting started guides
- **Code Examples**: C# snippets with syntax highlighting and metadata
- **Sample Code**: Located in `src/assets/code-samples/` (note: some TypeScript/Angular samples exist for the documentation site itself)

### Target Experience
- **Clean, Mobile-First UI**: Optimized for viewing documentation on any device
- **Excellent Search**: Full-text search with MiniSearch + Fuse.js, with AI enhancements in progress
- **Code Display Excellence**: Enhanced code blocks optimized for C# examples with special handling
- **Progressive Disclosure**: Show essential information first, hide secondary details on mobile

### Tech Stack
- **Frontend**: Angular 20 application (this documentation site)
- **Documented Library**: .NET/C# (Whizbang library)
- **Rendering**: ngx-markdown for documentation, multiple syntax highlighters for code

## Active Development Initiatives

### Completed Initiatives ✅

#### Mobile Responsiveness Enhancement
**Status**: ✅ Complete (2025-06-19)
**Impact**: Significantly improved mobile user experience

Key achievements:
- **Chip decluttering**: All metadata chips (language, framework, difficulty, tags) hidden below 768px for cleaner mobile interface
- **Touch accessibility**: All interactive elements meet WCAG 44px minimum touch target requirements
- **Responsive navigation**: Hamburger menu with 320px tablet width, 100vw mobile width
- **Typography scaling**: Mobile-first typography system with proper hierarchy
- **Build impact**: Zero functionality regressions, clean mobile interface

See: [plans/ui-improvements/mobile-responsiveness-enhancement.md](plans/ui-improvements/mobile-responsiveness-enhancement.md)

#### Code Block Styling Improvements
**Status**: ✅ Complete (2025-06-19)
**Impact**: Polished, professional code block appearance

Key achievements:
- **Transparent tools container**: Buttons integrate seamlessly with dark header using `rgba(255, 255, 255, 0.1)` backgrounds
- **Pill/bubble chips**: All chips redesigned with `border-radius: 9999px` for modern appearance
- **Color-coded metadata**: Language, framework, difficulty, and tag chips with distinctive colors
- **Hover animations**: Subtle lift effects with `translateY(-1px)` for better UX
- **Layout optimization**: Tags moved inline with metadata to save vertical space

See: [plans/ui-improvements/code-block-styling-improvement.md](plans/ui-improvements/code-block-styling-improvement.md)

#### Enhanced Code Block Improvements
**Status**: ✅ Complete (2025-06-19)
**Impact**: Progressive disclosure for better content density

Key achievements:
- **More Info toggle**: Desktop shows/hides metadata with smooth animations
- **Mobile modal**: PrimeNG dialog for metadata on mobile devices
- **Icon-only buttons**: Show Full Code button converted to compact icon format
- **Content minimization**: Smaller fonts and optimized spacing on mobile (extra small at 480px)
- **Container constraints**: Max-width: 100vw with proper overflow handling

See: [plans/ui-improvements/enhanced-code-block-improvements.md](plans/ui-improvements/enhanced-code-block-improvements.md)

### In Progress 🔄

#### AI-Enhanced Search Implementation
**Status**: 🔄 Phase 1 Complete, Phase 2+ Ready
**Progress**: 7/20 tasks complete (35%)
**Current Phase**: Phase 1 (Build-Time Processing) ✅ Complete

**Completed (Phase 1)**:
- ✅ Build-time AI content processing with Node.js Transformers.js
- ✅ 384-dimensional embeddings using all-MiniLM-L6-v2 model
- ✅ Semantic keyword extraction and content classification
- ✅ Caching system for embeddings (17 embeddings cached successfully)
- ✅ Enhanced search index generation (233KB enhanced vs 31KB standard)
- ✅ Build time: ~45 seconds (vs 30 seconds baseline) - within target
- ✅ Full integration with build pipeline

**Next Steps (Phase 2-4)**:
- [ ] Create browser-side AI enhancement service for progressive loading
- [ ] Implement device capability detection and memory management
- [ ] Build hybrid search algorithm (60% semantic + 40% keyword)
- [ ] Add query understanding and result re-ranking
- [ ] Performance optimization and user notifications

**Technical Decisions**:
- Build-time preprocessing eliminates runtime AI performance impact
- all-MiniLM-L6-v2 chosen for balance of size (22MB) and accuracy (384 dimensions)
- Progressive enhancement strategy maintains current excellent search as baseline
- Graceful degradation for unsupported devices/browsers

See: [plans/search-enhancements/ai-search-enhancement.md](plans/search-enhancements/ai-search-enhancement.md)
See: [plans/search-enhancements/progress-tracker.md](plans/search-enhancements/progress-tracker.md)

### Key Technical Decisions

These architectural decisions should guide all future development:

#### Mobile-First Design
- **Breakpoints**: 768px (tablet), 480px (mobile) matching design tokens
- **Touch Targets**: 44px minimum (tablet), 48px (small mobile) for WCAG compliance
- **Content Strategy**: Hide non-essential metadata on mobile to reduce clutter
- **Progressive Enhancement**: Mobile experience first, enhance for desktop

#### Progressive Disclosure Pattern
- Essential information visible by default
- Secondary details behind "More Info" toggle (desktop) or modal (mobile)
- Chips hidden on mobile to maximize content focus
- Graceful degradation for all features

#### AI/Search Architecture
- Build-time processing preferred over runtime for performance
- Pre-computed embeddings and metadata included in search index
- Hybrid scoring combines semantic similarity with keyword matching
- Zero impact on current search quality - AI enhances, never replaces

#### Code Display Excellence
- Special handling for C# syntax highlighting
- Multiple syntax highlighters available (PrismJS, Shiki, Highlight.js)
- Enhanced code blocks with metadata, actions, and progressive disclosure
- Dark header forced in all themes for consistent branding

## Design System & UI Standards

These design standards have been established through implementation and should be maintained:

### Visual Design

#### Header & Container Styling
- **Code block headers**: Dark background (`--code-block-header-bg`) forced in all themes
- **Tools container**: Transparent background with subtle button styling
- **Button styling**: `rgba(255, 255, 255, 0.1)` backgrounds with hover effects
- **Hover animations**: `translateY(-1px)` with smooth transitions

#### Chip & Tag Styling
- **Shape**: Pill/bubble appearance with `border-radius: 9999px`
- **Size**: Vertically thin with `min-height: 1.5rem` and tight padding
- **Colors**: Color-coded by type:
  - Language chips: Dynamic colors via `getLanguageColor()` method
  - Framework chips: Success green (`--color-success`)
  - Difficulty chips: Severity-based (success/info/warning/danger)
  - Tag chips: Primary brand color (`--color-primary`)
- **Hover**: Lift effect with `box-shadow` and `color-mix()` for hover states

#### Responsive Behavior
- **Metadata chips**: Hidden below 768px to reduce mobile clutter
- **More Info content**: Toggle on desktop, modal on mobile
- **Typography**: Scaled down on mobile (md → sm → xs at breakpoints)
- **Spacing**: Reduced padding and margins on mobile

### Component Patterns

#### Code Blocks
- Header with title, metadata row (chips), and action buttons
- Transparent tools container integrated with header
- Progressive disclosure for description and metadata sections
- Mobile: Chips hidden, More Info opens modal, icon-only buttons

#### Navigation
- Hamburger menu with push sidebar
- Sidebar width: 320px (tablet), 100vw (mobile)
- 44px minimum touch targets throughout
- Responsive toolbar with mobile-optimized spacing

#### Search
- MiniSearch + Fuse.js baseline (excellent keyword search)
- AI enhancement as progressive addition (not replacement)
- Hybrid scoring when AI available (60% semantic + 40% keyword)
- Graceful fallback to keyword-only search

### Accessibility Standards
- **Touch targets**: 44px minimum (WCAG 2.1 Level AAA)
- **Color contrast**: Proper ratios maintained across themes
- **Focus indicators**: Visible focus states on all interactive elements
- **Screen readers**: ARIA labels and proper semantic HTML
- **Keyboard navigation**: Full functionality without mouse

### Theme System
- Light and dark themes supported
- CSS custom properties for all colors
- Dark header forced even in light theme (code blocks)
- Consistent visual language across themes

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