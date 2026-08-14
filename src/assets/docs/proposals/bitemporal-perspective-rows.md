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

## Prerequisite: the Dapper store must stop discarding metadata

Business time is sourced from the applied event's timestamp, which arrives on `PerspectiveMetadata`. The EF Core store already threads it. The Dapper store does not — it writes `metadata = '{}'` for every row.

The cause is not a missing contract. `IPerspectiveStore.UpsertAsync` **already has** a metadata-bearing overload; it is a *default interface method whose body drops the argument*:

```csharp
Task UpsertAsync(…, PerspectiveMetadata metadata, CancellationToken ct = default)
  => UpsertAsync(streamId, model, scope, forceUpdateScope, cancellationToken);   // metadata discarded
```

`DapperPostgresPerspectiveStore` implements only the three non-metadata overloads, so it inherits that default and hardcodes an empty metadata object.

This is the **same defect class** as the event-store decorators that silently served interface defaults for `GetCommitSequenceAsync` and `HasStreamEventsBeforeAsync`: a default interface method is not virtual dispatch, so an implementor that does not override it gets the lossy fallback with no compiler complaint and no runtime error. It is the third instance found in this codebase.

The consequence is wider than timestamps — the Dapper path currently discards **all** perspective metadata: `EventType`, `EventId`, `CorrelationId`, `CausationId`, and `CommitSequence`. Any consumer reading those from a Dapper-backed perspective receives an empty object today.

**Resolution:** implement the metadata overload in the Dapper store and persist the metadata, matching the EF Core path. No contract change is required. Because this is a recurring pattern rather than an isolated slip, the fix ships with a reflection drift-lock — the same guard added for the event-store decorators — asserting that every `IPerspectiveStore` implementation overrides the metadata-bearing overload rather than inheriting a lossy default.

## Migration

Pre-1.0, so the columns are redefined in place rather than deprecated alongside replacements.

1. Add `sys_created_at` and `sys_updated_at`.
2. **Backfill by copying the sibling values** — `sys_created_at ← created_at`, `sys_updated_at ← updated_at`. Historical rows therefore carry the old wall-clock values on the operational axis, which is exactly what those values always were.
3. Going forward, the upsert writes each axis from its proper source.

Historical *business* time is approximate for existing rows, and that is accepted: the pre-migration values are wall-clock, so there is nothing exact to recover for `created_at` from the row alone. One refinement is available and worth taking where it is free — `updated_at` can be backfilled **exactly** from `metadata->>'Timestamp'`, since the last applied event's timestamp is already stored on every existing row. `created_at` has no such source (only the most recent event's metadata is retained) and keeps the copied value.

Perspective tables are generated per application, so the migration is applied through the same schema-init path that creates them, and the schema hash changes accordingly.

## Consequence: `expires_at` becomes an override, not the anchor

Once `updated_at` is replay-invariant, the stored `expires_at` is doing two unrelated jobs. Job one — carrying `updated_at + ttl` into the database — exists only because the reaper is dynamic SQL with no knowledge of any model's TTL. Job two — letting a *specific row* expire at a time the rule would not have chosen — is a genuine capability. Splitting them:

**Enrollment and duration become separate concerns.** The `[RowTtl]` attribute's job is to tell the reaper **where to look**; a duration is optional.

| Declaration | Reaper scans the table | Default rule | Explicit `expires_at` honored |
| --- | --- | --- | --- |
| *(no attribute)* | no | — | no |
| `[RowTtl]` | yes | none | yes |
| `[RowTtl(Days = 60)]` | yes | sliding: `updated_at + 60d` | yes — replaces the sliding term |
| `[RowTtl(MaxAgeDays = 365)]` | yes | absolute: `created_at + 365d` | yes — but the cap still binds |
| `[RowTtl(Days = 60, MaxAgeDays = 365)]` | yes | earliest of the two | replaces sliding; cap still binds |

So a perspective can enroll for expiry **without** declaring a blanket lifetime, and have individual rows reaped purely by a domain-assigned date — a temporary record inside an otherwise permanent model. That is not expressible today.

