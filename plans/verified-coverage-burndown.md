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
- **C# coverage: 2,418 / 2,682 = 90%** (1,162 verified · 1,256 excused · 264 gap).
- **Mermaid: 62 / 160** carry `caption + tests`.
- Sections fully swept (verified + excused, honest gaps recorded): all of `operations/*`,
  `apis/*`, `extending/*`, `learn/*`, `getting-started`, and `fundamentals/*` EXCEPT the
  still-partial sections in the table below. The perspectives, lenses, events, receptors,
  and source-generators sweeps this cycle drove **78% -> 90%**.
- Remaining gap (264) concentrates in the partial `fundamentals/*` (security 31, messages 30,
  identity 22, dispatcher 22), `messaging` (19), `messaging/transports` (17),
  `operations/diagnostics` (16), `data` (14), and the small unstarted
  `fundamentals/{sagas 12, offloads 7, workers 5}` + `operations/dead-letter-queue` (11).
  See the git log (`docs(coverage): annotate …` / `fill … gaps`) for per-section commits.
- Note on the partial-fill pattern: the remaining sections are heavily *already-green* from
  prior sessions; the bare fences left over are predominantly consumer/domain illustration,
  value-object construction covered only by map-absent classes, or genuinely-untested
  helpers — so expect high excused ratios and a handful of honest "needs test" bare gaps.

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
| fundamentals/security | 9 | 165 | 31 | partial |
| fundamentals/messages | 9 | 117 | 30 | partial |
| fundamentals/identity | 7 | 143 | 22 | partial |
| fundamentals/dispatcher | 7 | 162 | 22 | partial (model page done) |
| messaging | 11 | 82 | 19 | partial |
| messaging/transports | 6 | 94 | 17 | partial |
| operations/diagnostics | 15 | 71 | 16 | swept — honest residue |
| data | 13 | 147 | 14 | partial |
| fundamentals/sagas | 2 | 12 | 12 | **todo — unstarted** |
| operations/dead-letter-queue | 5 | 11 | 11 | **todo — unstarted** |
| learn/tutorial | 10 | 78 | 8 | swept — honest residue |
| operations/configuration | 7 | 47 | 8 | swept — honest residue |
| operations/workers | 3 | 49 | 7 | swept — honest residue |
| migration-guide | 9 | 99 | 7 | partial |
| fundamentals/offloads | 3 | 7 | 7 | **todo — unstarted** |
| fundamentals/workers | 2 | 5 | 5 | **todo — unstarted** |
| _(swept, small honest residue ≤6)_ | … | … | ≤6 | extending/* (source-generators, attributes, features, internals, extensibility), fundamentals/* (perspectives, lenses, events, receptors, persistence, messaging, lifecycle), apis/* (rest, graphql, mutations, signalr), operations/* (infrastructure, observability, deployment, testing), learn/examples, getting-started |

## Rollout of enforcement
`validate-frontmatter.mjs` already hard-fails on Mermaid diagrams missing `caption`/`tests`
(163 at baseline) — currently run it with `--report` until diagrams are migrated. A follow-up can
extend it to require `tests=`/`unverified=` on every C# block (report-only first, then a CI gate once
a section is backfilled).
