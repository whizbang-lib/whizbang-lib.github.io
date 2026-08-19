---
title: Perspective TTL Backfill
category: Architecture & Design
order: 32
tags: perspectives, retention, row-ttl, backfill, reconciler, startup, adoption, read-models, storage-economy
---

# Perspective TTL Backfill

[Perspective Row Retention](perspective-row-retention) lets a perspective declare that its rows age out after a period of inactivity. It works from the moment it ships — and it does **nothing at all** to the rows that were already there.

That is the gap this proposal closes: **adopting `[RowTtl]` on an existing deployment must be able to age out the history that motivated adopting it.**

:::planned
Proposed capability — not yet implemented. Extends the shipped `[RowTtl]` substrate with a one-time,
opt-in adoption path. No change to the steady-state stamp, the lens filter, or the row reaper.
:::

## The gap

`expires_at` is written in exactly one place: the perspective upsert, when a row is applied to. The row reaper deletes with `expires_at IS NOT NULL AND expires_at < NOW()`, and the lens expiry filter treats `NULL` as "never expires".

Compose those three facts and the adoption behavior falls out:

- Rows written **before** the declaration shipped carry `expires_at = NULL`.
- The reaper cannot see them. The lens keeps serving them. They live forever.
- A row is stamped only when its stream receives another event.

The last point is the sharp edge, because it inverts the intent. An **active** stream gets stamped on its next apply — and keeps sliding its window forward, so it never expires while it is in use, which is correct. A **dormant** stream — precisely the accumulated bloat that justified declaring a TTL — is never written again, so it is never stamped, and never reaped. Without a backfill, `[RowTtl]` only governs data created after adoption, and the existing table keeps its floor.

A rebuild does fix this, because the shipped stamp anchors to event time: re-applying old history reproduces the original window, so an idle-past-TTL stream comes back born-expired and reaps on the next maintenance cycle. But a rebuild re-applies **every event of every stream** to recover a single timestamp per row. That is an enormous amount of work — and against a shared database it is the kind of synchronized load that causes its own incident. Correct, and disproportionate.

## Design

A **startup reconciler** that stamps the rows the steady-state path will never reach.

For each perspective registered in `PerspectiveTtlRegistry`, resolve its table and issue:

```sql
UPDATE <perspective_table>
   SET expires_at = updated_at + <ttl>
 WHERE expires_at IS NULL
```

`updated_at` is a required column on every perspective row, so this is one indexed pass per table rather than a replay of history. The predicate makes it idempotent: once a row is stamped it is never matched again, so re-runs are no-ops and a partially-completed run simply resumes.

This mirrors [`TypeDefinitionReconciler`](type-definition-fingerprint), which solves the structurally identical problem for `[Ephemeral]` reclassification: a declaration changed, historical data predates it, and the framework offers a bounded, opt-in adoption pass.

### The anchor

**This proposal depends on Bitemporal Perspective Rows** (proposal on an unmerged branch; link resolves once it lands), which redefines `updated_at` as *business time* — the timestamp of the last qualifying event, invariant under replay — and moves the wall-clock write time to `sys_updated_at`.

That dependency is what makes the anchor exact rather than a proxy. `updated_at + ttl` is then the same quantity the steady-state upsert stamps into `expires_at`, so the backfill reproduces what a live apply would have written, and a rebuild cannot disturb it:

| Column | Anchor | Under rebuild |
| --- | --- | --- |
| `updated_at` (post-redefinition) | last qualifying event's timestamp | invariant |
| `sys_updated_at` | wall clock at write | changes |
| `expires_at` | `updated_at + ttl` | invariant |

Ordered the other way — backfilling first, against today's wall-clock `updated_at` — the anchor would only ever be a proxy, sound in the common case but wrong for any deployment rebuilt before adoption. Sequencing the redefinition first removes the compromise entirely rather than documenting it.

The blast radius is bounded on the other side too: for a Sourced perspective a wrongly-reaped row is **recoverable**. Resurrection-on-wake re-folds it from the log the next time its stream receives an event. The backfill can be wrong about *when* a row should go without being wrong about *what the data is*.

### Detect by default, act by opt-in

Stamping an expiry is scheduling a deletion. A deploy must not silently arm the reaping of historical data, so the reconciler splits:

- **Always**: count the rows missing `expires_at` per registered perspective, log and meter the total. This is free, safe, and tells an operator the size of the backlog before anything is written.
- **Only when explicitly enabled**: perform the `UPDATE`.

