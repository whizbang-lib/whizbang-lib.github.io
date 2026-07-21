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

## Progress (updated 2026-07-20 — effective floor reached)
- **C# coverage: 2,607 / 2,682 = 97%** (verified + excused). **75 bare gaps remain** — this is the
  intended honest floor, not unfinished work (see below).
- **Mermaid: 63 / 160** carry `caption + tests` (the rest are caption-only conceptual/overview
  diagrams no single in-map test verifies — report-only).
- **Every section has been swept.** All four previously-unstarted sections
  (`fundamentals/sagas`, `operations/dead-letter-queue`, `fundamentals/offloads`,
  `fundamentals/workers`) are done; all partial `fundamentals/*` / `messaging*` / `data`
  sections were gap-filled to their floor. The full arc this program: ~1% → 90% (prior sessions)
  → **97%** (reconciliation + gap-fill cycle). See the git log (`docs(coverage): …`).
- **The remaining 75 gaps are deliberate, split two ways:**
  1. **Genuine "needs test" amber** — a documented behavior with no verifying test anywhere
     (e.g. `InProcessTransport.InitializeAsync`/`IsInitialized`, the unwired WHIZ802 descriptor,
     assorted disabled-by-default diagnostic patterns). This is the *"callout what is missing"*
     signal working as designed — do NOT convert these to `unverified=`.
  2. **Map-absent residue** — a real, passing verifier exists but is outside
     `code-tests-map.json`, so it cannot render green. These are the true target of the
     map-regeneration follow-up below, not more excuse-labeling.
- Residual gaps by section (2026-07-20): operations/diagnostics 16, operations/configuration 8,
  learn/tutorial 8, operations/workers 7, migration-guide 7, extending/source-generators 6,
  fundamentals/perspectives 5, apis/rest 4, apis/graphql 4, operations/infrastructure 3,
  operations/observability 2, fundamentals/persistence 2, operations/deployment 1,
  messaging/transports 1, extending/extensibility 1.

## Tooling note (2026-07-20)
Fixed a real fence-metadata parsing bug found during this work: a naive `{[^}]*}` capture in
both the runtime parser (`code-block-parser.service.ts`) and `coverage-report.mjs` truncated a
fence's metadata at the first `}` inside a *quoted value* (e.g. `description="Using {PropertyName}
…"`), dropping trailing `tests=`/`unverified=` keys and spilling metadata text into the rendered
code. Both are now quote-aware. Commit `fix(docs): quote-aware code-fence metadata parsing`.

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

## Status: all sections swept (2026-07-20)
Every section has been annotated to its floor — there is no "next section to start". Regenerate the
live residual-gap table any time with `node src/scripts/coverage-report.mjs` (aggregate `gap` by
section). The 75 remaining bare gaps are the deliberate honest floor described under **Progress**
above (genuine "needs test" amber + map-absent residue); they are listed per-section there.

**Before touching a residual gap, decide which kind it is** (read the fence + its `testReferences`):
convert only *map-absent* gaps to `unverified="verified by <Class>, which is outside the current
coverage map"`; leave *genuine needs-test* gaps bare so the amber "needs test" badge keeps surfacing
what the library doesn't yet cover. Never convert a genuine gap to an excuse just to zero the count.

### #1 follow-up — regenerate `code-tests-map.json` (unblocks the map-absent residue)
See the ceiling section above. Regenerating the map to include the integration/sample/SQL/EFCore
suites would flip a large fraction of the *excused* blocks (not just the residual gaps) to genuine
green — do this before any CI enforcement gate.

## Rollout of enforcement
`validate-frontmatter.mjs` already hard-fails on Mermaid diagrams missing `caption`/`tests`
(163 at baseline) — currently run it with `--report` until diagrams are migrated. A follow-up can
extend it to require `tests=`/`unverified=` on every C# block (report-only first, then a CI gate once
the map is regenerated). Note: it must use the **quote-aware** fence regex (see Tooling note) or it
will false-flag annotated blocks whose metadata values contain braces.
