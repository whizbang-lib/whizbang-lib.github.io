---
title: "Pinned Identity"
version: 1.0.0
category: Core Concepts
order: 30
description: >-
  Stable, namespace-proof identity for stored messages and perspectives via
  [PinnedId] + a universal type registry.
tags: "core-concepts, pinned-identity, stable-identity, namespaces, event-sourcing, migrations, aot"
codeReferences:
  - src/Whizbang.Core/Attributes/PinnedIdAttribute.cs
  - src/Whizbang.Core/IPinnedIdRegistry.cs
  - src/Whizbang.Generators/PinnedIdRegistryGenerator.cs
  - src/Whizbang.Data.Schema/Schemas/MessageTypeRegistrySchema.cs
  - src/Whizbang.Core/Migrations/IEventTypeRenameTool.cs
---

# Pinned Identity

Whizbang stores CLR type names (for example `MyApp.Orders.OrderPlacedEvent, MyApp.Contracts`) inside the event store, outbox, inbox, message associations, and perspective registry tables. Renaming a namespace would make old rows unresolvable. **Pinned Identity** is a namespace-proof identity system that lets you reorganize code without breaking stored data.

## The Problem

Domain-driven design encourages restructuring type namespaces over time — moving an `OrderPlacedEvent` from `MyApp.Orders` to `MyApp.Fulfillment.Orders`, for example. Without pinning, Whizbang would fail to resolve old events after the rename because stored rows reference the old CLR name.

## The Approach

Three complementary pieces:

1. **`[PinnedId]`** — A single attribute that declares a stable GUID per concrete type. Covers both `IMessage` and `IPerspectiveFor<>` targets.
2. **Universal type registry** — The `wh_message_type_registry` table records every registered type (pinned or not). The pinned ID lives there as metadata.
3. **Rename migration tool** — Detects pinned-id drift by comparing the registry's stored CLR name to the current code's CLR name for the same pinned ID. Rewrites stored CLR names across the six data tables in a single transaction.

**Storage format is unchanged.** `event_type` columns continue to hold CLR type names. The pinned ID is registry metadata — it does not appear in stored data rows. When a namespace is renamed, the rename tool is run to rewrite stored CLR names to the new name. There is no runtime alias fallback.

## Universal Type Registry

Schema for `wh_message_type_registry`:

| Column | Type | Notes |
|---|---|---|
| `type_id` | UUID, PK, `DEFAULT gen_random_uuid()` | Database-assigned, one per registered type |
| `clr_type_name` | VARCHAR(500), UNIQUE | Current CLR type name (the same format stored in `event_type`) |
| `pinned_id` | UUID, NULL | From `[PinnedId]`; null if not pinned |
| `kind` | VARCHAR(50) | `"event"`, `"command"`, `"perspective"` |
| `updated_at` | TIMESTAMPTZ | Last upsert |

A **partial unique index** on `pinned_id WHERE pinned_id IS NOT NULL` enforces that no two types can share a pinned ID while allowing many unpinned rows.

## Discovery via Source Generator

`PinnedIdRegistryGenerator` discovers `[PinnedId]` attributes at compile time and emits a zero-reflection, AOT-safe `IPinnedIdRegistry` implementation. No runtime reflection is required.

```csharp
// Your code
[PinnedId("a1b2c3d4-e5f6-7890-abcd-1234567890ab")]
public sealed record OrderPlacedEvent(Guid OrderId) : IEvent;

// Generated (AOT-safe, typeof() comparison chain)
public sealed class GeneratedPinnedIdRegistry : IPinnedIdRegistry {
  public string? GetPinnedId(Type type) {
    if (type == typeof(OrderPlacedEvent)) return "a1b2c3d4-e5f6-7890-abcd-1234567890ab";
    // ... one branch per pinned type
    return null;
  }
}
```

Register with:

```csharp
services.AddPinnedIdRegistry();
```

## Rename Workflow

When a namespace is renamed:

1. Make the code change — the type's CLR name is now different. The `[PinnedId]` stays the same.
2. Deploy. On startup, the registry populator notices that the registry row for this pinned ID has a different `clr_type_name` than the current code. It logs a warning and **does not** overwrite the row.
3. Run the rename tool. It detects the drift, builds a `PendingRename` list, and in a single transaction:
   - `UPDATE` the six data tables to rewrite the old CLR name to the new one.
   - `UPDATE` the registry row's `clr_type_name` to the new name.
4. Subsequent startups see the registry and code in sync; no warning.

Skipping the rename tool leaves stored rows unresolvable. This is deliberate — renames are a controlled operation, not an automatic one.

## Adoption

`[PinnedId]` is optional and opt-in. The analyzer raises a **warning** (not an error) so adoption can happen gradually:

- **WHIZ100 (Warning)** — Concrete `IMessage` without `[PinnedId]`.
- **WHIZ101 (Warning)** — Concrete `IPerspectiveFor<>` without `[PinnedId]`.
- **WHIZ102 (Error)** — `[PinnedId]` value is not a valid GUID.

A code fix on WHIZ100/WHIZ101 inserts `[PinnedId("<new-guid>")]`. Use "Fix all in solution" after upgrading to tag an existing codebase in one pass. After that, the GUIDs are frozen forever.

## Affected Tables

Six tables store CLR type names and participate in the rename workflow:

| Table | Column(s) |
|---|---|
| `wh_event_store` | `event_type`, `aggregate_type` |
| `wh_inbox` | `message_type` |
| `wh_outbox` | `message_type`, `envelope_type` |
| `wh_message_associations` | `message_type` |
| `wh_perspective_registry` | `clr_type_name` |
| `wh_message_type_registry` | `clr_type_name` |

## See Also

- [PinnedId Attribute](../attributes/pinned-id.md)
