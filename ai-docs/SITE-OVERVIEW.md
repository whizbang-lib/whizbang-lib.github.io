# Site Overview — Start Here

> **Audience**: AI assistants and human contributors maintaining or enhancing this documentation site. This is the system-level map; focused ai-docs cover each subsystem in depth. Written 2026-07 during the docs-reconciliation initiative; update the "Current State" section as work lands.

## What this repo is

The documentation site **and living specification** for the Whizbang .NET library (sibling repo `../whizbang`). Documentation drives API design: a feature is documented first, tested second, implemented third. The site is dual-published:

1. **Angular SPA** at https://whizba.ng — GitHub Pages, CNAME in repo root
2. **ReadTheDocs mirror** at https://whizbang-docs.readthedocs.io — MkDocs Material, built by `rtd/build.py`

The same markdown under `src/assets/docs/` feeds both. Angular gets the full experience (versions, states, custom callouts, `<wb-*>` components); RTD gets a transformed consumer-only snapshot of `v1.0.0/`.

## Repo map

| Path | Purpose |
|---|---|
| `src/assets/docs/` | ALL documentation content (markdown). Folder hierarchy IS the nav tree. |
| `src/assets/docs/v1.0.0/` | Released consumer docs (~289 pages). Note: library is pre-1.0 (v0.8xx); "v1.0.0" means "targets the 1.0 API". Real rename happens at GA via `migrate-docs-version.mjs`. |
| `src/assets/docs/drafts/`, `proposals/`, `backlog/`, `declined/`, `roadmap/` | State folders for unreleased content |
| `src/assets/internal-docs/` | Hidden implementation notes (not published) |
| `src/scripts/*.mjs` | Build/index/audit tooling (see pipeline below) |
| `src/app/` | Angular 22 app (components/services/pages) — see `ai-docs/architecture.md` |
| `rtd/` + `mkdocs.yml` | ReadTheDocs build (`build.py` transforms + generates nav) |
| `mcp-docs-server/` | TypeScript MCP server exposing docs/code/tests queries — see `ai-docs/mcp-servers.md` |
| `audit-reports/` | Audit baseline outputs + 150-task master list (2026-03; re-baseline before trusting) |
| `ai-docs/` | Maintainer docs (this file, architecture, standards, versioning…) |
| `plans/` | Feature planning docs |

## Content pipeline (run automatically by `pnpm start` / `pnpm run build`)

| Script | Emits | Notes |
|---|---|---|
| `gen-docs-list.mjs` | `docs-list.json` | Flat slug list |
| `gen-docs-index-versioned.mjs` | `docs-index.json`, `docs-index-versioned.json`, `docs-nav-tree.json` | Frontmatter + reading time + edit URLs; nav tree from folders + `_folder.md` |
| `build-search-index.sh` → `gen-enhanced-search-index.mjs` | `search-index.json`, `enhanced-search-index.json` | Keyword + AI-enhanced search |
| `gen-static-docs.mjs` | `src/static/docs.html` | Pre-rendered fallback/SEO |
| `gen-sitemap` (inside indexer) | `src/assets/sitemap.xml` | |
| `generate-code-docs-map.mjs` | `code-docs-map.json` | Scans `../whizbang` for `/// <docs>path</docs>` tags (881 files). Run after library API changes. |
| `generate-code-tests-map.mjs` | `code-tests-map.json` (~6 MiB) | Convention `FooTests`→`Foo` + optional `<tests>` tags; ~1,300 test methods |
| `validate-frontmatter.mjs` | CI gate | Enforces required frontmatter + code-block metadata on `v1.0.0/` |
| `audit-baseline.mjs` | `audit-reports/*.json` | Full content audit (stale pages, frontmatter gaps, broken links) |
| `migrate-docs-version.mjs` | — | Bulk version-folder moves (for GA rename) |

**Iron rule**: any content move/add/delete must regenerate the indexes in the same PR, or the SPA 404s and search drifts. `_folder.md` files are load-bearing for BOTH Angular nav and RTD nav (`rtd/build.py build_nav()`).

## Frontmatter schema

