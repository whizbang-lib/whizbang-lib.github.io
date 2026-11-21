---
title: 'WHIZ036: Stream ID Is Ambiguous'
pageType: troubleshooting
verifiedAgainstCommit: '0a29f1a5'
verifiedDate: 2026-11-20
description: >-
  Error reported on a message type that declares no [StreamId] of its own and gets one from two or more sources
  naming different properties (two interfaces, or an interface and a base class). The type has no stream id until it
  declares [StreamId] itself.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - streamid
  - inheritance
  - interfaces
  - analyzer
codeReferences:
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
  - src/Whizbang.Generators/Utilities/StreamIdSelection.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdAmbiguityAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdTypeTableGeneratorTests.cs
lastMaintainedCommit: '0a29f1a5'
---

# WHIZ036: Stream ID Is Ambiguous

**Severity**: Error
**Category**: Whizbang.SourceGeneration

## Description

A message type that declares no `[StreamId]` of its own takes the one it inherits: the stream ID its base type resolves
to, and a `[StreamId]` declared on an interface it implements, read through the property that implements it (see
[How a message type finds its stream ID](../../extending/attributes/streamid#how-a-message-type-finds-its-stream-id)).
When two or more of those sources name **different** properties, nothing decides between them: inheritance depth
orders base classes, not interfaces. The type then has no stream ID, the generator emits no entry for it, and WHIZ036
is reported on the type, naming the properties
{verified: StreamIdAmbiguityAnalyzerTests.TwoInterfacesNamingDifferentProperties_ReportWhiz036Async, StreamIdAmbiguityAnalyzerTests.AnInterfaceAndABaseClassNamingDifferentProperties_ReportWhiz036Async, StreamIdTypeTableGeneratorTests.TwoInterfacesNamingDifferentProperties_GetNoEntryAsync}.
It is an error, enabled by default
{verified: StreamIdAmbiguityAnalyzerTests.TheAnalyzer_DeclaresWhiz036AsAnErrorAsync}.

It is **not** reported for:

- a type with a `[StreamId]` from one interface
  {verified: StreamIdAmbiguityAnalyzerTests.OneInterface_IsNotReportedAsync};
- sources that name the same property, such as two interfaces that both mark `OrderId`, or an interface and a base
  class that both do; they are one source
  {verified: StreamIdAmbiguityAnalyzerTests.TwoInterfacesNamingTheSameProperty_AreNotReportedAsync, StreamIdAmbiguityAnalyzerTests.AnInterfaceAndABaseClassNamingTheSameProperty_AreNotReportedAsync};
- a type that declares its own `[StreamId]`, which is its stream ID whatever it inherits
  {verified: StreamIdAmbiguityAnalyzerTests.ATypeThatDeclaresItsOwnStreamIdOverAnAmbiguousPair_IsNotReportedAsync};
- an abstract type, which is never dispatched itself; each concrete type below it that carries the ambiguity is
  reported instead
  {verified: StreamIdAmbiguityAnalyzerTests.AnAbstractAmbiguousType_IsNotReportedButItsConcreteSubclassIsAsync};
- an interface `[StreamId]` the type implements explicitly, or only through the interface's default body, which has
  no property the generated code can read and so is not a source
  {verified: StreamIdAmbiguityAnalyzerTests.ExplicitAndDefaultImplementations_AreNotSourcesAsync}.

## Diagnostic Message

```text
{TypeName} gets [StreamId] from more than one source naming different properties ({PropertyNames}) and declares none of its own, so it has no stream id. Declare [StreamId] on the property of {TypeName} that is its stream id.
```

## Common Causes

1. **Two keyed contracts on one message.** A message implements both an order-keyed and a customer-keyed interface,
   and each interface marks its own key `[StreamId]`.
2. **An interface added to a derived type.** The base class already has a `[StreamId]`, and an interface implemented
   by the derived type marks a different property.
3. **An upgrade.** Before #1908 a `[StreamId]` on an interface was ignored, so such a type quietly used its base
   class's stream ID, or had none. It is now reported instead of being resolved by an order no one chose.

## How to Fix

Declare `[StreamId]` on the property of the concrete type that is its stream ID. A type's own `[StreamId]` is its
stream ID alone, so the inherited sources no longer compete.

### Before (reports WHIZ036)

```csharp{title="Two interfaces naming different stream IDs" description="OrderSettled implements IOrderKeyed and ICustomerKeyed, which mark different properties [StreamId], and declares none of its own, so WHIZ036 is reported and the type has no stream ID." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ036", "StreamId", "Interfaces"] tests=["StreamIdAmbiguityAnalyzerTests.TwoInterfacesNamingDifferentProperties_ReportWhiz036Async"]}
using Whizbang.Core;

public interface IOrderKeyed { [StreamId] Guid OrderId { get; } }
public interface ICustomerKeyed { [StreamId] Guid CustomerId { get; } }

public class OrderSettled : IEvent, IOrderKeyed, ICustomerKeyed {   // WHIZ036
  public Guid OrderId { get; set; }
  public Guid CustomerId { get; set; }
}
```

### After

```csharp{title="The type says which one is its stream ID" description="OrderSettled declares [StreamId] on OrderId, so it resolves by that property and nothing is reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "WHIZ036", "StreamId", "Interfaces"] tests=["StreamIdAmbiguityAnalyzerTests.ATypeThatDeclaresItsOwnStreamIdOverAnAmbiguousPair_IsNotReportedAsync", "StreamIdTypeTableGeneratorTests.TwoInterfacesNamingDifferentProperties_GetNoEntryAsync"]}
using Whizbang.Core;

public interface IOrderKeyed { [StreamId] Guid OrderId { get; } }
public interface ICustomerKeyed { [StreamId] Guid CustomerId { get; } }

public class OrderSettled : IEvent, IOrderKeyed, ICustomerKeyed {
  [StreamId] public Guid OrderId { get; set; }
  public Guid CustomerId { get; set; }
}
```

If the interfaces were meant to share one key, mark the same property name on both instead; sources naming the same
property are one source.

## Suppressing

Do not suppress WHIZ036. A suppressed error still leaves the type with no stream ID: it cannot be routed to a stream,
generated or inherited.

## Related

- [StreamId Attribute: how a message type finds its stream ID](../../extending/attributes/streamid#how-a-message-type-finds-its-stream-id)
- [WHIZ006: Multiple Stream ID Attributes](whiz006)
- [WHIZ009: Missing StreamId Attribute](whiz009)
