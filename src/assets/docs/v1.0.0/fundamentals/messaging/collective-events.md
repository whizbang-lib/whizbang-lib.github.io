---
title: Collective Events
pageType: concept
order: 7
codeReferences:
  - src/Whizbang.Core/Messaging/ICollectiveEvent.cs
  - src/Whizbang.Core/Messaging/CollectiveEventBase.cs
  - src/Whizbang.Core/Messaging/CollectiveScope.cs
  - src/Whizbang.Core/Messaging/TenantCollectiveScope.cs
  - src/Whizbang.Core/Messaging/EventFlags.cs
  - src/Whizbang.Core/Perspectives/ICollectiveApplyFor.cs
  - src/Whizbang.Core/Perspectives/ICollectiveSpec.cs
  - src/Whizbang.Core/Perspectives/ICollectiveQuery.cs
  - src/Whizbang.Core/Perspectives/ICollectiveReplayApplier.cs
  - src/Whizbang.Core/Perspectives/CollectiveApplyForAttribute.cs
  - src/Whizbang.Core/Perspectives/CollectiveWhereComposer.cs
  - src/Whizbang.Core/Perspectives/CollectiveApplyOptions.cs
  - src/Whizbang.Core/Perspectives/CollectiveDispatcher.cs
  - src/Whizbang.Core/Perspectives/CollectiveRouting.cs
  - src/Whizbang.Core/Perspectives/TenantCollectiveScopeResolver.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Data.Postgres/Collective/CollectivePredicateSqlCompiler.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveReplayApplier.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveInMemoryExecutor.cs
  - src/Whizbang.Data.EFCore.Postgres/Collective/EFCoreCollectiveAdapter.cs
  - src/Whizbang.Data.EFCore.Postgres/Collective/CollectiveSettersRewriter.cs
  - src/Whizbang.Data.EFCore.Postgres/CollectiveEventsEFCoreExtensions.cs
  - src/Whizbang.Data.Dapper.Postgres/Collective/DapperCollectiveSpecCompiler.cs
  - src/Whizbang.Data.Dapper.Postgres/CollectiveEventsDapperExtensions.cs
  - src/Whizbang.Data.Postgres/Migrations/061_CollectiveEventRouting.sql
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/CollectiveEventContractTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/CollectiveWhereComposerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/CollectiveSpecContractTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/TenantCollectiveScopeResolverTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerCollectiveSinkTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveDispatcherEFCoreIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CollectiveReplayRebuildIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EmitEventStoreChainCollectiveSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectiveApplierIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs
---

# Collective events

A first-class persistable event that mutates **every row in a scope**
as a unit. The producer expresses **scope + a uniform mutation**; the
projection runner applies it as **one predicate SQL `UPDATE` per
affected projection table** whose `WHERE` clause is the scope predicate
(optionally refined per-perspective by the handler). No per-row
enumeration, no per-row event replication, no per-row tracking, no
per-row tax.

Canonical use cases:

- "Archive every job in tenant T"
- "Remove all jobs in tenant T" (soft-delete via a status column)
- "Change the state of every matching job in a scope"
- "Apply this template to every Draft/Approved/Published job in a tenant"

When the producer expresses **intent + scope** rather than a list of
events, this is the primitive — one event row, one SQL `UPDATE`, one
category-level observed event.

## When to reach for it

```
Producer wants to mutate multiple streams in one operation
  │
  ├─ Is the mutation uniform across all targeted streams?
  │   ├─ NO  → ICompositeEvent (hand-crafted per-stream batch)
  │   └─ YES
  │       │
  │       ├─ Does the producer want to name an explicit list of streams?
  │       │   ├─ YES → ICompositeEvent (enumerate them)
  │       │   └─ NO  → ICollectiveEvent ← THIS — scope IS the descriptor
```

Pick **collective** when the mutation is uniform across a scope and you
do **not** need a per-entity event for it. Pick **composite** when each
stream gets a distinct payload. Pick neither (stay individual) when a
per-entity event is consumed downstream — a notification, an
acknowledgment, an audit entry, or a receptor keyed off the per-entity
event.

## Composite vs collective — pick one per producer intent

`ICollectiveEvent` sits **next to** `ICompositeEvent` — additive, not a
replacement. They solve different problems and ship on different runtime
paths. The two contracts share **no inheritance**: `ICollectiveEvent`
extends `IEvent`, and the two run separate code paths end-to-end.

