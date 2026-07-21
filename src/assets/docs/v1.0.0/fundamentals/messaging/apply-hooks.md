---
title: Apply Hooks
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
order: 8
codeReferences:
  - src/Whizbang.Core/Perspectives/Hooks/IApplyHook.cs
  - src/Whizbang.Core/Perspectives/Hooks/IApplyHookBuilder.cs
  - src/Whizbang.Core/Perspectives/Hooks/ApplyHookContext.cs
  - src/Whizbang.Core/Perspectives/Hooks/ApplyHookOp.cs
  - src/Whizbang.Core/Perspectives/Hooks/WhizbangApplyHookKeys.cs
  - src/Whizbang.Core/Perspectives/Hooks/ApplyHookRegistry.cs
  - src/Whizbang.Core/Perspectives/Hooks/TimestampsApplyHook.cs
  - src/Whizbang.Core/Perspectives/Hooks/WhizbangApplyHooks.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveApplyHookPlanner.cs
  - src/Whizbang.Data.Postgres/PerEventApplyHooks.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/Hooks/ApplyHookRegistryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerEventApplyHooksTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveDispatcherEFCoreIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperCollectiveApplierIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/DapperPostgresPerspectiveStoreTests.cs
---

# Apply hooks

Pluggable logic that modifies **what a perspective's `Apply` produced**, gated by the
model's type. There are two hooks over two apply paths, with a deliberately **identical
surface** — so one hook body can run on both:

| | Collective path | Per-event path |
|---|---|---|
| What it mutates | the set-based SQL `UPDATE` (a whole cohort) | the loaded row instance (one row) |
| Interface | `ICollectiveApplyHook<TMarker>` | `IApplyHook<TMarker>` |
| Registry | `CollectiveApplyHookRegistry` | `ApplyHookRegistry` (via `PerEventApplyHooks.Registry`) |
| Extra verbs | `AndWhere` / `ReplaceWhere` (cohort predicate) | — (single row) |

A collective apply is a set-based SQL `UPDATE` that bypasses all per-event apply
extensibility. Bringing `updated_at`/`version` stamping to the collective path exposed the
need for a general seam — so the stamping itself is now the overridable
**`whizbang.timestamps` default hook**, present on both paths.

## Marker-gated matching

A hook is registered against a type `TMarker` — a **concrete class, a base class, or an
interface**. It fires for a model `TModel` when `TModel` is assignable to `TMarker`
(`typeof(TMarker).IsAssignableFrom(typeof(TModel))`). So `IAuditable`, a base perspective
class, or a concrete model all work. `object` matches every model — the default-hook marker.

- **Multiple registrations accumulate.** Matching hooks fire in **registration order** —
  not by marker specificity.
- **Optional `key` = override-in-place.** Registering a `key` that already exists
  **replaces** the hook at that key's slot (keeping its order position); a new key or an
  unkeyed registration appends. The key is **global** — one slot per key across all markers.
- **Documented default key.** Override a default by re-registering its key:
  `WhizbangApplyHookKeys.TIMESTAMPS = "whizbang.timestamps"`.
- **AOT.** The matching hook list is resolved per `TModel` **once** and memoized; the apply
  hot path does no `IsAssignableFrom`. Hooks record a declarative op list (no reflection);
  only a per-event `SetProperty` compiles a cached setter from compile-time selector metadata.

## Builder vocabulary

A hook records verbs through its builder; each path interprets the same op list for its own
mechanics:

- `SetProperty(m => m.Prop, value)` — a model data field. Collective → an extra `jsonb_set`;
  per-event → `row.Data.Prop = value`.
- `SetColumn(column, value)` — a physical store column. Collective → `"column" = @param`
  (any column); per-event → the matching `PerspectiveRow` property (**`updated_at` only** —
  arbitrary physical columns are collective-only).
- `BumpVersion()` — `version = version + 1` (collective) / `row.Version++` (per-event).
- `RemoveSetter(m => m.Prop)` — drop a model-field setter an earlier stage added.
  Collective-focused; a no-op on the per-event path.
- `AndWhere(m => …)` / `ReplaceWhere(m => …)` — **collective only.** Refine or replace the
  cohort `WHERE`. The mandatory tenant scope envelope is still AND-ed on top, so a hook can
  reshape the cohort but never escapes its scope.

