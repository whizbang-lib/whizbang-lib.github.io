---
title: Collective Events
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
order: 7
codeReferences:
  - src/Whizbang.Core/Messaging/ICollectiveEvent.cs
  - src/Whizbang.Core/Messaging/CollectiveEventBase.cs
  - src/Whizbang.Core/Messaging/CollectiveOrdering.cs
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
  - src/Whizbang.Data.Postgres/Collective/CollectiveElementUpsertSql.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveInMemoryEvaluator.cs
  - src/Whizbang.Data.Postgres/Collective/CollectivePhysicalColumns.cs
  - src/Whizbang.Core/Perspectives/PerspectivePhysicalFieldRegistry.cs
  - src/Whizbang.Core/Perspectives/ICollectiveSetters.cs
  - src/Whizbang.Data.Dapper.Postgres/CollectiveEventsDapperExtensions.cs
  - src/Whizbang.Data.Postgres/Migrations/061_CollectiveEventRouting.sql
  - src/Whizbang.Data.Postgres/Migrations/175_CollectiveSinkQueue.sql
  - src/Whizbang.Data.Postgres/Collective/CollectiveApplyContention.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/CollectiveEventContractTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/CollectiveWhereComposerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/CollectiveSpecContractTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/TenantCollectiveScopeResolverTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerCollectiveSinkTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveDispatcherEFCoreIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveInMemoryUpsertElementTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveElementUpsertSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectiveApplierIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CollectiveReplayRebuildIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EmitEventStoreChainCollectiveSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectiveApplierIntegrationTests.cs
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectivePhysicalColumnIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectivePhysicalColumnIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/CollectivePhysicalColumnCompilerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectivePhysicalFieldRegistryTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CollectiveOrderingKeyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CollectiveSinkQueueSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveReplayOrderingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveOrderingIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectiveOrderingIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/CollectivePredicateOrderingTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerPhysicalFieldRegistrationTests.cs
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

- "Archive every order in tenant T"
- "Remove all orders in tenant T" (soft-delete via a status column)
- "Change the state of every matching order in a scope"
- "Apply this template to every Draft/Approved/Published order in a tenant"

When the producer expresses **intent + scope** rather than a list of
events, this is the primitive — one event row, one SQL `UPDATE`, one
category-level observed event.

## When to reach for it