| Dimension | `ICompositeEvent` | `ICollectiveEvent` |
|---|---|---|
| Producer expresses | Explicit list of `(streamId, event)` pairs | Scope + uniform mutation |
| Materialization | Receiver expands to N per-stream events | One event persists; one SQL `UPDATE` per projection |
| Per-stream history | Each stream gets its own event row | Streams have no per-stream record |
| Apply contract | Existing pure `Apply(model, evt)` per stream | `Apply(evt) → ICollectiveSpec<TModel>` per projection |
| Replay path | Composite envelope never reaches replay; inner events do | Collective event itself replays; predicate re-evaluates at replay time |
| Cost shape (10k matches) | 10k events, 10k Applies, 10k SignalR pushes | 1 event, 1 SQL `UPDATE`, 1 category-level push |
| Right when | Hand-crafted heterogeneous batches | Uniform mutation across a scope |

Both can coexist in the same workflow — a bulk import emits composite
per-job events; a tenant cleanup emits a collective event.

## Determinism is at scope level, not stream level

This is the defining design choice and it deserves its own section.

**The principle**: a collective event is a *descriptor*. It says
"apply this mutation to everything in scope-X at this point in the event
sequence." It does **not** enumerate the streams that happened to be in
scope at the moment the producer emitted the event. The event carries no
matched-stream-id set.

Replay re-evaluates the predicate against the projection state at the
moment the collective event is being processed. Because event sourcing
guarantees that the projection state at any point in a replay is fully
determined by the event sequence up to that point, the predicate's
result is deterministic — **but it reflects the logically correct state,
not the original execution's state**.

### Why this is *better* than snapshot determinism

Consider a worked example:

> A producer fires a collective event: "disable every job in tenant T."
> At the moment of the original write, 10 jobs are visible in the
> projection (`j₁`…`j₁₀`). A late-arriving event for an 11th job
> (`j₁₁`) had been emitted *before* the collective event in correct
> stream order, but its delivery was delayed by transport hiccups, so
> it hadn't materialized in the projection yet when the collective
> event fired. The original execution disabled 10 jobs.
>
> Later, you replay the projection from scratch. Replay processes the
> event log in correct order: `j₁₁`'s event arrives at its logically
> correct position **before** the collective event. By the time the
> collective event is being applied during replay, `j₁₁` is visible
> in the projection. The predicate matches `j₁₁` too. Replay disables
> **11 jobs**.

That's correct. The original execution was *temporarily wrong* because
of out-of-order delivery; replay produces the result that should have
happened if events had arrived in their logical order. The projection
self-heals on replay. A snapshot model (where the event carried the
captured `[j₁..j₁₀]` set) would lock in the original execution's mistake
forever.

Re-applying is idempotent — the SET values are constant — and the apply
progresses by keyset cursor (`id > @cursor`), so a partial or resumed
run never skips or double-applies a row.

### What this requires of the developer

The scope predicate and any handler cohort filter must be **a pure
function of the projection's persistent state and the event payload**.
No `DateTime.UtcNow`, no external lookups, no random numbers — the same
discipline event sourcing requires of a regular `Apply`. If you need a
moment-in-time threshold, capture it on the event payload at write time
(e.g. `e.OlderThan = clock.GetUtcNow()`), not at apply time.

### Surviving a full rebuild

Log replay — re-evaluating the predicate at the event's log position —
is one path; a **full perspective rebuild** is the other, and it takes a
different route. The rebuilder replays each perspective's own `Apply()`
events per stream and **never runs the set-based collective SQL path**,
so a collective mutation would be lost on rebuild without a dedicated
seam. `ICollectiveReplayApplier` (default `CollectiveReplayApplier`)
supplies it: during a rebuild it loads the tenant's persisted collective
events for the model being rebuilt, folds them into each stream's event
list, and lets the runner's existing `OrderByMessageId` place them
chronologically among the per-stream events — exactly where they applied
live. For each matching `[CollectiveApplyFor]` entry it invokes the
handler for the spec and hands it to the per-model, **driver-neutral**
`CollectiveInMemoryExecutor<TModel>`, which evaluates the
self-referential `Where` and applies the setters to the one in-memory
row. (The `ICollectiveQuery` it passes throws on use — replay-safe specs
never reach for a sibling, enforced by `WHIZ106`.) Tenant scoping is
essential: a collective for a global template G in tenant A must never
fold into tenant B's row for the same G.

Both drivers register this seam automatically:
`AddCollectiveEventsEFCore` / `AddCollectiveEventsDapper` register the
replay applier, and every `AddCollectiveExecutor{EFCore,Dapper}<TModel>`
registers the matching per-model in-memory executor alongside the SQL
executor.

## The event IS the descriptor

Derive a collective event from **`CollectiveEventBase`**
(`Whizbang.Core.Messaging`). The base carries the event's own
`[StreamId] [GenerateStreamId]` stream id — **each collective event is
its own single-event stream**, minted by the framework at dispatch (the
producer never sets it) — and the `Scope`. Add a `[PinnedId]` and any
mutation-payload fields.

