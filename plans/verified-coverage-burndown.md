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

## Progress (updated 2026-07-20)
- **C# coverage: 1,954 / 2,682 = 73%** (1,042 verified · 912 excused · 728 gap).
- **Mermaid: 60 / 160** carry `caption + tests`.
- Sections fully swept this cycle (verified + excused, honest gaps recorded): `operations/*`
  (infrastructure, diagnostics, observability, workers, configuration, deployment, dead-letter-queue*),
  `apis/graphql`, `extending/attributes`, `fundamentals/lifecycle`, `learn/tutorial`. See the git log
  (`docs(coverage): annotate …`) for per-section commits.

### Recurring ceiling — regenerate `code-tests-map.json`
The dominant blocker on green ratio is the **staleness of `src/assets/code-tests-map.json`**. Many real,
passing test classes are simply absent from it and therefore cannot render green, forcing honest
`unverified="verified by <Class>, which is outside the current coverage map"` excuses. Confirmed absent
so far: the ECommerce **sample suite** (the entire `learn/tutorial` behavioral coverage),
`StuckRowSentinel*`, `PerspectiveWorker{ChannelMode,Dedup,DrainMode,SecurityContext}`,
`QueryExecutionTests`, `ScopedQueryTests`, `DeadLetterRecoverySqlTests`, `GenerateStreamIdGeneratorTests`,
`StreamIdGeneratorCoverageTests`, `PhysicalFieldDiscoveryTests`, the `*PostLifecycle*`/`*Situation*`/
`PostLifecyclePipeline*` lifecycle classes, and `LocalImmediateLifecycleStageTests`. Regenerating the map
(`generate-code-tests-map.mjs`, including integration/sample suites) would flip a large fraction of the
current excused blocks to genuine green — do this before a final enforcement gate.

The coverage *map* (the UI) is already complete everywhere (every C# example now renders verified /
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

## Section priority (remaining C# gap, updated 2026-07-20)
Work section-by-section; each section shares test classes so mapping is coherent. Regenerate this
table any time with `node src/scripts/coverage-report.mjs` (aggregate the `gap` column by section).
Fully-swept sections (gap is only honest/map-ceiling residue) are omitted; the biggest remaining work
is the partially-done `fundamentals/*` sections started by earlier sessions.

| Section | pages | C# | remaining gap | note |
|---|--:|--:|--:|---|
| fundamentals/perspectives | 22 | 256 | 71 | partial |
| fundamentals/lenses | 8 | 106 | 44 | partial |
| learn/examples | 4 | 38 | 38 | **todo — unstarted** |
| extending/source-generators | 10 | 140 | 38 | partial |
| getting-started | 4 | 35 | 35 | **todo — unstarted** |
| fundamentals/events | 8 | 109 | 35 | partial |
| operations/testing | 2 | 34 | 34 | **todo — unstarted** |
| fundamentals/receptors | 3 | 71 | 34 | partial |
| apis/rest | 3 | 33 | 33 | **todo — unstarted** |
| fundamentals/security | 9 | 165 | 31 | partial |
| fundamentals/persistence | 3 | 30 | 30 | **todo — unstarted** |
| fundamentals/messages | 9 | 117 | 30 | partial |
| apis/mutations | 2 | 28 | 28 | **todo — unstarted** |
| fundamentals/identity | 7 | 143 | 22 | partial |
| fundamentals/dispatcher | 7 | 162 | 22 | partial (model page done) |
| messaging | 11 | 82 | 19 | partial |
| extending/features | 2 | 18 | 18 | **todo — unstarted** |
| messaging/transports | 6 | 94 | 17 | partial |
| apis/signalr | 2 | 17 | 17 | **todo — unstarted** |
| data | 13 | 147 | 14 | partial |
| fundamentals/messaging | 3 | 13 | 13 | **todo — unstarted** |
| extending/internals | 2 | 13 | 13 | **todo — unstarted** |
| fundamentals/sagas | 2 | 12 | 12 | partial |
| _(swept sections, small residue)_ | … | … | ≤11 | operations/*, apis/graphql, extending/attributes, fundamentals/lifecycle, learn/tutorial, migration-guide, extending/extensibility |

## Rollout of enforcement
`validate-frontmatter.mjs` already hard-fails on Mermaid diagrams missing `caption`/`tests`
(163 at baseline) — currently run it with `--report` until diagrams are migrated. A follow-up can
extend it to require `tests=`/`unverified=` on every C# block (report-only first, then a CI gate once
a section is backfilled).
