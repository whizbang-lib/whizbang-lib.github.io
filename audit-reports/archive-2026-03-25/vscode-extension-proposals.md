# VSCode Extension Enhancement Proposals

Generated: 2026-03-26

## Current State (v0.6.1)

The extension provides: Code Lens (dispatch/receptor/perspective/test counts), Hover tooltips (message flow + docs links), Navigation commands (go to dispatcher/receptor/perspective), and Type docs from remote feed.

**Data consumed**: `.whizbang/message-registry.json` (local) + `vscode-feed.json` (remote cached).

## Untapped Data Sources

| Source | Used? | Size | Potential |
|--------|-------|------|-----------|
| `code-docs-map.json` | No | 2.9K lines | Symbol→docs for ALL types, not just messages |
| `code-tests-map.json` | No | 118K lines | Bidirectional code↔test navigation |
| `keyword-synonyms.json` | No | 25 concepts | Intelligent "help me with X" search |

## Proposals (Priority Order)

### P1: Doc Search from VSCode
**Effort**: M | **Value**: HIGH

Add a `whizbang.searchDocs` command (Cmd+Shift+D) that opens a QuickPick search powered by the docs site's search index or keyword-synonyms.json. Results open in a webview panel or external browser.

**Implementation**: Fetch `enhanced-search-index.json` from docs site, cache locally, use for fuzzy search. Leverage keyword-synonyms.json to expand queries (user types "read model" → also searches "perspective", "projection").

### P2: Complete Type Documentation via code-docs-map
**Effort**: S | **Value**: HIGH

Extend `TypeDocsProvider` to also consume `code-docs-map.json` for ANY Whizbang type (not just messages). When hovering over `ILifecycleCoordinator`, show its doc page link even if it's not in the message registry.

**Implementation**: Fetch and cache `code-docs-map.json` alongside vscode-feed.json. On hover, check both sources.

### P3: Test Coverage Code Lens
**Effort**: M | **Value**: HIGH

Use `code-tests-map.json` to show test count and "Run Tests" action for any symbol. Code Lens line: "🧪 5 tests | Run". Click opens test file at the relevant test method.

**Implementation**: Fetch `code-tests-map.json`, parse codeToTests entries, add CodeLens for symbols that have tests. "Run Tests" command opens terminal with `dotnet run -- --treenode-filter "/path/to/test"`.

### P4: Reverse Test Navigation
**Effort**: S | **Value**: MEDIUM

When in a test file, show which source code is being tested. Code Lens above test class: "Tests: IDispatcher, Dispatcher". Click jumps to source.

**Implementation**: Use `code-tests-map.json`'s `testsToCode` direction.

### P5: Flow Diagram Rendering
**Effort**: L | **Value**: MEDIUM

Implement the placeholder `showFlowDiagram` command. Render a Mermaid diagram in a webview showing the full message flow: Dispatcher → Receptor → Events → Perspectives.

**Implementation**: Generate Mermaid from message-registry.json (dispatchers → message → receptors + perspectives). Render in webview with mermaid.js.

### P6: Stale Docs Indicator
**Effort**: S | **Value**: MEDIUM

When `lastMaintainedCommit` is available (via code-docs-map or vscode-feed), show a warning Code Lens when the current library commit is ahead of the last maintained commit: "⚠️ Docs may be outdated".

### P7: Keyboard Shortcut for Doc Search
**Effort**: S | **Value**: LOW

Add keybinding `Cmd+K D` (or similar chord) to trigger doc search. Standard pattern from other doc-heavy extensions.

### P8: Status Bar Widget
**Effort**: S | **Value**: LOW

Show `Whizbang: 45 messages | 32 receptors | 15 perspectives` in the status bar. Click opens summary panel.

## Implementation Notes

- All remote data should be cached with configurable TTL (existing pattern in TypeDocsProvider)
- Use pnpm (not npm) for package management
- Extension is TypeScript, compiled with esbuild
- F5 to test in Extension Development Host