```csharp{
title: "Author a collective event by deriving from CollectiveEventBase"
description: "A collective event carries only its Scope and payload; the framework mints its own single-event stream id at dispatch and persists it like any other event."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["collective-events", "collective-event-base", "scope", "publish", "generate-stream-id"]
}
[PinnedId("…")]
public sealed record ArchiveJobsCollectiveEvent : CollectiveEventBase {
  public required DateTimeOffset OccurredAt { get; init; }
}

// Publish once — the framework mints the event's own stream id,
// persists it, routes it, and applies it collectively:
await dispatcher.PublishAsync(new ArchiveJobsCollectiveEvent {
  Scope = new TenantCollectiveScope(tenantId),
  OccurredAt = DateTimeOffset.UtcNow,
});
```

A collective event carries exactly three things:

- **`Scope`** — the cohort descriptor and the source of the SQL
  `UPDATE`'s scope `WHERE` predicate (see [Scope](#scope)).
- **The event's own runtime type** — dispatches to the matching handlers
  via the generator-emitted registry.
- **The event's payload** — fields the handler reads (e.g.
  `e.OccurredAt`, `e.NewStatus`, `e.OlderThan`).

There is no captured matched-stream-id set, no per-row audit pointer, no
per-stream amplification on the inbox. The event's identity (its
`event_id`) plus the `wh_event_store` row is the complete audit trail.

## Authoring a handler

The mutation lives on a **perspective handler**, not the event. Mark a
method `[CollectiveApplyFor]`; it returns the SET clauses (and an
optional per-model `Where`) as an `ICollectiveSpec<TModel>`, and the
framework composes the `WHERE` from the scope resolver.

```csharp{
title: "Author a collective-event handler with [CollectiveApplyFor]"
description: "A handler describes only the uniform mutation (set Status and ArchivedAt) while the framework composes the scope resolver's WHERE clause for the single SQL UPDATE."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["collective-events", "collective-apply-for", "collective-spec", "set-property", "scope"]
}
public sealed class JobCollectivePerspective {
  [CollectiveApplyFor]
  public ICollectiveSpec<JobModel> ArchiveJobs(ArchiveJobsCollectiveEvent e) =>
    new CollectiveSpec<JobModel>(s => s
      .SetProperty(j => j.Status, "Archived")
      .SetProperty(j => j.ArchivedAt, e.OccurredAt));
}
```

The handler describes **only the mutation**. The `WHERE` clause that
gates the SQL `UPDATE` is composed by the framework from the scope
resolver's `ScopeFilter(evt.Scope)` — optionally AND-ed with a
per-model `Where` you supply (see below).

Handlers are discovered at **compile time** by the
`CollectiveApplyDiscoveryGenerator`, which emits a reflection-free
`CollectiveApplyRegistry.Entries` dispatch table **per assembly** —
one typed `Invoker` lambda per `(ModelType, EventType)`. At runtime the
dispatcher indexes by `(ModelType, EventType)` and invokes the lambda;
no reflection, AOT-clean by construction. The attribute is read on the
**method**, not the type, so one perspective class can declare several
`[CollectiveApplyFor]` handlers for different events.

> `CollectiveSpec<TModel>` is a small **consumer-owned** record —
> Whizbang ships the `ICollectiveSpec<TModel>` interface but no concrete
> implementation. Give it a `Setters` member and a nullable `Where`
> member; the default-interface-member `Where => null` keeps
> Setters-only specs working unchanged.

### What the SET surface can express

`ICollectiveSetters<TModel>` exposes two `SetProperty` overloads:

- **`SetProperty(selector, value)`** — assign a **constant** or
  event-supplied (captured) value. This is the primary shape and is
  supported on **both** drivers. Multiple `SetProperty` calls compose
  into one SQL `UPDATE`.
- **`SetProperty(selector, computed)`** — assign an expression of the
  row's own current state. In v1 the **only** computed shape both
  drivers translate is a **property-vs-constant boolean comparison**
  (`j => j.SomeProp == value` or `!= value`) — e.g.
  `SetProperty(j => j.IsActive, j => j.Status == "Active")`.

Computed **arithmetic / increment / string / date** setters
(`j => j.ViewCount + 1`, `j => j.Balance + e.Amount`) and relational
comparisons other than `==` / `!=` (`<`, `>`) are **not supported in
v1** — both the EF Core `CollectiveSettersRewriter` and the
`DapperCollectiveSpecCompiler` throw `NotSupportedException` pointing at
`SpecKind = RawSql`. Nested paths (`j => j.Nested.X`) and indexed access
likewise throw. The `CollectiveSpecKind.RawSql` enum value is defined as
the intended escape hatch, but **no concrete raw-SQL spec type ships in
v1**, so these richer computed shapes have no working path yet.

