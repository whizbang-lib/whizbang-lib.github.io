---
title: Bitemporal Perspective Rows
category: Architecture & Design
order: 33
tags: perspectives, read-models, timestamps, bitemporal, event-time, rebuild, replay, retention, schema
---

# Bitemporal Perspective Rows

Every perspective row carries `created_at` and `updated_at`. Both are **wall-clock write times** — `created_at` is "the real now on insert" and `updated_at` comes from the timestamps apply-hook as "now". Neither describes when anything actually *happened*.

That is fine until a rebuild, at which point it is actively wrong: replaying history rewrites every row, so **every entity's "created" date becomes today** and every "last updated" collapses to the rebuild window in whatever order the rows were written.

This proposal splits the single conflated axis into the two the domain actually needs, while we are still pre-1.0 and can redefine rather than accumulate.

:::planned
Proposed capability — not yet implemented. A pre-1.0 **semantic redefinition** of two shipped
columns plus two new ones. Includes a migration and a terminology sweep across docs and tests.
:::

## The defect

A rebuild is a routine, supported operation — it is how a projection recovers from corruption, adopts a schema change, or backfills a new field. It re-applies the log through the same upsert path as live traffic, which means it takes the same wall-clock stamps.

The consequences are not subtle:

- **"Created" dates are destroyed.** A record created three years ago reports today. This value is routinely displayed to users and used in business rules.
- **Recency ordering scrambles.** `ORDER BY updated_at DESC` — the natural "most recent activity" query — returns rebuild ordering, not activity ordering.
- **"What changed since X" breaks.** Every row appears to have changed at once.
- **Retention has no correct anchor.** Row TTL cannot key off a timestamp a rebuild resets, which is precisely why [Perspective Row Retention](perspective-row-retention) had to introduce a *separate* event-time-anchored `expires_at` rather than deriving expiry from `updated_at`.

That last point is the tell. The framework already needed a replay-invariant timestamp and, lacking one on the row, materialized a single-purpose column for it. The general fix is to name the axis properly and let everything share it.

## The test that separates the two axes

**Replay-invariance.** Re-apply the same events and ask whether the value changes.

- A timestamp derived from the *event* is a pure function of the log. A rebuild reproduces it exactly. It is **business time**.
- A timestamp taken from the clock at write is not. A rebuild legitimately changes it, because the row genuinely was written again. It is **system time**.

Any column that changes under rebuild is operational and must not carry business meaning. This test decides the question for every future column, not just these.

## Industry precedent

This is **bitemporal modeling**, and the answer has been stable for decades: two independent axes, never conflated.

- **SQL:2011** standardized both — system-versioned tables (`PERIOD FOR SYSTEM_TIME`, `GENERATED ALWAYS AS ROW START/END`) and application-time period tables. Implemented by SQL Server temporal tables (`SysStartTime`/`SysEndTime`), MariaDB, and DB2. Snodgrass's *Developing Time-Oriented Database Applications* is the canonical treatment.
- **Stream processing** rediscovered the same split as **event time vs processing time** (plus ingestion time). Watermarks in the Dataflow model exist precisely because those diverge under late and out-of-order arrival; Flink exposes all three as first-class; Kafka makes it a per-topic setting (`message.timestamp.type = CreateTime | LogAppendTime`). This is the framing nearest to ours, since out-of-order arrival is already a designed-for condition.
- **Dimensional modeling** keeps Type-2 SCD `effective_from`/`effective_to` (valid time) strictly separate from ETL audit columns like `load_date`.
- **Datomic** makes transaction time inherent and immutable, and declares valid time to be the domain's own attribute — an explicit refusal to conflate.

The invariant all of them land on: **business logic keys off business/valid time; audit, replication, cache invalidation, and debugging key off system/transaction time.**

## Design

| Column | Meaning | Under rebuild |
| --- | --- | --- |
| `created_at` | when the entity came into being (first qualifying event) | invariant |
| `updated_at` | last business activity (most recent qualifying event) | invariant |
| `sys_created_at` | when the row was first written | changes |
| `sys_updated_at` | when the row was last written | changes |

