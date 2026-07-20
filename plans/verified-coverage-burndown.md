# Verified-coverage burndown

Tracks the effort to link every documented C# example (and Mermaid diagram) to the test that
verifies it — turning the docs into a living, checked spec. See the authoring conventions in
`.claude/skills/whizbang-docs-authoring/SKILL.md` §3, and `fundamentals/dispatcher/dispatcher.md`
as the fully-annotated **reference model**.

## Why
Docs are Whizbang's living specification. A **green** "verified" badge tells a reader the documented
behavior is *proven to work* by a passing test; an **amber** "needs test" badge makes an unverified
spec visible instead of silent. This is the checks-and-balances between docs ↔ code ↔ tests.

## Measure it
```bash
node src/scripts/coverage-report.mjs            # per-page table (most gaps first)
node src/scripts/coverage-report.mjs --summary  # totals only
node src/scripts/coverage-report.mjs --gaps     # only pages with remaining gaps
```

## Baseline (2026-07-19)
- **243 pages** with C# examples and/or diagrams.
- **2,682 C# examples** — coverage (verified or excused) starts at **~1%**.
- **160 Mermaid diagrams** — 1 migrated to `{caption + tests}`.

The coverage *map* is already complete everywhere (every C# example now renders verified /
needs-test / not-verified). The burndown is the content work of converting amber → green with
**accurate** links. Precision matters: a green badge pointing at the wrong test is worse than an
honest amber. When you can't confidently map an example, leave it as a gap.

## How to burn down a page
1. Copy the patterns from `dispatcher.md` (the model).
2. For each C# fence: add `tests=["Class.MethodAsync", …]` when you can confidently identify the
   verifying test (candidate set = the page's `testReferences`; confirm the key in
   `src/assets/code-tests-map.json`; read the test to confirm it covers *that* example). Mark
   counter-examples / other-component APIs `unverified="reason"`. Leave true unknowns as gaps.
3. For each `mermaid` diagram: `{caption="…" tests=[…]}`.
4. Add `{verified: …}` markers to the Quick-Reference table and key section headings.
5. `node src/scripts/validate-frontmatter.mjs --report` — no code-block/mermaid violations for the page.
6. (Local preview only) add any new keys to the git-excluded dev fixture
   `src/assets/data/test-status/Whizbang.Core.Tests.json` so badges render green in dev.

## Section priority (by remaining C# gap)
Work section-by-section; each section shares test classes so mapping is coherent.

| Section | pages | C# | gap | mermaid | status |
|---|--:|--:|--:|--:|---|
| fundamentals/dispatcher | 7 | 162 | — | 6 | **in progress** (model page done; section pages being annotated) |
| fundamentals/perspectives | 22 | 256 | 256 | 11 | todo |
| fundamentals/security | 9 | 165 | 165 | 9 | todo |
| data | 13 | 147 | 147 | 3 | todo |
| fundamentals/identity | 8 | 143 | 143 | 1 | todo |
| extending/source-generators | 10 | 140 | 140 | 9 | todo |
| fundamentals/messages | 9 | 117 | 117 | 10 | todo |
| extending/extensibility | 13 | 111 | 111 | 3 | todo |
| fundamentals/events | 8 | 109 | 109 | 4 | todo |
| fundamentals/lenses | 8 | 106 | 106 | 1 | todo |
| migration-guide | 9 | 99 | 99 | 0 | todo |
| messaging/transports | 6 | 94 | 94 | 8 | todo |
| operations/deployment | 7 | 90 | 90 | 3 | todo |
| messaging | 11 | 82 | 82 | 29 | todo |
| learn/tutorial | 10 | 78 | 78 | 18 | todo |
| operations/infrastructure | 7 | 78 | 78 | 7 | todo |
| fundamentals/receptors | 3 | 71 | 71 | 0 | todo |
| operations/diagnostics | 17 | 71 | 71 | 0 | todo |
| operations/observability | 7 | 51 | 51 | 0 | todo |
| operations/workers | 4 | 49 | 49 | 5 | todo |
| _(remaining sections)_ | … | … | … | … | todo — see `coverage-report.mjs` |

## Rollout of enforcement
`validate-frontmatter.mjs` already hard-fails on Mermaid diagrams missing `caption`/`tests`
(163 at baseline) — currently run it with `--report` until diagrams are migrated. A follow-up can
extend it to require `tests=`/`unverified=` on every C# block (report-only first, then a CI gate once
a section is backfilled).