### Per-perspective projection (`Where`)

The **same persisted collective event projects independently into every
perspective that handles it** — across models and across services.
`CollectiveApplyRegistry` is generated **per assembly**, so each service
declares its own `[CollectiveApplyFor]` handler for its own `TModel`;
the one routed event fans out to all of them, and each perspective
interprets the collective intent in **its own** columns.

Each handler projects two things onto its model:

- **the SET clauses** — already per-model via `ICollectiveSpec<TModel>.Setters`;
- **the `WHERE`** — via the optional `ICollectiveSpec<TModel>.Where`
  (an `Expression<Func<PerspectiveRow<TModel>, bool>>?`, default
  `null`). The handler — which *knows its model* — shapes the cohort
  onto its own columns, e.g. `r => r.Data.Status == "Draft"`.

How `Where` composes with the resolver's scope filter is governed by
`[CollectiveApplyFor(ScopeHandling = …)]`, via `CollectiveWhereComposer`:

| `ScopeHandling` | Effective `WHERE` | Use when |
|---|---|---|
| **`Framework`** (default) | `scopeFilter AND Where` (or the scope filter alone when `Where` is null) | The scope envelope (e.g. tenant) must always bind; the handler only *refines* within it and can't over-mutate. |
| **`Custom`** | `scopeFilter AND Where` (a non-null `Where` is **required**) | The handler owns the **cohort** predicate the model-agnostic resolver can't express — but the scope envelope **still binds**. A null `Where` here is a misconfiguration and throws. |

> **The scope envelope always binds.** Both modes AND the resolver's
> scope filter into the SQL `WHERE`; a `Custom` handler refines *within*
> its scope and can never escape it — perspective tables are shared
> multi-tenant, so this is a data-safety guarantee, not a convenience.
> (A `null` scope filter — an explicitly unscoped/global resolver — is
> the only case where a `Custom` handler's `Where` stands alone.) The
> only remaining difference between the modes is that `Framework`
> permits a null `Where` (scope alone) while `Custom` requires the
> handler to supply the cohort predicate.

```csharp{
title: "Refine the cohort within the scope envelope with a per-model Where"
description: "Framework mode ANDs the handler's Where onto the resolver scope filter; Custom mode requires a Where but the resolver scope is still AND-ed in for tenant safety."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["collective-events", "collective-apply-for", "scope-handling", "where", "tenant-safety"]
}
// Refine WITHIN the tenant envelope — only jobs with no overlay, in the
// event's tenant. Framework mode ANDs the scope filter and this Where:
[CollectiveApplyFor]                                    // ScopeHandling = Framework (default)
public ICollectiveSpec<DraftJobModel> ApplyTemplate(TemplateAppliedCollectiveEvent e) =>
  new CollectiveSpec<DraftJobModel>(
    Setters: s => s.SetProperty(j => j.JobTemplateId, e.TemplateId),
    Where:   r => r.Data.OverlayId == null);

// Own the cohort predicate on the handler's own columns — the resolver
// scope is STILL AND-ed in (tenant safety), even under Custom:
[CollectiveApplyFor(ScopeHandling = CollectiveScopeHandling.Custom)]
public ICollectiveSpec<DraftJobModel> ClearOverlay(OverlayClearedCollectiveEvent e) =>
  new CollectiveSpec<DraftJobModel>(
    Setters: s => s.SetProperty(j => j.OverlayId, (Guid?)null),
    Where:   r => r.Data.OverlayId == e.OverlayId);
```

### Cross-perspective cohorts (`ICollectiveQuery`)

A `Where` over `row.Data` only sees the table being mutated. When the
cohort is defined by a field on a **sibling** read model — e.g.
JobService's `DraftJobModel` carries no status (it lives on the sibling
`DraftJobStatusModel`, keyed by the same id) — the handler's `Apply`
receives an **`ICollectiveQuery`** and reaches the sibling through it:

```csharp{
title: "Reach a sibling read model in the cohort with ICollectiveQuery"
description: "q.Of<TOther>() returns a queryable over a sibling perspective's rows; a correlated .Any(...) translates to a correlated EXISTS in the same single UPDATE on both drivers."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["collective-events", "collective-query", "sibling", "exists", "cohort"]
}
[CollectiveApplyFor]                                  // Framework: tenant envelope AND this cohort
public ICollectiveSpec<DraftJobModel> ApplyTemplate(TemplateAppliedCollectiveEvent e, ICollectiveQuery q) =>
  new CollectiveSpec<DraftJobModel>(
    Setters: s => s.SetProperty(j => j.JobTemplateId, e.TemplateId),
    Where:   r => q.Of<DraftJobStatusModel>()
                   .Any(st => st.Id == r.Id && Eligible.Contains(st.Data.Status)));
```

