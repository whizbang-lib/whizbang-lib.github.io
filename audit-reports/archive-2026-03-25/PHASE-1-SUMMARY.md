# Phase 1: Audit Baseline Summary

Generated: 2026-03-25

## Executive Summary

| Metric | Value | Severity |
|--------|-------|----------|
| Total doc pages (v1.0.0) | 243 | — |
| Pages with frontmatter gaps | 243 (100%) | MEDIUM — all pages missing at least `slug` |
| Code samples total | 3,118 | — |
| Code samples without metadata | 139 (4.5%) | LOW — most have metadata |
| Undocumented public types | 514/1,060 (52% coverage) | HIGH — half the public API lacks `<docs>` tags |
| Broken code-docs links | 49/495 (10%) | MEDIUM — pages referenced but don't exist |
| Mermaid diagrams | 39 across 11 files | — |
| Unclosed callouts | 0 | GOOD |
| Search chunks with markdown leaks | 523 | HIGH — tables (418), callouts (107), code metadata (37) |
| Potentially stale doc pages | 288 | HIGH — library has 855 changed files in 6 months |
| Broken internal links | 4/834 | LOW — good link hygiene |
| Persona coverage gaps | 15 | MEDIUM |

## Frontmatter Field Coverage

| Field | Present | Missing | Coverage |
|-------|---------|---------|----------|
| title | 213 | 30 | 88% |
| version | 164 | 79 | 67% |
| category | 174 | 69 | 72% |
| order | 190 | 53 | 78% |
| description | 170 | 73 | 70% |
| tags | 167 | 76 | 69% |
| codeReferences | 116 | 127 | 48% |
| slug | 0 | 243 | 0% (all use filename default) |

**Note**: `slug` may not be needed if filename-based slugs are the standard convention. `codeReferences` at 48% is the most actionable gap — 127 pages need library file links added.

## Search Index Quality

Top leak patterns in search chunks:
- **Table syntax** (`|`): 418 chunks — the search index isn't stripping markdown table formatting
- **Callout syntax** (`:::`): 107 chunks — custom callout markers leak into searchable text
- **Code metadata** (`{title:...}`): 37 chunks — enhanced code block metadata not stripped
- **Markdown headers** (`#`): 6 chunks — mostly cleaned but a few leak through
- **Component tags** (`<wb-`): 1 chunk

## RTD Alignment

Key gaps:
- **Angular → RTD**: Code block metadata (titles, descriptions, framework tags) stripped entirely; `<wb-video>` and `<wb-example>` components disappear; callout version attributes lost
- **RTD → Angular**: Tabbed content (`pymdownx.tabbed`) not supported in Angular site; generic collapsible details not supported
- Recommendation: Treat RTD as read-only mirror; add fallback text for components in build.py

## Reports Generated

All in `audit-reports/`:
- `audit-summary.json` — Executive summary with highlight numbers
- `frontmatter-gaps.json` — Per-page frontmatter field analysis
- `code-samples-inventory.json` — Every code block with metadata status
- `undocumented-public-types.json` — Public types without `<docs>` tags
- `broken-code-docs-links.json` — `<docs>` tags pointing to non-existent pages
- `mermaid-inventory.json` — All mermaid diagrams with type and location
- `callout-inventory.json` — All callout blocks with closure status
- `search-index-quality.json` — Chunks with raw markdown leaking into search
- `stale-docs-candidates.json` — Docs linked to recently-changed source files
- `cross-link-map.json` — Internal markdown link validation
- `persona-coverage.json` — User-dev vs contributor doc overlap analysis
- `rtd-alignment-analysis.json` — Feature parity comparison
- `library-changes-6mo.txt` — Git history of library changes
- `validate-links-output.txt` — Existing link validator output (all 1,269 links valid)
- `validate-alt-text-output.txt` — Alt text validation output
- `code-docs-map-output.txt` — Code-docs map generation warnings
- `code-tests-map-output.txt` — Code-tests map generation warnings
