---
title: "PinnedId Attribute"
version: 1.0.0
category: Attributes
order: 20
description: >-
  Declares a stable, namespace-proof identifier for a concrete message or
  perspective type so stored events survive namespace restructuring.
tags: "attributes, pinned-id, stable-identity, namespaces, event-sourcing, source-generator, aot"
codeReferences:
  - src/Whizbang.Core/Attributes/PinnedIdAttribute.cs
  - src/Whizbang.Core/IPinnedIdRegistry.cs
  - src/Whizbang.Generators/PinnedIdRegistryGenerator.cs
---

# PinnedId Attribute

The `[PinnedId]` attribute declares a stable, GUID-based identity for a concrete message or perspective type. Pinned IDs decouple type identity from CLR namespaces so that stored events can survive namespace restructuring without custom data migrations being required at runtime.

## Namespace

```csharp
using Whizbang.Core.Attributes;
```

## Syntax

```csharp
[PinnedId("a1b2c3d4-e5f6-7890-abcd-1234567890ab")]
public sealed record OrderPlacedEvent(Guid OrderId) : IEvent;
```

## Applies To

- Concrete types implementing `IMessage` (events + commands, via `IEvent` / `ICommand`).
- Concrete types implementing `IPerspectiveFor<>`.
- Records, record structs, classes, structs.

Abstract base classes and interfaces are skipped. Pinned identity is per concrete type — the attribute is `Inherited = false`.

## Why

Whizbang stores CLR type names (for example `MyApp.Orders.OrderPlacedEvent, MyApp.Contracts`) in the event store, outbox, inbox, message association, and perspective registry tables. A namespace rename would make old rows unresolvable. `[PinnedId]` records a stable identity per concrete type so the registry can detect renames and the rename migration tool can rewrite stored CLR names to the new name.

Stored `event_type` columns are **not** changed to GUIDs — the pinned ID lives in the type registry as metadata. The rename tool uses it to detect drift.

## Analyzer Behavior

- **WHIZ100 (Warning)** — Concrete `IMessage` without `[PinnedId]`.
- **WHIZ101 (Warning)** — Concrete `IPerspectiveFor<>` without `[PinnedId]`.
- **WHIZ102 (Error)** — `[PinnedId]` value is not a valid GUID.

The companion code-fix inserts `[PinnedId("<new-guid>")]` with a freshly generated `Guid.NewGuid()`. Apply "Fix all in solution" after upgrading to tag an existing codebase in one pass. Generate once — pinned IDs are forever.

## Source Generator

`PinnedIdRegistryGenerator` discovers every type carrying `[PinnedId]` at compile time and emits `GeneratedPinnedIdRegistry : IPinnedIdRegistry`. The generated registry uses a `typeof()` comparison chain — **zero reflection, AOT-safe**.

Register in your DI container with the generated extension method:

```csharp
services.AddPinnedIdRegistry();
```

Consume via `IPinnedIdRegistry`:

```csharp
public sealed class SomeService(IPinnedIdRegistry pinnedIds) {
  public string? LookupPinnedId(Type messageType) => pinnedIds.GetPinnedId(messageType);
}
```

## Migration Path

1. Upgrade to the Whizbang version shipping `[PinnedId]`.
2. Apply the code-fix across the solution ("Fix all in solution" on WHIZ100 and WHIZ101).
3. Commit the generated GUIDs as one changeset so they are reviewable.
4. If a namespace is later renamed, run the rename tool (`IEventTypeRenameTool.ExecuteAsync`) to rewrite stored CLR names in the six data tables.

Without the rename tool, stored rows using the old CLR name are unresolvable — there is no runtime alias fallback by design.

## Related

- :::new PinnedIdRegistryGenerator — source generator that discovers `[PinnedId]` types.
- :::new `wh_message_type_registry` — universal type registry storing pinned IDs as metadata.
- :::new `IEventTypeRenameTool` — migration tool that detects pinned-id drift and rewrites stored CLR names.

## See Also

- [Pinned Identity core concept](../core-concepts/pinned-identity.md)