`ICollectiveQuery.Of<TOther>()` returns a queryable over the sibling
perspective's rows. Both drivers translate the resulting `.Any(...)`
into a **correlated `EXISTS`** in the same single `UPDATE`:

- **EF Core** — `Of<TOther>()` is the live
  `DbContext.Set<PerspectiveRow<TOther>>()`; EF funcletizes the `q.Of()`
  call and emits `EXISTS (SELECT 1 FROM <sibling> s WHERE s.id = d.id AND …)`.
- **Dapper** — the filter compiler reads the `q.Of<TOther>()` node,
  resolves the sibling table (registered via `AddCollectiveTableDapper<TOther>`),
  and emits the same `EXISTS` SQL; `.Any` → `EXISTS`, `Contains` → `IN`.

Supported inside the `.Any(...)`: an `Id`-correlation (`st.Id == r.Id`)
plus equality / `Contains` leaf predicates over the sibling's
`Data`/`Scope`. Richer shapes (non-equality, nested `EXISTS`) throw a
clear `NotSupportedException`. Handlers that don't need a sibling simply
ignore the `ICollectiveQuery` parameter.

## Scope

`Scope` is a **`CollectiveScope`** — an abstract polymorphic **record**
(not a bare interface) so the event round-trips through the AOT-strict,
source-generated message serializer via a `$scopeKind` discriminator.
`CollectiveScope` implements `ICollectiveScope` (the behavioral contract
the resolvers use). The built-in scope is
`TenantCollectiveScope(string TenantId)` (kind `"tenant"`). The
`ScopeKind` string selects the `ICollectiveScopeResolver` that owns the
`WHERE`-predicate composition for that scope family.

> **Why an abstract record, not an interface.** The AOT serializability
> analyzer (WHIZ062) rejects a bare non-generic interface property on an
> event — there is no concrete shape to source-generate a serializer
> for. A single polymorphic value on a serializable type uses an
> abstract base with `[JsonDerivedType]` discriminators (the same
> pattern as `AbstractFieldSettings`).

:::updated
**Discriminator contract correction (verified against library commit `f2657adc`)**: the generator does **not** honor custom `TypeDiscriminatorPropertyName` (e.g. `$scopeKind`) or custom `[JsonDerivedType]` strings (e.g. `"tenant"`). Generated serialization always uses **`$type`** with **simple type names** (`"TenantCollectiveScope"`); the attributes act as discovery markers only. Wire payloads and any consumers must expect the `$type`/type-name form, or typed readback returns zero events.
:::

### `TenantCollectiveScope`

```csharp{
title: "Emit a collective event scoped by TenantCollectiveScope"
description: "TenantCollectiveScopeResolver auto-registers by ScopeKind 'tenant' and composes a row.Scope.TenantId == tenantId predicate for the single scope-wide UPDATE."
framework: "NET10"
category: "Messaging"
difficulty: "BEGINNER"
tags: ["collective-events", "tenant-scope", "collective-scope", "publish", "scope-resolver"]
}
var evt = new ArchiveJobsCollectiveEvent {
  Scope = new TenantCollectiveScope("t-1"),
  OccurredAt = clock.GetUtcNow(),
};
await dispatcher.PublishAsync(evt);
```