`ApplyHookContext` carries `ModelType`, the `Event`/`Scope` where available, and one
`ApplyTimestamp` per apply (shared across every keyset batch of a collective event).

## The `whizbang.timestamps` default hook

Registered against `object` under `WhizbangApplyHookKeys.TIMESTAMPS` on both paths:

```csharp{title="whizbang.timestamps default hook" description="The built-in default hook body: stamp updated_at from the apply timestamp and bump the row version." category="Messaging" difficulty="INTERMEDIATE" tags=["Messaging", "Apply Hooks", "Timestamps", "Perspectives"] tests=["ApplyHookRegistryTests.ApplyTimestamp_ReachesTheHookAsync", "ApplyHookRegistryTests.PerEventRegistry_DefaultTimestampsHook_StampsAndBumpsAsync", "PerEventApplyHooksTests.DefaultTimestampsHook_YieldsUpdatedAtAndBumpAsync"]}
builder.SetColumn(ApplyHookColumns.UPDATED_AT, ctx.ApplyTimestamp).BumpVersion();
```

It formalizes the store-managed stamping both paths always did (a collective `UPDATE` that
wrote only `data` left `updated_at`/`version` stale, breaking change-detection). Now it is
**overridable**: re-register a hook with the same key to change or suppress it.

## Registering hooks

**Collective** — DI seeds a `CollectiveApplyHookRegistry` with the defaults (`TryAdd`, so you
can register your own first) and injects it into the collective executors:

```csharp{title="Register collective apply hooks" description="Seed the collective hook registry with the framework defaults, then add custom hooks and override the default stamp by key." category="Messaging" difficulty="INTERMEDIATE" tags=["Messaging", "Apply Hooks", "Collective", "Dependency Injection"] unverified="Consumer DI wiring with illustrative hook types StampLastTouchedByHook and MyStamps; CreateCollectiveWithDefaults and the AddSingleton seeding are not exercised by the mapped unit tests, which use a direct CollectiveApplyHookRegistry."}
services.AddSingleton(_ =>
  WhizbangApplyHooks.CreateCollectiveWithDefaults()
    .Register<IAuditable>(new StampLastTouchedByHook())                    // every IAuditable model
    .Register<object>(new MyStamps(), WhizbangApplyHookKeys.TIMESTAMPS));  // override the default stamp
```

**Per-event** — a process-wide static (mirroring
`BaseUpsertStrategy.PathOnePersistenceOptionsProvider`), so the default applies everywhere with
zero wiring. Register custom hooks at startup:

```csharp{title="Register per-event apply hooks" description="Replace the process-wide per-event registry with one seeded from the framework defaults plus a custom hook, at startup." category="Messaging" difficulty="INTERMEDIATE" tags=["Messaging", "Apply Hooks", "Per-Event", "Perspectives"] unverified="Consumer startup wiring that assigns the process-wide PerEventApplyHooks.Registry static using the illustrative hook StampLastTouchedByHook; the mapped PerEventApplyHooksTests deliberately use the explicit-registry Resolve overload and never assign the static."}
PerEventApplyHooks.Registry = WhizbangApplyHooks.CreatePerEventWithDefaults()
  .Register<IAuditable>(new StampLastTouchedByHook());
```

## Both-driver parity

The collective path renders the resolved hook plan into one set-based `UPDATE` on **both** EF
Core (`EFCoreCollectiveAdapter`) and Dapper (`DapperCollectiveEventApplier`) — model-field
setters as `jsonb_set`, store columns as `"col" = @param`, `BumpVersion` as
`version = version + 1`, and the composed cohort `WHERE`. The per-event path applies the plan
at all three write sites — EF Core's atomic `INSERT … ON CONFLICT` upsert and its legacy
SELECT-then-update object path, and the Dapper perspective store — with `SetProperty` mutating
the model object before serialization and `updated_at`/version driven by the plan.

## Related

- [Collective events](collective-events.md) — the set-based `UPDATE` the collective hooks
  operate on; its `updated_at`/`version` stamping is the `whizbang.timestamps` default hook.