```mermaid{caption="Decision tree for choosing ICollectiveEvent vs ICompositeEvent vs staying with individual per-entity events"}
flowchart TD
    Start["Producer wants to mutate multiple streams in one operation"]
    Q1{"Is the mutation uniform across<br/>all targeted streams?"}
    Composite1["ICompositeEvent<br/>(hand-crafted per-stream batch)"]
    Q2{"Does the producer want to name<br/>an explicit list of streams?"}
    Composite2["ICompositeEvent<br/>(enumerate them)"]
    Collective["ICollectiveEvent ← THIS<br/>scope IS the descriptor"]

    Start --> Q1
    Q1 -->|NO| Composite1
    Q1 -->|YES| Q2
    Q2 -->|YES| Composite2
    Q2 -->|NO| Collective

    style Collective fill:#d4edda,stroke:#28a745,stroke-width:2px
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
per-order events; a tenant cleanup emits a collective event.

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

> A producer fires a collective event: "disable every order in tenant T."
> At the moment of the original write, 10 orders are visible in the
> projection (`j₁`…`j₁₀`). A late-arriving event for an 11th order
> (`j₁₁`) had been emitted *before* the collective event in correct
> stream order, but its delivery was delayed by transport hiccups, so
> it hadn't materialized in the projection yet when the collective
> event fired. The original execution disabled 10 orders.
>
> Later, you replay the projection from scratch. Replay processes the
> event log in correct order: `j₁₁`'s event arrives at its logically
> correct position **before** the collective event. By the time the
> collective event is being applied during replay, `j₁₁` is visible
> in the projection. The predicate matches `j₁₁` too. Replay disables
> **11 orders**.

That's correct. The original execution was *temporarily wrong* because
of out-of-order delivery; replay produces the result that should have
happened if events had arrived in their logical order. The projection
self-heals on replay. A snapshot model (where the event carried the
captured `[j₁..j₁₀]` set) would lock in the original execution's mistake
forever.

Re-applying is idempotent — the SET values are constant — and the apply
progresses by keyset cursor (`id > @cursor`), so a partial or resumed
run never skips or double-applies a row.

### Ordering between collectives: the ordering key {#ordering-key}

The scope-level determinism above holds *given an order* of collectives. Without more, two
collectives have none: each is its own stream, sink streams on different instances apply in
parallel, and the per-scope advisory lock serializes two applies without ordering them. That
is invisible to a collective whose setters commute, and wrong for one that expresses "latest
wins" as a set-based flip (`IsActive = (Id == e.Chosen)` across a family of rows), or for two
collectives that are the halves of one change (deactivate the old record, activate the new
one): the earlier one can land last.

Set an **ordering key** on those collectives:

```csharp{
title: "Order the collectives of one family"
description: "Collectives sharing an ordering key in one scope apply one at a time, in commit order, live and on replay."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["collective-events", "ordering-key", "ordering"]
tests: ["CollectiveOrderingKeyTests.TwoEventTypes_SharingAKeyInOneScope_ShareAStreamAsync", "PerspectiveWorkerCollectiveSinkTests.CollectiveSink_OrderedQueue_AppliesInCommitOrder_WhenIdsRunBackwardAsync", "CollectiveReplayOrderingTests.Fold_TwoCollectivesSharingAKey_EndsAtTheLaterCommitsResultAsync"]
}
await dispatcher.PublishAsync(new DeactivateOrderCollectiveEvent {
  Scope = new TenantCollectiveScope(tenantId),
  OrderingKey = "activation:" + familyId,
  OrderId = previous,
});
await dispatcher.PublishAsync(new ActivateOrderCollectiveEvent {
  Scope = new TenantCollectiveScope(tenantId),
  OrderingKey = "activation:" + familyId,
  OrderId = next,
});
```

What the key guarantees:

- **Collectives sharing a key in one scope apply one at a time, in the order the database
  committed them.** The event's stream id is derived from the scope and the key
  (`CollectiveOrdering.StreamIdFor`), so every such collective, of any type, lands on one
  stream and one `__collective__` sink stream. The sink applies that stream's queue
  (`wh_collective_sink_queue`) in commit order: `commit_sequence`, an unstamped event last,
  `event_id` breaking the tie.
- **Commit order, not id order.** An event id is minted before commit, so two producers can
  commit in the opposite order to their ids. The sink reads the queue by work row, not after
  its cursor, so the later commit applies last even when its id is the smaller.
- **A collective waiting its turn holds everything behind it.** The sink applies the leading
  collectives it holds and stops at the first it does not (leased elsewhere, backing off after
  a failure, or waiting for its apply lock). A failed collective is retried in its place,
  never overtaken.
- **Replay agrees with live.** A rebuild folds the collectives sharing a stream in the same
  commit order, within the positions their ids gave them among the row's own events.
- **Across services** the key's stream travels with the event, and the outbox publishes a
  stream in order, so the consuming service commits them, and applies them, in the producer's
  order. A transport that reorders a stream is outside what the key can repair: a collective
  that arrives after a later one has applied is applied then, since an apply cannot be undone.

Pick the key at the grain of the family (`"activation:" + familyId`): everything sharing a key
is serialized, so a key wider than the family costs throughput for nothing. Collectives
without a key are unchanged. `CollectiveEventBase` derives the stream for you; a hand-written
`ICollectiveEvent` that returns a key must also return `CollectiveOrdering.StreamIdFor(Scope,
OrderingKey)` from its `[StreamId]` property. The derivation is a compatibility contract:
every producer and consumer must compute the same stream.

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
chronologically among the per-stream events; collectives that share an
[ordering key](#ordering-key) are then put in commit order among themselves,
the order the live sink applied them in. For each matching `[CollectiveApplyFor]` entry it invokes the
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
unverified: "Consumer authoring illustration deriving a domain event from CollectiveEventBase and publishing it; the depicted framework stream-id minting at dispatch is not isolated by a candidate unit test."
}
[PinnedId("…")]
public sealed record ArchiveOrdersCollectiveEvent : CollectiveEventBase {
  public required DateTimeOffset OccurredAt { get; init; }
}

// Publish once — the framework mints the event's own stream id,
// persists it, routes it, and applies it collectively:
await dispatcher.PublishAsync(new ArchiveOrdersCollectiveEvent {
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
tests: ["CollectiveSpecContractTests.ICollectiveSpec_Setters_IsLinqExpressionTreeAsync", "CollectiveSpecContractTests.ICollectiveSetters_ConstantSetProperty_OverloadCompilesAsync"]
}
public sealed class OrderCollectivePerspective {
  [CollectiveApplyFor]
  public ICollectiveSpec<OrderModel> ArchiveOrders(ArchiveOrdersCollectiveEvent e) =>
    new CollectiveSpec<OrderModel>(s => s
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

`ICollectiveSetters<TModel>` exposes two `SetProperty` overloads, plus `UpsertElement` for [keyed array elements](#keyed-array-elements):

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

### Keyed array elements {#keyed-array-elements}

{verified: CollectiveDispatcherEFCoreIntegrationTests.DispatchAsync_UpsertElement_ReplacesTheMatchingElement_KeepingOrderAsync, CollectiveDispatcherEFCoreIntegrationTests.DispatchAsync_UpsertElement_AppendsWhenNoElementHasTheKeyAsync, CollectiveDispatcherEFCoreIntegrationTests.DispatchAsync_UpsertElement_OnAMissingArray_WritesAOneElementArrayAsync, CollectiveDispatcherEFCoreIntegrationTests.DispatchAsync_UpsertElement_ComposesWithSetProperty_InOneUpdateAsync, DapperCollectiveApplierIntegrationTests.UpsertElement_ReplacesTheMatchingElement_KeepingOrder_WithinScopeAsync, CollectiveInMemoryUpsertElementTests.Upsert_ReplacesTheMatchingElement_KeepingOrderAsync}

A read model often keeps a second, rendered copy of a field inside a keyed array: one element per
field, keyed by a field id, carrying what a UI renders. `SetProperty` on the top-level field leaves
that element alone, and every surface that reads the array (a preview panel, a read-only view, a
snapshot captured into a published version) keeps showing the old value.

`UpsertElement` writes the element too, in the same set-based UPDATE:

```csharp{title="Updating a field and its rendered element together" description="Sets the top-level family fields and replaces the family cell in the Cells array for every job in the cohort, in one UPDATE" category="Messaging" difficulty="INTERMEDIATE" tags=["Collective Events", "Perspectives", "Keyed Arrays", "jsonb"] tests=["CollectiveDispatcherEFCoreIntegrationTests.DispatchAsync_UpsertElement_ComposesWithSetProperty_InOneUpdateAsync"]}
[CollectiveApplyFor]
public ICollectiveSpec<JobFieldsModel> ApplyFamily(FamilyAppliedToJobsCollectiveEvent e) {
  var familyCell = FamilyField.RenderCell(e.FamilyId, e.FamilyName);
  return new CollectiveSpec<JobFieldsModel>(
    Setters: s => s
      .SetProperty(m => m.FamilyId, (Guid?)e.FamilyId)
      .SetProperty(m => m.FamilyName, (string?)e.FamilyName)
      .UpsertElement(m => m.Cells, c => c.FieldId, familyCell),
    Where: r => e.JobIds.Contains(r.Data.Id));
}
```

- **Replace or append.** The element whose key equals the new element's key is replaced where it
  stands; every other element keeps its value and its position. When none matches, the element is
  appended. A missing or null array becomes a one-element array.
- **Several upserts on one list compose, in call order.** Each upsert starts from the list as the
  earlier setters in the same spec left it, so upserting a family cell and then a career cell into
  `Cells` keeps both, and a second upsert of the same key wins. The same holds on the EF Core,
  Dapper and in-memory replay paths.
- **Serialized once, as the writer serializes it.** The element is built in C#, once per event, and
  stored exactly as the model's own writer would store it, so the rendered copy cannot drift in
  shape from one a normal apply produces.
- **Keys compare as stored JSON,** so a string, number or identifier key works without a cast.
- **In a jsonb column too.** When the array is a `[PhysicalField(ColumnType = "jsonb")]`, the element is
  upserted in the column by the same rules (see [Physical columns](#physical-columns)).
- **Direct members only.** The array must be a top-level property and the key a direct property of
  the element; anything else throws `NotSupportedException`.
- **Both drivers, and replay.** EF Core and Dapper share one SQL expression, and replay applies the
  same rule in memory, so a rebuilt read model matches the live one.

### Physical columns {#physical-columns}

{verified: CollectivePhysicalColumnIntegrationTests.Apply_EnumSetter_WritesTheUnderlyingNumberToTheColumnAsync, CollectivePhysicalColumnIntegrationTests.Apply_WhereOnAnEnumPhysicalField_ComparesTheNumberAsync, CollectivePhysicalColumnIntegrationTests.Apply_VectorSetter_WritesTheVectorColumnAsync, CollectivePhysicalColumnIntegrationTests.Apply_UpsertElementOnAPhysicalJsonbArray_UpsertsInTheColumnAsync, CollectivePhysicalColumnIntegrationTests.Replay_MatchesLive_ForEnumVectorAndKeyedArrayAsync, DapperCollectivePhysicalColumnIntegrationTests.Apply_EnumSetterAndPredicate_UseTheUnderlyingNumberAsync, DapperCollectivePhysicalColumnIntegrationTests.Apply_VectorSetter_WritesTheVectorColumnAsync, DapperCollectivePhysicalColumnIntegrationTests.Apply_UpsertElementOnAPhysicalJsonbArray_UpsertsInTheColumnAsync, DapperCollectivePhysicalColumnIntegrationTests.Replay_MatchesLive_ForEnumVectorAndKeyedArrayAsync, CollectivePhysicalColumnIntegrationTests.Apply_PhysicalOnlySetter_UpdatesTheColumn_AndLeavesDataByteIdenticalAsync, CollectivePhysicalColumnIntegrationTests.Apply_SetterKeptInBothPlaces_UpdatesTheColumnAndTheDocumentAsync, CollectivePhysicalColumnIntegrationTests.Apply_MixedSetters_UpdateTheColumnAndTheDocument_InOneStatementAsync, CollectivePhysicalColumnIntegrationTests.Apply_WhereOnAPhysicalField_FiltersOnTheColumnAsync, CollectivePhysicalColumnIntegrationTests.Replay_MatchesLive_ForColumnAndDocumentAsync, DapperCollectivePhysicalColumnIntegrationTests.Apply_PhysicalOnlySetter_UpdatesTheColumn_AndLeavesDataByteIdenticalAsync, DapperCollectivePhysicalColumnIntegrationTests.Apply_MixedSetters_UpdateTheColumnAndTheDocument_InOneStatementAsync}

A property marked [`[PhysicalField]`](../perspectives/physical-fields.md) is a real column. A
collective setter that targets one writes the column, as a typed parameter, in the same `UPDATE` as
every other setter. Whether the document is written too depends on the model's
[storage mode](../perspectives/physical-fields.md#FieldStorageMode):

| Storage mode | The column | The document path in `data` |
|---|---|---|
| `Extracted` (and `JsonOnly` with a `[PhysicalField]`) | written | written, with the same value |
| `Split` | written | left alone: the field lives only in the column |

A collective whose setters touch only physical-only (`Split`) fields does not assign `data` at all.
Postgres writes a complete new copy of a jsonb value whenever it changes, including its TOAST
storage and every index entry over the document, so on a table of large documents that copy is most
of the cost of a bulk update. Leaving `data` out of the `SET` leaves the document, its TOAST and its
GIN index untouched, and when no index covers the changed columns the update can be a HOT update.

```csharp{title="A collective that changes only physical columns" description="Lane and Priority are physical-only columns on a Split model, so the collective writes two columns and never rewrites the jsonb document" category="Messaging" difficulty="INTERMEDIATE" tags=["Collective Events", "Perspectives", "Physical Fields", "Performance"] tests=["CollectivePhysicalColumnIntegrationTests.Apply_PhysicalOnlySetter_UpdatesTheColumn_AndLeavesDataByteIdenticalAsync"]}
[PerspectiveStorage(FieldStorageMode.Split)]
public sealed class TicketModel {
  [PhysicalField] public string Lane { get; set; } = "";
  [PhysicalField] public int Priority { get; set; }
  public string Title { get; set; } = "";      // document only
}