`TenantCollectiveScopeResolver` is registered by `ScopeKind` = `"tenant"`
and composes `row => row.Scope.TenantId == tenantId` as the scope
`WHERE` predicate (which compiles to a `scope->>'t'` equality against
the perspective row's scope column).

### Custom scopes

To add a new scope kind (e.g. `OrganizationCollectiveScope`):

1. Derive a record from **`CollectiveScope`** with a unique `ScopeKind`
   string. Deriving from the abstract base — not just implementing
   `ICollectiveScope` — is what makes it AOT-serializable through the
   `$scopeKind` discriminator, and the scope kind must be registered for
   polymorphic serialization the same way the built-in `"tenant"` scope
   is on the base.
2. Implement `ICollectiveScopeResolver` for that kind — return the
   correct `Expression<Func<PerspectiveRow<TModel>, bool>>` for your row
   shape.
3. Register the resolver in DI:
   `services.AddSingleton<ICollectiveScopeResolver, OrgCollectiveScopeResolver>();`

The dispatcher indexes resolvers by `ScopeKind`. A missing resolver is a
handled failure (logged with a structured error class), not a crash.

## `EventFlags` — categorizing events without column churn

Whizbang categorizes events on `wh_event_store` / `wh_outbox` /
`wh_inbox` using a single `flags INTEGER NOT NULL DEFAULT 0` column
that's a bitmask of the `EventFlags` enum:

```csharp{
title: "EventFlags bitmask for categorizing events without column churn"
description: "A [Flags] enum stored in one flags column on wh_event_store/wh_outbox/wh_inbox that lets the pipeline route collective and composite events without adding a boolean column per category."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["collective-events", "event-flags", "bitmask", "routing", "schema"]
}
[Flags]
public enum EventFlags {
  None       = 0,
  Collective = 1 << 0,
  Composite  = 1 << 1,
  // treatment flags (e.g. NoRebroadcast) and future categories add new
  // flag bits without schema migrations
}
```

The producer stamps `EventFlags.Collective` (`flags & 1`) on the
outbox/inbox row; the pipeline branches on it to route to the collective
apply path. New event categories ship by adding a flag value — no
boolean column per category, no migration tax.

### Schema additions

The collective-events feature adds the `flags` column to the three
message tables (all carrying the same `EventFlags` value, preserved
through transport). It adds **no new columns on perspective tables**
(`wh_per_*`) and no per-event array column — perspectives that never
receive collective events pay no schema tax.

> The tenant-scope filter needs a btree `((scope->>'t'))` expression
> index (a `gin(scope)` index cannot serve `->>` equality). That index
> is created **at service startup** by the EF Core schema generator
> (`EFCoreServiceRegistrationGenerator`) — the same one lens tenant
> queries already use — **never in the apply path**. It is a general
> tenant-scope index, not a collective-specific one.

## Persistence, routing, and dispatch

A collective event is a **first-class persisted `IEvent`**
(`ICollectiveEvent : IEvent`), so it flows through the normal
produce → persist → project pipeline, with one branch at the apply seam.

```mermaid{title="Collective-event apply pipeline from producer to projection UPDATE" description="A collective event flows through outbox, transport, and inbox; the event-store chain routes it to the fixed __collective__ sink, and the perspective worker dispatches it once through the collective dispatcher into a single scope-filtered SQL UPDATE."}
sequenceDiagram
  autonumber
  participant P as Producer
  participant OB as wh_outbox (flags)
  participant TX as Transport
  participant ES as wh_event_store (flags)
  participant PE as wh_perspective_events
  participant W as PerspectiveWorker
  participant D as CollectiveDispatcher
  participant H as Perspective handler
  participant A as Executor + Adapter
  participant DB as Projection table

  P->>OB: Publish event (flags |= Collective)
  OB->>TX: Outbox publish (flags preserved)
  TX->>ES: Event-store chain (mig 061) carries flags
  ES->>PE: One '__collective__' sink row (driven by flags & 1)
  PE->>W: Worker leases the __collective__ sink
  W->>D: DispatchAsync (exactly once per event)
  D->>H: Invoke each (TModel, TEvent) handler → ICollectiveSpec
  H-->>D: spec (SET clauses + optional Where)
  D->>A: Compose scope filter ⨯ handler Where ⨯ SET
  A->>DB: Keyset-batched UPDATE ... jsonb_set(...) WHERE <scope AND cohort>
  DB-->>A: Affected row count
  A-->>W: Success → complete sink row by event_work_id
```

1. **Persist.** Published like any event; the producer stamps
   `EventFlags.Collective` on the outbox/inbox row. Migration **061**
   (`061_CollectiveEventRouting.sql`) carries `flags` into
   `wh_event_store` (it was previously dropped on the copy) and stores
   the event on its own stream.
2. **Route.** For each stored event with `(flags & 1) = 1`, migration
   061 creates **exactly one** `wh_perspective_events` row with
   `perspective_name = '__collective__'` (the
   `CollectiveRouting.SINK_PERSPECTIVE_NAME` sink) — driven purely by
   the flag, **no association lookup**. One sink row per event regardless
   of how many model handlers subscribe.
3. **Dispatch.** `PerspectiveWorker` special-cases the `__collective__`
   sink (both channel and drain paths): it loads the collective event(s)
   on the sink stream, resolves `ICollectiveDispatcher` + the projection
   session, calls `DispatchAsync` **exactly once** per event, advances
   the sink cursor, and **skips the per-stream runner** (a collective
   event has no single target stream). The dispatcher fans out internally
   to every matching `TModel` handler.
4. **Complete the sink row.** On a successful dispatch the worker
   completes its own `__collective__` work rows **by `event_work_id`**
   (`_completeCollectiveSinkWorkRows`) — the same completion path every
   standard perspective uses — so an orphan-claim sweep can't re-lease
   them. (Omitting this by-`event_work_id` completion once left applied
   sink rows with `processed_at = NULL`, so they were re-leased and the
   whole-cohort `UPDATE` re-dispatched every tick — a self-sustaining
   re-dispatch loop. That is fixed and regression-locked.)

### Failure semantics

- The SQL `UPDATE` either commits or rolls back — **no per-row
  soft-fail** (there is no `ApplyResult.Delete`/`Purge` equivalent for
  the set-based path). The target use cases ("archive all in tenant T")
  don't want partial-row outcomes.
- A missing resolver or missing executor is a **handled** failure,
  logged with a structured error class on `EventCategoryMetrics.Errors`,
  not a crash.

## Apply execution — scoped, bounded, indexed

Each handler's apply is **one predicate `UPDATE` per projection table**,
hardened so a large cohort can never convoy locks or run away:

- **Predicate `UPDATE`, no whole-cohort id-gather.** The composed
  `WHERE` (scope envelope AND the handler cohort) is compiled straight to
  SQL by the shared `CollectivePredicateSqlCompiler` — no
  `SELECT id … ToList` of the whole cohort. One code path serves both
  drivers.
- **Scope always binds.** The resolver's scope predicate is always
  AND-ed in, even under `Custom` (see the [ScopeHandling
  table](#per-perspective-projection-where)).
- **Keyset batching.** The cohort is applied in
  `CollectiveApplyOptions.BatchSize` chunks (default **1000**):
  `… WHERE <pred> AND id > @cursor ORDER BY id LIMIT n` → a
  `UPDATE … WHERE id = ANY(@ids)`, each in its own short transaction —
  bounded lock holds, never materializes the whole cohort.
- **Server-side `statement_timeout`.** `SET LOCAL statement_timeout`
  per batch (via `set_config(..., true)` — the only form that survives
  PgBouncer transaction pooling) so a runaway batch is cancelled by
  Postgres itself, never left a zombie. Null (default) leaves the
  server/role default in place.
- **Per-(table, scope) exclusive advisory lock.** When
  `SerializeApplies` is true (default), each batch takes
  `pg_advisory_xact_lock(hash(table, scope))` — DB-global, so it
  serializes same-scope collective applies **across pods** while
  disjoint scopes (e.g. different tenants) run concurrently.
- **Store-managed columns.** The `UPDATE` also stamps `updated_at` and
  bumps `version` (a collective `UPDATE` writing only `data` would leave
  them stale and break change-detection).

The EF Core apply runs each batch as raw parameterized SQL via
`ExecuteSqlRawAsync` — a hand-built
`UPDATE … SET data = jsonb_set(jsonb_set(data, @path0, @p0::jsonb), …)`
composed from the setters rewriter and predicate compiler — not
`ExecuteUpdateAsync`.

Per-handler knobs override the global `CollectiveApplyOptions` for a
heavy or light handler:
`[CollectiveApplyFor(BatchSize = …, StatementTimeoutSeconds = …)]`
(`0` = inherit).

### Observability — traces + metrics

A collective event's fan-out and apply are **traced** so a single slow
event is investigable by type/namespace, not just an aggregate metric:

- **`Collective Dispatch` span** (`ActivitySource` `Whizbang.Tracing`,
  from `CollectiveDispatcher`) wraps the whole fan-out. Tags include
  `whizbang.collective.event_type`, `…event_namespace`, `…scope_kind`,
  `…event_id`, and `…handler_count`. A failed apply sets the span status
  to `Error`.
- **`Collective Apply` span** (child, from `EFCoreCollectiveAdapter`)
  wraps the keyset-batched `UPDATE` loop. Tags include
  `whizbang.collective.model_type`, `…table`, `…event_id`,
  `…batch_size`, `…affected_rows`, and `…batches`. It nests under the
  dispatch span, so a slow event drills down to which table / how many
  batches consumed the time. Register the source with
  `.AddSource("Whizbang.Tracing")` in your OTel pipeline.
- **Metrics** (`EventCategoryMetrics`, meter `Whizbang.EventCategories`,
  category `COLLECTIVE`) carry the same `event_type` / `event_namespace`
  / `scope_kind` dimensions: `dispatched`, `fanout`, `errors` — so
  dashboards and traces line up on the same tag keys.

## DI wiring

### EF Core (Postgres)

```csharp{
title: "Register collective events on the EF Core Postgres driver"
description: "AddCollectiveEventsEFCore takes the generated CollectiveApplyRegistry.Entries and wires the dispatcher, tenant resolver, session accessor, and replay applier; one AddCollectiveExecutorEFCore per perspective model that has a [CollectiveApplyFor] handler."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["collective-events", "dependency-injection", "ef-core", "postgres", "registration"]
}
services
  // entries = your assembly's generated Whizbang.Core.Generated.CollectiveApplyRegistry.Entries
  // (the framework assembly's own copy is empty). Required — no parameterless overload.
  .AddCollectiveEventsEFCore<MyPerspectiveDbContext>(CollectiveApplyRegistry.Entries) // dispatcher + resolver + session + replay applier
  .AddCollectiveExecutorEFCore<JobModel>();                                           // one per model with a [CollectiveApplyFor]
// Custom scope kinds: also register your ICollectiveScopeResolver.
```

`AddCollectiveExecutorEFCore<TModel>` is an explicit compile-time
generic call (no `MakeGenericType`) to stay AOT-clean, and it also
registers the model's driver-neutral `CollectiveInMemoryExecutor<TModel>`
for the rebuild path.

### Dapper (Postgres)

Dapper DI mirrors EF Core: `AddCollectiveEventsDapper(entries)` +
`AddCollectiveExecutorDapper<TModel>(tableName)` (Dapper supplies the
`wh_per_*` table name since it has no entity model to derive it from),
plus `AddCollectiveTableDapper<TOther>(tableName)` for any **query-only
sibling** a handler reaches via `q.Of<TOther>()`. `entries` is the same
generated `CollectiveApplyRegistry.Entries`.

## Driver support

| Driver | SET → SQL | WHERE → SQL | Apply | Status |
|---|---|---|---|---|
| **EF Core** (`Whizbang.Data.EFCore.Postgres`) | `CollectiveSettersRewriter` → nested `jsonb_set` | shared `CollectivePredicateSqlCompiler` | `EFCoreCollectiveAdapter` — keyset-batched predicate `UPDATE` (raw parameterized SQL via `ExecuteSqlRawAsync`) + advisory lock + `statement_timeout` | **Complete** |
| **Dapper** (`Whizbang.Data.Dapper.Postgres`) | `DapperCollectiveSpecCompiler` → `jsonb_set` | shared `CollectivePredicateSqlCompiler` | `DapperCollectiveEventApplier` — keyset-batched + advisory lock + `statement_timeout` | **Parity** (no apply-completion log yet) |

Both drivers share **one** WHERE compiler
(`CollectivePredicateSqlCompiler`, in `Whizbang.Data.Postgres`) and the
same keyset-batched apply shape. The shared compiler translates equality
over a **scope** field (`row.Scope.Prop == value` → `scope->>'Prop'`)
**or a data** field (`row.Data.Prop == value` → `data->>'Prop'`);
`&&`-chains mixing both; `Contains` (→ `IN`); and
`q.Of<TOther>().Any(...)` cross-perspective cohorts (→ a correlated
`EXISTS`). It throws for richer predicates (non-equality, disjunctions,
arbitrary top-level columns, nested `EXISTS`).

For SET clauses, both compilers support scalar top-level
`SetProperty(j => j.Prop, constant)` with constant/captured-value
sources, chained setters, and the property-vs-constant `==`/`!=` computed
comparison. Arithmetic-computed setters and nested paths throw
`NotSupportedException` in both (see [What the SET surface can
express](#what-the-set-surface-can-express)).

## Observer model

A collective event surfaces as **one observed event** at the category
level — receptors, sagas, and SignalR pushes see a single
`ICollectiveEvent`. No per-stream amplification on the observer side.

Because a collective event has no per-stream runner, it never reaches
the normal `PostAllPerspectives` gate — but the set-based apply
*finishing* is its "all-perspectives-complete" moment. On the success
path **only**, the worker runs each applied event through the four
terminal lifecycle stages in order — `PostAllPerspectivesDetached` →
`PostAllPerspectivesInline` → `PostLifecycleDetached` →
`PostLifecycleInline` — via `IReceptorInvoker`
(`_fireCollectivePostApplyLifecycleAsync`; a no-op when no
`IReceptorInvoker` is registered). This is what lets a
`[FireAt(PostAllPerspectivesInline)]` receptor and any
`[NotificationTag]` fire *after* the apply is durably done — e.g. a
completion receptor that publishes the tag-bearing "orchestration
completed" event a UI's progress toast waits on. Per-event failures in
this terminal stage are **isolated and logged** — the apply already
committed and its sink rows are completed, so a throwing completion
receptor must neither crash the sink nor undo the apply. A **failed**
apply returns before this step, so a completion signal is never emitted
for an apply that did not happen.

## Sample project

A self-contained walkthrough lives at `samples/CollectiveEvents/` in the
library repo. It shows a tiny `JobModel`, a consumer-owned
`CollectiveSpec<TModel>` record, a perspective with `[CollectiveApplyFor]`
handlers (including a per-model `Where` that refines onto the model's own
columns), and the DI registration. It compiles standalone as a
demonstration of the authoring surface.