**Invariant: a declared TTL is always live.** Enrollment and duration are not independently configurable, so there is no combination that yields a declared-but-inert TTL — `[RowTtl(Days = 60)]` enrolls by construction. The only two things that may suppress a declared TTL are deliberate and operator-visible: the global `Enabled` kill switch, and a per-model override set explicitly to null. Anything else silently ignoring a declared lifetime is a bug, and is regression-locked as one.

### Two anchors: sliding and absolute

Because `updated_at` is *last business activity*, the rule `updated_at + ttl` **slides** — every qualifying event pushes expiry forward, so a record stays alive exactly as long as it stays in use. That is the right default for the motivating cases (conversations, sessions, activity feeds) and matches the behavior shipped today.

Sliding alone cannot express the other half of the problem, though. "Delete 60 days after the last message" and "delete 60 days after creation, regardless of activity" are different policies, and the second is what regulatory retention, trial data, and time-boxed records require: an *active* record must still age out.

Both are offered, following the shape .NET developers already know from `MemoryCacheEntryOptions` (`SlidingExpiration` alongside `AbsoluteExpiration`, where sliding renews but never past the absolute cap) and from cookies (`Max-Age` vs `Expires`):

```csharp
[RowTtl(Days = 60)]                      // sliding — 60 days after last activity
[RowTtl(MaxAgeDays = 365)]               // absolute — 365 days after creation
[RowTtl(Days = 60, MaxAgeDays = 365)]    // slides while used, hard-capped at a year
```

### Units

The shipped attribute exposes only `Days` and `Seconds`, which is too coarse at one end and too fine at the other — a presence or draft-autosave row wants minutes, a export-job result wants hours. Each anchor takes the full set, and **components sum**:

```csharp
[RowTtl(Minutes = 30)]                   // sliding — half an hour of inactivity
[RowTtl(Hours = 1, Minutes = 30)]        // sliding — ninety minutes
[RowTtl(Days = 60, MaxAgeHours = 8_760)] // sliding 60d, capped at a year
```

| Anchor | Components |
| --- | --- |
| sliding (from `updated_at`) | `Seconds`, `Minutes`, `Hours`, `Days` |
| absolute (from `created_at`) | `MaxAgeSeconds`, `MaxAgeMinutes`, `MaxAgeHours`, `MaxAgeDays` |

Summing also **resolves an existing ambiguity**: today `[RowTtl(Days = 1, Seconds = 30)]` has no defined meaning, because the resolver reads one property and silently ignores the other. Under summation it means what it reads like.

Two rules the implementation must hold, both of them the `-1` sentinel hazard again in a new place:

- Unset components are `-1` and **must be skipped, not added**. Summing the sentinel would silently shorten every window by a second per unset unit.
- A group with no component set has **no anchor**, which is distinct from an anchor of zero. `[RowTtl(Seconds = 0)]` — expire instantly — is almost certainly a mistake and is an analyzer diagnostic rather than an accepted value.

Units are a declaration-surface concern only: the generator normalizes each anchor to whole seconds at compile time, so the registry, the schema, and the reaper continue to deal in seconds and nothing downstream learns about units. A string form (`[RowTtl("90m")]`) was considered and rejected — it trades compile-time checking and IntelliSense for brevity, against the grain of a codebase that resolves everything statically.

**Absolute expiry is only sound because of this proposal.** Anchoring on `created_at` today would be silently broken — a rebuild resets it, so every record's age would restart and nothing would ever reach its cap. It becomes trustworthy only once `created_at` is replay-invariant business time, which is why the two anchors arrive together rather than separately.

### The effective-expiry ladder

Stated as an ordered ladder rather than a `COALESCE`, because the guard is load-bearing:

The override and the cap are **not peers**. `expires_at` replaces the *sliding* term — its job is "don't let this row idle out, it dies when I say" — while `MaxAge` is a ceiling that always binds:

```
effective_expiry = EARLIEST(                          -- skipping absent terms
    COALESCE(expires_at, updated_at + slidingTtl),      -- override replaces the idle rule
    created_at + maxAge)                                -- the cap always binds

                 = NULL when no term applies            -- never expires
```

**A per-row write must not breach a policy declared in code.** If the override outranked the cap, setting `expires_at` two years out on a perspective declaring `MaxAgeDays = 365` would silently defeat the retention ceiling — the exact guarantee an absolute anchor exists to provide. Raising a ceiling should require editing the attribute, where it is visible in review, not writing a date into a row.

This is again the `MemoryCacheEntryOptions` shape: `SlidingExpiration` renews but never past `AbsoluteExpiration`. Absolute is a hard bound, not a competing term.

The genuine "retain beyond the ceiling" case — litigation hold — is deliberately *not* served by a far-future `expires_at`. That is a **hold**, a distinct concept, and one this codebase already models on the event side (`wh_event_destruction_hold` with `hold_until`, from the destruction-hook work). If perspective rows need it, they should reuse that shape rather than overload expiry with a second meaning.

A row is reapable when `effective_expiry IS NOT NULL AND effective_expiry < NOW()`. With both terms declared the earliest wins, so the cap bounds total lifetime while the sliding term governs idle-out — the same composition the cache APIs use.

### Still one stored column, not two

Two rules do not imply two expiry columns. Both rules are **derived** from columns that already exist — sliding from `updated_at`, absolute from `created_at` — with the durations coming from the registry. Neither needs storage.

Only the override is stored. It replaces the *sliding* term rather than the whole calculation, so it does not need a companion — the cap is still evaluated from `created_at` and the registry. `expires_at` therefore stays a single nullable column, and no `max_expires_at` is introduced.

The ladder evaluates in SQL as a disjunction: the override *or* the sliding rule (whichever applies), or the cap independently.

```sql
WHERE (expires_at IS NOT NULL AND expires_at < NOW())
   OR (expires_at IS NULL AND r.sliding_seconds IS NOT NULL
       AND updated_at < NOW() - make_interval(secs => r.sliding_seconds))
   OR (r.max_age_seconds IS NOT NULL                     -- cap binds regardless of the override
       AND created_at < NOW() - make_interval(secs => r.max_age_seconds))
```

Note the third disjunct carries **no** `expires_at IS NULL` guard — that omission is what makes the ceiling unbreachable, and is worth a regression test naming it, since it reads like an oversight next to the other two.

**Write the arithmetic on the `NOW()` side.** `updated_at < NOW() - interval` is sargable and uses an index on `updated_at`; the algebraically identical `updated_at + interval < NOW()` is not, and degrades the reaper to a sequential scan of every enrolled table on every maintenance cycle.

That makes an index on `updated_at` a requirement of this design. Perspective tables index `created_at` today but **not** `updated_at`, so the schema work adds it — one more reason the column set and the reaper predicate land in the same increment rather than separately.

:::new{type="breaking"}
**The TTL-presence check is a safety guard, not style.** `PerspectiveTtlRegistry.ResolveSeconds` returns **`-1`**, not null, for four distinct cases: an unregistered model, a per-model override set to null, a null type, and **the global `Enabled` kill switch being off**. A naive `updated_at + ttl` would therefore compute *one second before* `updated_at` — already expired — and reap every row of every non-TTL perspective, including the entire fleet the moment an operator flips the kill switch whose purpose is to *stop* expiry. SQL would mask this through NULL propagation; C# arithmetic would not. The check must be explicit on both sides.
:::

### Disabled means disabled

With retention disabled, **nothing expires** — neither the rule nor explicit per-row overrides, and the lens filter stands down so hidden rows become visible again. A kill switch that suppressed the rule but honored overrides would be a partial guarantee nobody can reason about mid-incident.

### Where the reaper looks

Today's reaper enumerates every table carrying an `expires_at` column — which, since the column is part of the standard perspective DDL, means every perspective table in the database. Under enrollment it consults `wh_perspective_registry` instead and scans only enrolled perspectives. That table already exists, already carries the schema hash, and is already reconciled at startup, so it gains `row_ttl_seconds` (nullable — enrolled with no default rule) and the sync comes free.