[CollectiveApplyFor]
public ICollectiveSpec<TicketModel> Reroute(TicketsReroutedCollectiveEvent e) =>
  new CollectiveSpec<TicketModel>(
    Setters: s => s
      .SetProperty(t => t.Lane, e.ToLane)
      .SetProperty(t => t.Priority, e.Priority),
    Where: r => r.Data.Lane == e.FromLane);
// UPDATE wh_per_ticket SET "lane" = @…, "priority" = @…, updated_at = @…, version = version + 1
//  WHERE id = ANY(@ids)          -- no "data =" in the statement
```

- **Mixed setters are one statement.** A spec that sets a physical field and a document field writes
  the column and the `jsonb_set` chain in the same `UPDATE`.
- **The `Where` reads the column.** A condition on a physical property (`r.Data.Lane == value`,
  `values.Contains(r.Data.Lane)`) compiles to the column, compared against a typed parameter, so an
  index declared on the column serves it. Conditions on document fields keep compiling to
  `data->>'X'`.
- **Computed comparisons read the column too.** `SetProperty(t => t.IsUrgent, t => t.Lane == "hot")`
  compares the `lane` column, null-safely (`IS NOT DISTINCT FROM`), so the result matches the C#
  comparison the in-memory replay makes.
- **Replay matches live.** Replay applies the same setters to the in-memory model, and the
  perspective runner writes the model's physical fields to their columns (and, outside `Split`, to
  the document) exactly as it does after any event. A rebuilt row has the same columns and the same
  document as one the live `UPDATE` produced.
- **No reflection.** Which properties are columns, their names, their storage mode, an enum's scalar
  type and a declared column type come from the
  perspective runner the source generator emits: it registers them at module load in
  `PerspectivePhysicalFieldRegistry`, and both drivers read that. A model with no perspective has no
  registration, and its setters stay document writes.
- **Enumerations are stored as numbers.** An enum column holds the enum's underlying number, and a
  setter, a `Where` condition and a computed comparison all bind that number, the same scalar the
  per-event write stores (see [Physical Fields](../perspectives/physical-fields.md#enum-columns)).
- **Vectors.** A setter on a `[VectorField]` writes the vector column in the same `UPDATE`, in the
  form the per-event write uses (a pgvector parameter on EF Core, the vector's text form on
  Dapper). A vector cannot be compared: a `Where` condition or computed comparison on one throws
  `NotSupportedException`.
- **Keyed arrays in a jsonb column.** `UpsertElement` on an array declared with
  `[PhysicalField(ColumnType = "jsonb")]` upserts the element in the column, in the same statement
  and with the same rules as a document array: replace where it stands or append, several upserts
  on one list compose in call order, and the document array is upserted too outside `Split`. Any
  other column type holds no keyed elements, so `UpsertElement` on it throws
  `NotSupportedException`.
- **An enumeration in a column whose type you declared** (`ColumnType = "text"`, say) throws
  `NotSupportedException`: its stored form is then your choice, which a collective cannot know.

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
tests: ["CollectiveWhereComposerTests.Framework_WithHandlerWhere_AndsScopeAndHandlerAsync", "CollectiveWhereComposerTests.Custom_WithHandlerWhere_StillAndsScopeAsync", "CollectiveSpecContractTests.CollectiveApplyForAttribute_AcceptsExplicitScopeHandlingCustomAsync"]
}
// Refine WITHIN the tenant envelope — only orders with no overlay, in the
// event's tenant. Framework mode ANDs the scope filter and this Where:
[CollectiveApplyFor]                                    // ScopeHandling = Framework (default)
public ICollectiveSpec<OrderModel> ApplyTemplate(TemplateAppliedCollectiveEvent e) =>
  new CollectiveSpec<OrderModel>(
    Setters: s => s.SetProperty(j => j.TemplateId, e.TemplateId),
    Where:   r => r.Data.OverlayId == null);

// Own the cohort predicate on the handler's own columns — the resolver
// scope is STILL AND-ed in (tenant safety), even under Custom:
[CollectiveApplyFor(ScopeHandling = CollectiveScopeHandling.Custom)]
public ICollectiveSpec<OrderModel> ClearOverlay(OverlayClearedCollectiveEvent e) =>
  new CollectiveSpec<OrderModel>(
    Setters: s => s.SetProperty(j => j.OverlayId, (Guid?)null),
    Where:   r => r.Data.OverlayId == e.OverlayId);
```

