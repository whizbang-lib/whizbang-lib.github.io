---
title: Contributing to Whizbang
pageType: overview
audience: [contributor]
status: current
order: 1
description: How to contribute to the Whizbang library, documentation, and tooling — workflow, standards, and where everything lives
tags: contributing, development-workflow, documentation, tdd
---

# Contributing to Whizbang

Whizbang follows a **documentation-first** philosophy: features are documented before they are tested, and tested before they are implemented. Contributions flow through three linked repositories:

| Repository | What it holds |
|---|---|
| `whizbang` | The .NET library — source, tests (TUnit), source generators |
| `whizbang-lib.github.io` | This documentation site (Angular + ReadTheDocs mirror) and the living specification |
| `whizbang-vscode` | VSCode extension for IDE integration |

## The workflow

1. **Document first** — create a proposal in the docs repo (`proposals/`), refine it into `drafts/` with full API examples.
2. **Test second** — write failing tests in the library repo derived from the documented examples (strict red→green→refactor; a test that passes before the fix is a wrong test).
3. **Implement third** — make the tests pass; zero reflection, AOT-compatible, 100% coverage on new code.
4. **Link everything** — add `/// <docs>path</docs>` XML tags to new public types, regenerate the code↔docs↔tests maps, and reference code + tests from the doc page's `codeReferences`/`testReferences` frontmatter.
5. **Release** — promote docs from `drafts/` to the released tree when the feature ships.

## Standards

- **Documentation authoring**: see `DOCUMENTATION-STANDARDS.md` in the repo root — page types (Diátaxis taxonomy), frontmatter schema, C# example style (K&R braces), code-block metadata.
- **Branch flow**: feature branch → PR → `develop`; `develop` promotes to `main` for deploy. Never push directly to either.
- **Validation gates**: `validate-frontmatter.mjs`, link validation, and the search/index generators run in CI — regenerate indexes in the same PR as any content move.

## Deep dives in this section

- **[Implementing a Data Engine](data-engines/overview)** — the full guide to adding a new database engine: `IWorkCoordinator`, SQL function contracts, capabilities, notifications, testing, and worked examples (SQLite, SQL Server).

## Tooling for contributors

- **MCP docs server** (`mcp-docs-server/`) — query docs, find code for a concept, find tests for a symbol, validate links — from Claude, Cursor, or any MCP client.
- **Audit tooling** (`src/scripts/audit-baseline.mjs`) — full content audit against the current library; see `audit-reports/` for the latest baseline.