This is the same posture — and the same reasoning — as `EphemeralOptions.ReconcileHistoricalOnStartup`. The recommended sequence is deploy → read the reported count → enable in one environment → verify → promote.

### Running exactly once, not once per replica

Every replica starts at the same moment, so a naive startup hook fans the backfill out across the fleet simultaneously against one database. The reconciler takes a **single-winner guard** — an advisory lock, or the watermark compare-and-swap the deep-maintenance prune already uses — so exactly one instance performs the pass and the rest no-op immediately.

Writes are **chunked** (bounded row count per statement, committed per batch) so the pass never holds a long lock on a large table and can be interrupted without losing progress. Combined with the `expires_at IS NULL` predicate, an interrupted run resumes cleanly on the next start.

### Perspectives the backfill must skip

Ephemeral-tainted perspectives are excluded, for the same reason they cannot carry `[RowTtl]` at all: resurrection-on-wake is Sourced-only, so a reaped ephemeral row would recreate as a partial fold rather than recovering. The exclusion is inherited rather than re-derived — the backfill iterates the TTL registry, which those perspectives never enter.

## Observability (OTel)

On the existing `Whizbang.Maintenance` meter (already in the turnkey export list, tagged by `task`):

- `whizbang.maintenance.rows_affected` with `task=backfill_perspective_expiry` — rows stamped per run. A detect-only run reports zero here while still reporting the backlog below.
- `whizbang.maintenance.task_duration` with the same tag — pass wall time, so a large first run is visible rather than mysterious.

New, tagged by `perspective_name`:

- `whizbang.perspective.rows_missing_expiry` (gauge) — the detect-half signal, published on every startup whether or not writing is enabled. It is the number an operator reads before turning the switch on, and it should trend to zero after a successful pass.

The pass emits an `Information` log line per perspective with the count and the resolved TTL, and a single summary line for the run.

## Configuration

Extends the shipped options rather than introducing a parallel surface:

```csharp
services.Configure<PerspectiveRowRetentionOptions>(o => {
  o.BackfillExistingRowsOnStartup = true;   // default false — detect and report only
  o.BackfillBatchSize = 5_000;              // rows per chunked UPDATE
});
```

- **`BackfillExistingRowsOnStartup`** — default `false`. Detection always runs; this gates the write.
- **`BackfillBatchSize`** — bounds each statement so a large table is stamped incrementally.
- The existing **`Enabled`** kill switch dominates: with row retention off, the backfill does not run at all.
- Per-model **`Overrides`** apply to the backfill exactly as they do to the steady-state stamp, so a model whose override is `null` is skipped.

## AOT / zero-reflection statement

The reconciler reads the same source-generated `PerspectiveTtlRegistry` the steady-state stamp consults, resolves table names through the existing generated perspective metadata, and issues parameterized SQL. No runtime attribute inspection, no type scanning, nothing added to the reflection allowlist.

## Build increments (docs-first → TDD each)

1. **Detection** — count rows with `expires_at IS NULL` per registered perspective; the gauge, the log line, and a startup hook that writes nothing. RED via a seeded table whose backlog count is asserted.
2. **Chunked stamping** — the guarded `UPDATE` behind the opt-in flag, batched; integration tests on real Postgres proving idempotence (second run stamps zero), resumability (interrupt mid-pass), and that stamped rows subsequently reap.
3. **Single-winner guard** — concurrent-start test proving exactly one instance performs the pass and the others no-op.
4. **Exclusions and precedence** — ephemeral-tainted perspectives untouched; `Enabled=false` and `Overrides[...] = null` both skip; regression-locked.
5. **Docs to v1.0.0** on release, `<docs>`/`<tests>` tags, regenerated code↔docs↔tests maps.

## Relationship to neighboring proposals

- **Bitemporal Perspective Rows** (proposal on an unmerged branch; link resolves once it lands): **a prerequisite.** It redefines `updated_at` as replay-invariant business time, which is what turns this backfill's anchor from a defensible proxy into the exact value a live apply would have stamped. Build it first.
- [Perspective Row Retention](perspective-row-retention): supplies everything this reuses — the `expires_at` column, the registry, the lens filter, the reaper, and resurrection-on-wake as the recovery guarantee. This proposal is purely its adoption path.
- [Type Definition Fingerprint](type-definition-fingerprint): the precedent. Its startup reconciler answers the same question — "a declaration changed, what about the data that predates it?" — with the same detect-default / act-opt-in posture.
- [Ephemeral Events](ephemeral-events): defines the ephemeral taint that determines which perspectives the backfill must skip.
