# Audit Re-Baseline — 2026-07-16

Fresh run of `audit-baseline.mjs` + map generators against library `origin/develop` (f2657adc). Previous baseline (2026-03-25) archived in `archive-2026-03-25/`. Library moved v0.6xx → v0.8xx in between.

## Delta summary

| Metric | 2026-03-25 | 2026-07-16 | Trend |
|---|---|---|---|
| Total v1.0.0 pages | 243 | 297 | +54 pages written |
| Code samples | 3,118 | 3,412 | +294 |
| Samples without metadata | 139 | 121 | improved |
| Undocumented public types | 514 (52% cov) | 666 | **worse — library outpacing docs** |
| Broken `<docs>`-tag links (code → missing page) | 49 | 203 | **worse — 63 distinct missing pages** |
| Search chunks with markdown leaks | 523 | 9 | fixed (March B-batch landed) |
| Potentially stale pages | 288 | 412 | worse (1,266 lib files changed in 6mo) |
| Broken internal links | 4 | 19 | worse |
| Mermaid diagrams | 39 | 43 | +4 |
| `<docs>` XML tag links in lib | ~858 | 1,724 | tagging discipline held |

## Top missing pages demanded by code (by tag count)

Concentrated in the recent library workstreams:

1. **fundamentals/work-coordinator/** — 12+ pages, ~75 tags (notifications-and-pgbouncer, configuration-reference, per-stream-drain, batched-flushers, commit-sequence, backup-tick-coordinator, claim-loop, handler-commit, lease-cancellation, idle-activity-tracking, app-signals, inbox-dispatch, startup-ordering)
2. **offloads** — 19 tags (top-level page/folder absent)
3. **event-upcasting** — 10 tags
4. **core-concepts/pinned-identity** — 9 tags
5. **internals/** — outbox/inbox/apply batch strategies, receptor-registry-query, stream-affinity (~16 tags; note: `internals/` section doesn't exist yet — candidate for the `spec/` porter tree or an internals section)
6. Misc: lifecycle-reconciliation, perspectives/drain-mode, cursor-inversion, receptors/raw-receptors, resilience/database-availability-middleware, workers processing-hooks/publisher-worker, graphql authorization anchor

Full lists: `broken-code-docs-links.json`, `undocumented-public-types.json`, `stale-docs-candidates.json`.

## Reading the March task list against this

- March batches B03 (missing frontmatter), search-leak fixes, and much of B01/B02 landed (PRs #83–#121).
- March per-section session findings (sessions/) are 4 months stale — spot-verify before executing any remaining task from `archive-2026-03-25/master-task-list.json`.
- The new content debt is dominated by *net-new library subsystems*, not drift in existing pages. Page-creation work should follow the missing-pages list above, section by section, with the new pageType taxonomy applied on creation.

## How to re-run

```bash
WHIZBANG_LIB_PATH=/path/to/whizbang-at-develop \
  node src/scripts/generate-code-docs-map.mjs && \
  node src/scripts/generate-code-tests-map.mjs && \
  node src/scripts/audit-baseline.mjs
```

(`WHIZBANG_LIB_PATH` override added 2026-07-16 so audits can run against a clean worktree instead of the sibling checkout.)