**The unprefixed names carry business meaning deliberately.** A developer writing `ORDER BY updated_at` or rendering `CreatedAt` should get replay-stable truth by default; reaching for the operational value should require asking for it by name. The `sys_` prefix marks plumbing, following SQL:2011 and SQL Server temporal tables where system-time columns are explicitly named as system columns.

Business time is sourced from the applied event's timestamp — the same value the row's `metadata.Timestamp` already records and that `expires_at` already anchors on. Nothing new has to be computed or carried.

### Not every event is "activity"

"When a user or business process acted on this record" is narrower than "when any event touched this row." Integrity repairs, system backfills, reclassification passes, and maintenance-generated events all write rows without representing domain activity. If they bumped business time they would extend retention windows and jump records to the top of recency sorts — the same conflation one level down.

So business-time stamping is **suppressible per event type**, through the existing `PerEventApplyHooks` seam that already resolves the `updated_at` decision today. The default is **opt-out**: every event counts as activity unless a hook declares otherwise. Forgetting to declare keeps a record alive and visible, which fails safe; an opt-in default would silently expire records nobody remembered to annotate.

## Migration

Pre-1.0, so the columns are redefined in place rather than deprecated alongside replacements.

1. Add `sys_created_at` and `sys_updated_at`.
2. **Backfill by copying the sibling values** — `sys_created_at ← created_at`, `sys_updated_at ← updated_at`. Historical rows therefore carry the old wall-clock values on the operational axis, which is exactly what those values always were.
3. Going forward, the upsert writes each axis from its proper source.

Historical *business* time is approximate for existing rows, and that is accepted: the pre-migration values are wall-clock, so there is nothing exact to recover for `created_at` from the row alone. One refinement is available and worth taking where it is free — `updated_at` can be backfilled **exactly** from `metadata->>'Timestamp'`, since the last applied event's timestamp is already stored on every existing row. `created_at` has no such source (only the most recent event's metadata is retained) and keeps the copied value.

Perspective tables are generated per application, so the migration is applied through the same schema-init path that creates them, and the schema hash changes accordingly.

## What this unlocks

- **Retention gets an honest anchor.** `expires_at` becomes a derived, indexable cache of `updated_at + ttl` rather than the only replay-invariant timestamp on the row. The Perspective TTL Backfill proposal then reduces to a single exact statement with no wall-clock proxy.
- **Recency and "what changed" queries work across rebuilds**, which they do not today.
- **Displayed dates stop lying.** Created dates survive projection maintenance.
- **The rule generalizes.** Replay-invariance decides where any future timestamp belongs.

## AOT / zero-reflection statement

Additive columns on the generated perspective schema, values threaded from the existing apply arguments, suppression resolved through the existing hook registry. No runtime attribute inspection, no type scanning, nothing added to the reflection allowlist.

## Build increments (docs-first → TDD each)

1. **Schema** — add `sys_created_at` / `sys_updated_at` across the in-sync schema-definition sites plus the schema hash; migration adds and copy-backfills them. Inert: nothing reads them yet.
2. **Write paths** — both upsert paths stamp system time from the clock and business time from the applied event's timestamp. RED first with a test asserting today's conflated behavior fails under replay.
3. **Replay-invariance lock** — the load-bearing regression: apply a stream, capture both axes, rebuild, assert business time is byte-identical and system time advanced.
4. **Activity suppression** — hook-declared non-activity event types leave business time untouched while still writing the row; precedence tests.
5. **Terminology sweep** — update every doc and test to the new meanings, including the ones that currently assert wall-clock semantics on `UpdatedAt`.
6. **Retention rebase** — `expires_at` derives from `updated_at + ttl`; the TTL backfill proposal is revised onto it.

## Relationship to neighboring proposals

- [Perspective Row Retention](perspective-row-retention): introduced the event-time-anchored `expires_at` because no replay-invariant timestamp existed on the row. This proposal supplies the general one; retention becomes a consumer rather than a special case.
- **Perspective TTL Backfill** (proposal on an unmerged branch; link resolves once it lands): **depends on this.** Its anchor question ("wall-clock `updated_at` or exact event time?") dissolves once `updated_at` *is* business time.
- [Ephemeral Events](ephemeral-events): rebuild-from-zero is refused for ephemeral streams, so the divergence this fixes is a Sourced-perspective concern — but the columns are uniform across both.