### Ordering comparisons in `Where` {#ordering-comparisons}

A `Where` can compare with `<`, `<=`, `>` and `>=` as well as `==`, `!=` and
`Contains`, over a **numeric, enumeration or temporal** member (`DateTime`,
`DateTimeOffset`, `DateOnly`, `TimeOnly`, `TimeSpan`), on a document path or on a
[physical column](#physical-columns). The natural use is a monotonic guard that keeps a
stale collective from overwriting a newer one:

```csharp{
title: "A monotonic guard in a collective Where"
description: "Only rows whose recorded ordinal is older than the event's are flipped; a missing key counts as 0 through ??."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["collective-events", "where", "ordering", "guard"]
tests: ["DapperCollectiveOrderingIntegrationTests.Ordering_Coalesced_CountsTheMissingKeyAsTheDefaultAsync", "CollectiveOrderingIntegrationTests.Ordering_Coalesced_CountsTheMissingKeyAsTheDefaultAsync"]
}
[CollectiveApplyFor]
public ICollectiveSpec<OrderModel> Activate(ActivationCollectiveEvent e) =>
  new CollectiveSpec<OrderModel>(
    Setters: s => s.SetProperty(o => o.ActiveOrdinal, e.Ordinal),
    Where:   r => (r.Data.ActiveOrdinal ?? 0) < e.Ordinal);   // long? ActiveOrdinal
```

How the comparison is made, and why:

- **A document member is compared as a number**, `(data->>'X')::numeric`. `->>` is text,
  and text orders `'10'` before `'9'`.
- **A temporal member is compared as its stored microsecond count** (the
  [stored form](../perspectives/jsonb-containment.md) of every date, time and duration), so
  the event's value is bound as the same count and the comparison is exact to the
  microsecond. A key still holding an old rendering makes PostgreSQL refuse the statement
  rather than answer it wrongly.
- **A physical column is compared as itself**, the value bound as the scalar the column
  stores (a `DateTimeOffset` at offset zero, which is all `timestamptz` accepts).
- **A missing key, or a JSON `null`, compares as null**: the comparison is false, exactly as a
  lifted C# comparison with a null operand is false. Under `!` it stays that way: the
  compiler makes the comparison false before negating it
  (`NOT (COALESCE(a < b, FALSE))`), so `!(r.Data.X < 5)` selects a row with a missing key in
  SQL just as the in-memory replay does. Outside a `!` the plain comparison is emitted, so an
  index over the expression can serve it.
- **To have a missing key count as a value**, declare the member nullable and coalesce it:
  `(r.Data.X ?? 0) < e.Y` compiles to `COALESCE((data->>'X')::numeric, @p) < @q`. That is
  how a guard covers rows written before the member existed, with no pre-apply step to write
  a zero into them.

Refused, with the reason: ordering the row id (PostgreSQL orders a `uuid` by its bytes and
.NET orders a `Guid` by its fields, so the SQL apply and the replay would disagree), a member
that is neither numeric nor temporal, and a document temporal against a physical one (a
microsecond count against a timestamp).

The live apply and the in-memory replay select the same rows; both drivers are held to it by
tests that apply live and replay against the same rows, including the text-ordering trap,
a JSON null and a missing key with and without `!` and `??`.

### Cross-perspective cohorts (`ICollectiveQuery`)

A `Where` over `row.Data` only sees the table being mutated. When the
cohort is defined by a field on a **sibling** read model — e.g.
the order service's `OrderModel` carries no status (it lives on the sibling
`OrderStatusModel`, keyed by the same id) — the handler's `Apply`
receives an **`ICollectiveQuery`** and reaches the sibling through it:

```csharp{
title: "Reach a sibling read model in the cohort with ICollectiveQuery"
description: "q.Of<TOther>() returns a queryable over a sibling perspective's rows; a correlated .Any(...) translates to a correlated EXISTS in the same single UPDATE on both drivers."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["collective-events", "collective-query", "sibling", "exists", "cohort"]
tests: ["CollectiveDispatcherEFCoreIntegrationTests.DispatchAsync_CrossPerspectiveCohort_ScopesBySiblingTableAsync", "DapperCollectiveApplierIntegrationTests.ApplyAsync_CrossPerspectiveCohort_ScopesBySiblingTableAsync"]
}
[CollectiveApplyFor]                                  // Framework: tenant envelope AND this cohort
public ICollectiveSpec<OrderModel> ApplyTemplate(TemplateAppliedCollectiveEvent e, ICollectiveQuery q) =>
  new CollectiveSpec<OrderModel>(
    Setters: s => s.SetProperty(j => j.TemplateId, e.TemplateId),
    Where:   r => q.Of<OrderStatusModel>()
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
plus equality, ordering and `Contains` leaf predicates over the sibling's
`Data`/`Scope`. Richer shapes (disjunctions, nested `EXISTS`) throw a
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
**Discriminator contract correction (verified against library commits `f2657adc` and `1b31f58d`)**: the generator does **not** honor custom `TypeDiscriminatorPropertyName` (e.g. `$scopeKind`) or custom `[JsonDerivedType]` strings (e.g. `"tenant"`). Generated serialization always uses **`$type`** with **simple type names** (`"TenantCollectiveScope"`); the attributes act as discovery markers only. Wire payloads and any consumers must expect the `$type`/type-name form, or typed readback returns zero events.
:::

### `TenantCollectiveScope`

```csharp{
title: "Emit a collective event scoped by TenantCollectiveScope"
description: "TenantCollectiveScopeResolver auto-registers by ScopeKind 'tenant' and composes a row.Scope.TenantId == tenantId predicate for the single scope-wide UPDATE."
framework: "NET10"
category: "Messaging"
difficulty: "BEGINNER"
tags: ["collective-events", "tenant-scope", "collective-scope", "publish", "scope-resolver"]
tests: ["TenantCollectiveScopeResolverTests.TenantCollectiveScope_ScopeKind_IsTenantAsync", "TenantCollectiveScopeResolverTests.TenantCollectiveScope_CarriesTenantIdAsync", "TenantCollectiveScopeResolverTests.ScopeFilter_CompiledExpression_MatchesRowsByTenantIdAsync"]
}
var evt = new ArchiveOrdersCollectiveEvent {
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
unverified: "Reproduces the library EventFlags enum; its Collective and Composite bit values are exercised by EventFlagsTransportTests, which is not among this page's testReferences."
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

```mermaid{title="Collective-event apply pipeline from producer to projection UPDATE" description="A collective event flows through outbox, transport, and inbox; the event-store chain routes it to the fixed __collective__ sink, and the perspective worker dispatches it once through the collective dispatcher into a single scope-filtered SQL UPDATE." caption="End-to-end collective-event pipeline: producer to outbox to transport to event store, routed to the fixed __collective__ sink and dispatched once into a single scope-filtered SQL UPDATE"}
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

### Rows that also receive per-stream events

A collective's `UPDATE` and a per-stream apply can write the same row at
the same time: an activation flip across a family
(`IsActive = Id == activated`) runs while the activated member's own event
is being applied to that member's row. The per-stream apply reads the
whole row, folds its event in memory and writes the whole row back, so a
collective that commits between that read and that write used to be
**overwritten silently** by the stale copy, leaving the family with no
active member.

**The guarantee: a collective's committed change is never overwritten by a
per-stream write computed before it.** The per-stream write lands only on
the row version it read; when the collective moved the row in between, the
write is refused, and the per-stream apply re-reads the row, re-applies its
event onto the collective's result and writes again. The final row reflects
both. Neither side has to be ordered or timed against the other, and a
mirror perspective in another service is covered the same way.

Nothing is required of the collective. The version is the PostgreSQL row's
`xmin`, which every `UPDATE` moves on its own, so a collective whose apply
hooks skip or override the `version` bump is still seen. The details, and
what happens when a row keeps changing, are under
[Concurrent writers](../perspectives/perspectives.md#concurrent-writers).
The guard covers the EF Core PostgreSQL perspective store; the Dapper store
does not check versions yet.

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
- **A bounded lock wait that keeps its lease.** A batch waits at most
  `LockWaitSeconds` (default **30**) for the lock. When a wait ends without it,
  the batch reports progress through the same callback the worker renews the work
  lease from, and waits again, up to `LockWaitRenewals` more times (default **5**,
  about three minutes in all; `0` gives up after one wait). The lease outlives the
  wait, so the work is not leased again underneath it and its attempt count does
  not rise. When every wait is used up the batch gives up with a
  `CollectiveApplyLockBusyException` naming the table and the total wait.
- **Busy is not failed.** The worker treats that exception as busy: it reports no
  failure (the failure count is what drives dead-lettering) and completes nothing,
  so the collective is applied later. `PerspectiveWorkerOptions.CollectiveLockBusyCountsAsFailure = true`
  restores the older accounting, a busy lock reported like a failed apply.
- **An advisory lock has no queue.** PostgreSQL wakes its waiters in no guaranteed
  order, so a batch that waits has no place in line to keep: a later collective on the
  same table and scope can take the lock first. Collectives whose order matters carry
  an [ordering key](#ordering-key); those wait in their key's queue, which a busy lock
  cannot reorder.
- **Store-managed columns.** The `UPDATE` also stamps `updated_at` and
  bumps `version` (a collective `UPDATE` writing only `data` would leave
  them stale and break change-detection). The per-stream lost-update guard
  does not depend on that bump (see
  [Rows that also receive per-stream events](#rows-that-also-receive-per-stream-events)).

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
unverified: "Consumer DI-wiring illustration; the AddCollectiveEventsEFCore and AddCollectiveExecutorEFCore extension methods are not exercised by a candidate test (EFCoreServiceRegistrationGeneratorTests covers generator-emitted registration and schema, not these calls)."
}
services
  // entries = your assembly's generated Whizbang.Core.Generated.CollectiveApplyRegistry.Entries
  // (the framework assembly's own copy is empty). Required — no parameterless overload.
  .AddCollectiveEventsEFCore<MyPerspectiveDbContext>(CollectiveApplyRegistry.Entries) // dispatcher + resolver + session + replay applier
  .AddCollectiveExecutorEFCore<OrderModel>();                                         // one per model with a [CollectiveApplyFor]
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
**or a data** field (`row.Data.Prop == value` → `data->>'Prop'`, or the
column itself when `Prop` is a `[PhysicalField]`);
`&&`-chains mixing both; `Contains` (→ `IN`); ordering comparisons over numeric and
temporal members (see [Ordering comparisons](#ordering-comparisons)); and
`q.Of<TOther>().Any(...)` cross-perspective cohorts (→ a correlated
`EXISTS`). It throws for richer predicates (disjunctions,
arbitrary top-level columns, nested `EXISTS`).

For SET clauses, both compilers support scalar top-level
`SetProperty(j => j.Prop, constant)` with constant/captured-value
sources, chained setters, and the property-vs-constant `==`/`!=` computed
comparison. A setter or a condition on a `[PhysicalField]` property
targets its column (see [Physical columns](#physical-columns)). Arithmetic-computed setters and nested paths throw
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
library repo. It shows a tiny `OrderModel`, a consumer-owned
`CollectiveSpec<TModel>` record, a perspective with `[CollectiveApplyFor]`
handlers (including a per-model `Where` that refines onto the model's own
columns), and the DI registration. It compiles standalone as a
demonstration of the authoring surface.
