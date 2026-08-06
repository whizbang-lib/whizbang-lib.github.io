---
title: Type-Name Forms
pageType: concept
verifiedAgainstCommit: c973240c
verifiedDate: 2026-08-06
version: 1.0.0
category: Architecture
order: 5
description: >-
  Whizbang identifies types by string in two canonical forms — the
  assembly-qualified wire form and the no-assembly CLR-identity form. Each
  storage column and lookup speaks exactly one of them. This page maps which
  form goes where, so extensions never hand one form to a lookup that stores
  the other.
tags: >-
  architecture, type-names, wire-form, clr-type-name, event-type,
  normalization, extensibility, source-generators
codeReferences:
  - src/Whizbang.Core/TypeNameFormatter.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameUtilities.cs
  - src/Whizbang.Core/Workers/IntegrityAuditWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
---

# Type-Name Forms

Whizbang stores and routes messages by **string type names**, and there are exactly two
canonical forms. Every column, registry, and lookup in the framework speaks **one** of them.
Both are produced by one runtime type — `TypeNameFormatter` — with a generator-side mirror
(`TypeNameUtilities`) that emits the same strings at compile time, so each form has a single
place where its shape is decided.

The forms exist because they serve different masters:

| Form | Producer | Example | Job |
|---|---|---|---|
| **Wire / lookup** | `TypeNameFormatter.Format(type)` | `MyApp.OrderContracts+OrderPlaced, MyApp.Contracts` | Message routing and storage matching — what `event_type` columns store |
| **CLR identity** | `TypeNameFormatter.FormatClrTypeName(type)` | `MyApp.OrderContracts+OrderPlaced` | Rename-stable type identity — what `clr_type_name` columns store |

The wire form carries the assembly because a message crosses process boundaries and must be
resolvable on the far side. The CLR-identity form deliberately omits it so rename tooling
(`IEventTypeRenameTool`) can match a type across assembly moves.

## Which form goes where

**Wire form (`Format`)** — anything matched against a stored `event_type`:

- `wh_event_store.event_type`, `wh_inbox`/`wh_outbox` message types
- `wh_stream_digests.event_type` and every stream-integrity request
  (`RequestIntegrityManifest.EventTypes`, `RequestRedeliveryCommand.EventTypes`,
  checkpoint buckets)
- Transport subscription filters and envelope type headers

**CLR-identity form (`FormatClrTypeName`)** — anything keyed on the type itself:

- `wh_event_store.aggregate_type`
- `wh_message_type_registry.clr_type_name`, `wh_perspective_registry.clr_type_name`
- `wh_consumed_types.event_type` (the subscription-expansion registry — keyed on identity,
  while its outgoing redelivery requests map to the wire form)

## Defensive normalization

Serializers sometimes hand back the **long** assembly-qualified name
(`…, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`). Two helpers collapse it to the
wire form:

- `TypeNameFormatter.Parse` / `TryParse` in C# — extracts `"TypeName, AssemblyName"` from any
  supported input.
- `normalize_event_type()` in SQL — the same truncation inside the database; the digest reads
  and the redelivery fetch pass every requested name through it, so a long-form caller still
  matches.

Neither can *add* a missing assembly: a bare CLR-identity string handed to a wire-form lookup
matches **nothing** — silently, because an empty result is also the legitimate
"no history for those types" answer.

```csharp{title="Producing each form" description="The two canonical forms and the normalizing parser, side by side" category="Reference" difficulty="INTERMEDIATE" tags=["Type-Names", "Extensibility"] tests=["TypeNameFormatterTests.Format_WithValidType_ReturnsTypeNameAndAssemblyAsync", "TypeNameFormatterTests.Format_WithNestedType_IncludesFullNamespaceAsync", "TypeNameFormatterTests.FormatClrTypeName_TopLevelType_ReturnsFullNameAsync", "TypeNameFormatterTests.FormatClrTypeName_NestedType_UsesPlusSeparatorAsync", "TypeNameFormatterTests.Parse_WithLongForm_ExtractsShortFormAsync"]}
// Wire form — matches event_type / digest columns and message routing:
var wire = TypeNameFormatter.Format(typeof(OrderPlaced));
// "MyApp.OrderContracts+OrderPlaced, MyApp.Contracts"

// CLR identity — matches aggregate_type / clr_type_name registry columns:
var identity = TypeNameFormatter.FormatClrTypeName(typeof(OrderPlaced));
// "MyApp.OrderContracts+OrderPlaced"

// Long-form input from a serializer collapses to the wire form:
var normalized = TypeNameFormatter.Parse(
  "MyApp.OrderContracts+OrderPlaced, MyApp.Contracts, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null");
// "MyApp.OrderContracts+OrderPlaced, MyApp.Contracts"
```

## Rules for extensions

1. **Never build a type-name string by hand.** Always go through `TypeNameFormatter`
   (runtime) or `TypeNameUtilities` (source generators) — they are the single place each
   form's shape is decided, and nested types (`+`) are the case hand-rolled code gets wrong.
2. **Match the form to the column.** Comparing against an `event_type`? Use `Format`.
   Keying a registry on the type itself? Use `FormatClrTypeName`. The XML docs on both
   methods name the columns they feed.
3. **Treat an empty lookup as suspect during development.** Both forms are plain strings, so
   the compiler cannot catch a mix-up — the symptom is a query that silently returns nothing.
   When a type-filtered lookup returns empty against data you know exists, compare your
   requested string to a stored value first.
4. **Tests must assert the stored form, not the code's own output.** A test that asserts
   `result == TypeNameFormatter.X(...)` passes no matter which `X` the code picked; assert
   against a literal in the form the target column stores.

:::planned
A future release may wrap the two forms in distinct value types so a CLR-identity string
handed to a wire-form lookup fails at compile time instead of matching nothing at runtime.
:::