Current required (validated on `v1.0.0/`): `title`, `description`, plus `category`, `order`, `tags`, `codeReferences` (paths into the library repo), `testReferences` (paths to test classes), `lastMaintainedCommit`.

Being added by the 2026-07 initiative (Diátaxis-based):
```yaml
pageType: overview | concept | tutorial | guide | reference | troubleshooting
audience: [consumer | contributor | porter]   # default [consumer]
status: current | draft | proposal | deprecated
```

## Docs ↔ Code ↔ Tests (living docs)

- Library source carries `/// <docs>versionless/path</docs>` tags → `code-docs-map.json`
- Tests link by naming convention (+ optional `<tests>` tags) → `code-tests-map.json`
- Doc pages point back via `codeReferences` / `testReferences` frontmatter and code-block metadata `{testFile, testMethod}`
- MCP server tools (`search-docs`, `get-code-location`, `get-tests-for-code`, `validate-doc-links`, …) query all of it
- **In progress (2026-07)**: live test pass/fail stitched into pages — library CI parses TRX → `test-status.json` → `repository_dispatch` → this repo commits `src/assets/data/test-status/` + redeploys; badges render per page/sample; RTD gets static injection at build time

## Conventions & gotchas

- **Package manager is pnpm** (Node 24). CLAUDE.md references to `bun` are historical. pnpm enforces `minimumReleaseAge` on new deps — a freshly published package version will fail CI install until it ages; this is deliberate supply-chain protection, don't bypass it.
- **Branch flow**: feature branch → PR → `develop` → promote to `main` (deploy). A GitHub Action auto-opens "sync main into develop" PRs after pushes to main. Never push directly to develop/main.
- **Squash merges hide history**: a branch can show "ahead" commits whose *content* is already fully in main. Judge branches by content diff of their touched files, not `rev-list` counts (this misled the 2026-07 triage until checked).
- **Shared checkout hazard**: multiple Claude sessions sometimes work in this same checkout. Don't switch branches or rewrite history without checking `git log` timestamps for foreign commits; commit early and often.
- **ngx-markdown 22** statically imports `marked-katex-extension` — it and `katex` must stay in devDependencies even though katex rendering is unused.
- **Angular-only syntax** (custom callouts `:::new`, `<wb-video>`, `<wb-example>`, `{#anchors}`) is stripped/transformed for RTD by `rtd/build.py`. If you add new custom syntax, extend `build.py` or RTD silently loses it.
- Verify UI changes in a real browser (dev server at `localhost:4200`); screenshot-verify before claiming done.

## Current state — 2026-07 reconciliation initiative

Plan lives at `~/.claude/plans/we-need-to-reconcile-swift-newell.md` (session-local); phases:

| Phase | Scope | Status |
|---|---|---|
| 0 | PR/branch/worktree/stash triage | DONE — 7 PRs resolved, ~24 stale remote + ~28 local branches deleted, 3 worktrees removed, stash content salvaged (backup: `~/src/whizbang/stash-backup-2026-07-16/`) |
| 0a | This document | DONE |
| 1 | Repo hygiene (root clutter, CLAUDE.md refresh) | pending |
| 2 | Re-baseline audit vs current library (v0.8xx) | DONE — see `audit-reports/REBASELINE-2026-07-16.md`; 63 missing pages demanded by code tags, work-coordinator dominates |
| 3 | Frontmatter taxonomy (pageType/audience/status) + validator | DONE — heuristic backfill on 251 pages (refine per-page in content passes); enforce with `validate-frontmatter.mjs --strict-taxonomy` when review completes |
| 4 | Audience trees: `contributors/`, `spec/` (porting) | pending |
| 5 | Live test-status pipeline (library CI → site badges) | pending |
| 6 | Example validation (drift check + compile gate) | pending |
| 7 | ASCII → mermaid (~86 files) | pending |
| 8 | MCP server npm publish (@whizbang/docs-mcp-server; verify scope, fallback @whizbang-lib) | pending |
| 9 | Page split/merge per taxonomy + summary pages | pending |

Decisions locked: Diátaxis taxonomy; push-based CI dispatch for test status; keep `v1.0.0/` folder until GA (UI label "pre-release"); hybrid bundle-first MCP packaging.