### The retroactive-TTL caveat

Deriving rather than stamping means **editing a TTL re-times every existing row at once**. Lengthening is harmless. Shortening 60 days to 7 makes a large population reapable on the very next maintenance cycle, where the stamped design would have rolled the change in gradually as rows were rewritten. This is arguably correct — the declaration is the truth — but it is a mass-deletion edge, so a shortened TTL should be introduced with the detect-and-report pass first and the kill switch within reach.

### It also removes the need for a backfill

Today a NULL `expires_at` means *never expires*, which is why rows written before a perspective declared `[RowTtl]` are permanently invisible to retention. Under the ladder, NULL means *fall through to the rule* — so every pre-existing row is correctly governed the moment the code deploys, with no data mutation, no opt-in migration, and nothing to schedule.

## What this unlocks

- **Retention gets an honest anchor**, and `expires_at` is freed to mean what its name says — a per-row override — rather than being the row's only replay-invariant timestamp. The separately-proposed TTL backfill becomes unnecessary rather than merely exact.
- **Recency and "what changed" queries work across rebuilds**, which they do not today.
- **Displayed dates stop lying.** Created dates survive projection maintenance.
- **The rule generalizes.** Replay-invariance decides where any future timestamp belongs.

## AOT / zero-reflection statement

Additive columns on the generated perspective schema, values threaded from the existing apply arguments, suppression resolved through the existing hook registry. No runtime attribute inspection, no type scanning, nothing added to the reflection allowlist.

## Build increments (docs-first → TDD each)

0. **Dapper metadata** — implement the metadata-bearing `UpsertAsync` overload in the Dapper store so it persists `PerspectiveMetadata` instead of `'{}'`, plus the reflection drift-lock over every `IPerspectiveStore` implementation. Prerequisite: without it there is no event-time source on that path, and it independently restores `EventType` / `EventId` / correlation / commit-sequence, which are lost today.
1. **Schema** — add `sys_created_at` / `sys_updated_at` across the in-sync schema-definition sites plus the schema hash; migration adds and copy-backfills them. Inert: nothing reads them yet.
2. **Write paths** — both upsert paths stamp system time from the clock and business time from the applied event's timestamp. RED first with a test asserting today's conflated behavior fails under replay.
3. **Replay-invariance lock** — the load-bearing regression: apply a stream, capture both axes, rebuild, assert business time is byte-identical and system time advanced.
4. **Activity suppression** — hook-declared non-activity event types leave business time untouched while still writing the row; precedence tests.
5. **Enrollment registry** — `row_ttl_seconds` on `wh_perspective_registry`, synced at startup; `[RowTtl]` accepts no-duration enrollment. Reaper scans enrolled perspectives instead of every table with the column.
6. **Effective-expiry ladder** — override → rule → never, in the lens filter and the reaper. The load-bearing RED test asserts that a `-1` TTL (kill switch off, unregistered model, per-model disable) expires *nothing*, since a naive addition would reap the fleet.
7. **Terminology sweep** — update every doc and test to the new meanings, including the ones that currently assert wall-clock semantics on `UpdatedAt`, and the sibling docs-site pages under `fundamentals/messaging/apply-hooks`.

## Relationship to neighboring proposals

- [Perspective Row Retention](perspective-row-retention): introduced the event-time-anchored `expires_at` because no replay-invariant timestamp existed on the row. This proposal supplies the general one; retention becomes a consumer rather than a special case.
- **Perspective TTL Backfill** (proposal on an unmerged branch; link resolves once it lands): **depends on this.** Its anchor question ("wall-clock `updated_at` or exact event time?") dissolves once `updated_at` *is* business time.
- [Ephemeral Events](ephemeral-events): rebuild-from-zero is refused for ephemeral streams, so the divergence this fixes is a Sourced-perspective concern — but the columns are uniform across both.
