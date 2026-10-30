---
title: StreamId Attribute
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Attributes
order: 2
description: >-
  Marks a property or parameter as the stream identifier for event sourcing,
  enabling zero-reflection stream ID extraction at compile time
tags: 'attributes, streamid, event-sourcing, source-generator, aggregates'
codeReferences:
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Generators/Utilities/StreamIdSelection.cs
  - src/Whizbang.Generators/Analyzers/StreamIdAttributeAnalyzer.cs
  - src/Whizbang.Core/StreamIdResolver.cs
  - src/Whizbang.Core/StreamIdExtractor.cs
  - src/Whizbang.Core/IStreamIdExtractor.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdOverrideGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdDerivedFirstGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/StreamIdAttributeAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/StreamKeyAttributeTests.cs
  - tests/Whizbang.Core.Tests/StreamIdExtractorTests.cs
  - tests/Whizbang.Core.Tests/Registry/StreamIdExtractorRegistryTests.cs
lastMaintainedCommit: '01f07906'
---

# StreamId Attribute

The `[StreamId]` attribute marks a property or parameter as the stream identifier for event sourcing. The stream ID identifies which stream (aggregate) a message belongs to, enabling the source generator to create zero-reflection extraction methods.

## Namespace

```csharp{title="Namespace" description="Namespace" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Namespace"] unverified="namespace import directive — nothing to verify"}
using Whizbang.Core;
```

## Syntax

```csharp{title="Syntax" description="Syntax" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Syntax"] tests=["StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync", "StreamIdExtractorTests.ExtractStreamId_EventWithStreamId_ReturnsStreamIdValueAsync"]}
// On a record parameter
public record OrderCreated([property: StreamId] Guid OrderId, string ProductName) : IEvent;

// On a property
public record CreateOrder : ICommand {
  [StreamId]
  public Guid OrderId { get; init; }
  public string ProductName { get; init; } = string.Empty;
}
```

## Applies To

- Properties on event types (implementing `IEvent`)
- Properties on command types (implementing `ICommand`)
- Properties on perspective model types (required for perspective runner generation)
- Record/constructor parameters (directly, or via the `[property: StreamId]` target)

## Purpose

The `[StreamId]` attribute serves two critical purposes:

1. **Stream Association**: Identifies which aggregate/stream a message belongs to
2. **Compile-Time Extraction**: Source generator creates zero-reflection `ExtractStreamId()` methods for AOT compatibility

## Requirements

- **Property type**: Any type. The extractor keys the stream by the value's string form, so `Guid`, `Guid?`, `string`
  and strongly typed IDs all work
- **One per type**: Only one property per message type should have this attribute ([WHIZ006](../../operations/diagnostics/whiz006))
- **Inherited**: Attribute is inherited by derived message types; a derived type replaces an inherited one with
  `Override = true` (see [Overriding an Inherited Stream ID](#overriding-an-inherited-stream-id))
- **Accessible**: Property must have a `get` accessor

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Override` | `bool` | `false` | Marks this stream ID as replacing the `[StreamId]` the type inherits, on purpose. It is used ahead of any inherited one, and hiding the inherited one is not reported as [WHIZ006](../../operations/diagnostics/whiz006). {verified: StreamKeyAttributeTests.StreamIdAttribute_Override_DefaultsToFalseAsync, StreamKeyAttributeTests.StreamIdAttribute_Override_CanBeSetAsync} |

## Basic Examples

### Event with StreamId

```csharp{title="Event StreamId" description="Mark stream identifier on an event" category="Usage" difficulty="BEGINNER" tags=["StreamId", "Events", "Attributes"] tests=["StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync", "StreamIdGeneratorTests.GeneratedExtractor_WithValidEvent_GeneratesResolveMethodAsync"]}
public record OrderCreated : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }
  public string ProductName { get; init; } = string.Empty;
  public decimal Price { get; init; }
}
```

### Command with StreamId

```csharp{title="Command StreamId" description="Mark stream identifier on a command" category="Usage" difficulty="BEGINNER" tags=["StreamId", "Commands", "Attributes"] tests=["StreamIdExtractorTests.ExtractStreamId_CommandWithStreamId_ReturnsStreamIdAsync"]}
public record UpdateOrder : ICommand {
  [StreamId]
  public Guid OrderId { get; init; }
  public string NewProductName { get; init; } = string.Empty;
}
```

### Record Parameter Syntax

```csharp{title="Record Parameter StreamId" description="Use StreamId on record parameters" category="Usage" difficulty="BEGINNER" tags=["StreamId", "Records", "Attributes"] tests=["StreamIdExtractorTests.ExtractStreamId_EventWithStreamId_ReturnsStreamIdValueAsync"]}
// Use [property:] target to apply attribute to the generated property
public record ProductCreated(
    [property: StreamId] Guid ProductId,
    string Name,
    decimal Price
) : IEvent;
```

## Overriding an Inherited Stream ID

A base command or event often declares a default stream ID that most derived types use, while some derived types
belong to a different stream and declare their own key. Mark the derived key `[StreamId(Override = true)]`:

```csharp{title="Override an inherited stream ID" description="The base declares a default stream ID; a derived command declares its own key with Override = true, and that key is the stream ID." framework="NET10" category="Attributes" difficulty="INTERMEDIATE" tags=["StreamId", "Attributes", "Inheritance", "Override"] tests=["StreamIdAttributeAnalyzerTests.ADerivedOverridePropertyOverAnInheritedOne_IsNotReportedAsync", "StreamIdOverrideGeneratorTests.AnEventOverrideProperty_IsTheStreamIdAheadOfTheInheritedOneAsync"]}
public abstract class CommandBase : ICommand {
  [StreamId]
  public virtual Guid StreamId { get; set; }
}

public class AcknowledgeAlert : CommandBase {
  [StreamId(Override = true)]
  public Guid AckId { get; set; }   // the stream ID for this command
}

// On a record's primary-constructor parameter
public record LineAdded([StreamId(Override = true)] Guid LineId) : OrderEventBase;
```

How the stream ID is chosen
{verified: StreamIdOverrideGeneratorTests.AnEventOverrideParameter_IsTheStreamIdAheadOfAnInheritedPropertyAsync, StreamIdOverrideGeneratorTests.AnOverrideOnAnIntermediateRecord_IsInheritedByTheLeafAsync, StreamIdOverrideGeneratorTests.ACommandOverrideParameter_IsTheStreamIdAheadOfAnInheritedPropertyAsync, StreamIdOverrideGeneratorTests.ACompositeOverrideParameter_IsTheStreamIdAheadOfTheCompositeBaseAsync}:

1. The generator searches the type and then each base type, nearest first.
2. At each level, a `[StreamId(Override = true)]` (on a property, or on a record's primary-constructor parameter) is
   used first, then a plain `[StreamId]` property.
3. Only when no level has either is the type's own plain `[StreamId]` constructor parameter used.

So an override is used ahead of any inherited `[StreamId]`, including the case where an inherited property would
otherwise beat a derived record's `[StreamId]` parameter, and an override on an intermediate base type is inherited by
the types below it. The analyzer makes the same choice, so:

- hiding an inherited `[StreamId]` with an override is not reported;
- two `[StreamId]` declared on one type, override or not, or a hide without the option, is still
  [WHIZ006](../../operations/diagnostics/whiz006);
- an override where no base type declares a `[StreamId]` is [WHIZ016](../../operations/diagnostics/whiz016);
- an event whose stream ID is an override is not [WHIZ031](../../operations/diagnostics/whiz031) in a perspective, and
  the perspective runner keys it by the override
  {verified: StreamIdOverrideGeneratorTests.APerspectiveEventWithAnOverride_IsNotReportedAsMultipleStreamIdsAsync, StreamIdOverrideGeneratorTests.APerspectiveRunner_ExtractsTheOverrideParameterAsync}.

A plain `[StreamId]` is unchanged: `Override` defaults to `false`.

### A derived type's own stream ID is never shadowed by its base {#derived-first-dispatch}

The generated extractors pick the type's code with a chain of `message is T` checks. A base type's check also matches
every type derived from it, so the order of the chain decides which stream ID a derived message gets. The generator
orders every chain most-derived first: by inheritance depth, deepest first, and then by type name, so the generated
file does not depend on the order in which types are discovered (file or namespace order). This holds for commands,
events and composites, and for every generated entry point: `Resolve`, `TryResolveAsGuid`, `ExtractStreamId`,
`SetStreamId` and the `[GenerateStreamId]` policy lookup
{verified: StreamIdDerivedFirstGeneratorTests.ADerivedCommandInANamespaceAfterTheBase_ResolvesAndSetsByItsOwnStreamIdAsync, StreamIdDerivedFirstGeneratorTests.ADerivedCommandInANamespaceBeforeTheBase_ResolvesAndSetsByItsOwnStreamIdAsync, StreamIdDerivedFirstGeneratorTests.ADerivedCommandOverrideInANamespaceAfterTheBase_ResolvesAndSetsByTheOverrideAsync, StreamIdDerivedFirstGeneratorTests.ADerivedEventInANamespaceAfterTheBase_ResolvesAndSetsByItsOwnStreamIdAsync, StreamIdDerivedFirstGeneratorTests.TypesAtTheSameDepth_AreDispatchedInNameOrderWhateverTheDeclarationOrderAsync}.

So a derived type that declares its own `[StreamId]`, plain or `Override = true`, is resolved by that property and has
a generated ID written to that property, wherever its namespace sorts relative to its base's. With three or more
levels, each type uses its nearest `[StreamId]`
{verified: StreamIdDerivedFirstGeneratorTests.ThreeLevelsOfCommands_EachResolvesAndSetsByItsNearestStreamIdAsync, StreamIdDerivedFirstGeneratorTests.ThreeLevelsOfEvents_EachResolvesByItsNearestStreamIdAsync}.
A derived type with no `[StreamId]` of its own still resolves and sets by the base's
{verified: StreamIdDerivedFirstGeneratorTests.ADerivedCommandWithoutItsOwnStreamId_StillResolvesAndSetsByTheBaseAsync}.

The `[GenerateStreamId]` policy is looked up the same way. A derived type that declares its own `[GenerateStreamId]`
uses its own policy, not the base's
{verified: StreamIdDerivedFirstGeneratorTests.ADerivedTypesOwnGenerationPolicy_IsNotShadowedByTheBaseAsync}.
A derived type with its own `[StreamId]` but **no** `[GenerateStreamId]` does not inherit the base's policy: the
generator gives it an explicit do-not-generate entry, so it is not auto-generated. Add `[GenerateStreamId]` to it to
auto-generate its own stream ID. A type with no `[StreamId]` of its own inherits the policy of its nearest base that
declares one
{verified: StreamIdDerivedFirstGeneratorTests.ADerivedTypeWithItsOwnStreamIdAndNoGenerateStreamId_DoesNotInheritTheBasesGenerateStreamIdAsync, StreamIdDerivedFirstGeneratorTests.ADerivedOverrideWithNoGenerateStreamId_DoesNotInheritTheBasesClassLevelGenerateStreamIdAsync, StreamIdDerivedFirstGeneratorTests.ATypeWithItsOwnStreamId_DoesNotInheritAGenerateStreamIdFromAnyLevelAboveAsync, StreamIdDerivedFirstGeneratorTests.ADerivedTypeWithItsOwnStreamIdAndGenerateStreamId_UsesItsOwnGenerationPolicyAsync, StreamIdDerivedFirstGeneratorTests.ATypeWithNoStreamIdOfItsOwn_InheritsTheGenerationPolicyOfItsNearestBaseAsync}.

Within one assembly this is exact. When the base type is compiled in a different assembly from the derived type, the
base assembly's lookup can still apply its policy to the derived instance; keep a base that declares
`[GenerateStreamId]` in the same assembly as derived types that must not generate.
[WHIZ017](../../operations/diagnostics/whiz017) warns when a derived type's opt-out cannot hold for this reason; exact
cross-assembly resolution is planned in [whizbang-lib/whizbang#1905](https://github.com/whizbang-lib/whizbang/issues/1905).

:::updated
**Upgrade note.** Before this change the chain followed discovery order, so a base type discovered before a derived
type with its own `[StreamId]` matched every derived instance first, and the derived property was never read or
written. Whether a contract resolved correctly depended on how its namespace was spelled. Such a derived type now
resolves and sets by its own `[StreamId]`, as [WHIZ006](../../operations/diagnostics/whiz006) already described. A
caller that set only the inherited base property on that type now gets the derived property's value as the stream ID
(often empty), so its messages can route to a different stream. Set the derived property, or remove the derived
`[StreamId]` when the inherited one is the stream ID you mean. A derived type with its own `[StreamId]` also no longer
inherits the base's `[GenerateStreamId]`; declare `[GenerateStreamId]` on it to keep auto-generation.
:::

## How It Works

### 1. Compile-Time Discovery

The source generator finds properties marked with `[StreamId]` and generates extraction methods:

```csharp{title="Generated Extraction" description="Generated zero-reflection stream ID extraction" category="Reference" difficulty="INTERMEDIATE" tags=["StreamId", "Source-Generators"] tests=["StreamIdGeneratorTests.GeneratedExtractor_WithValidEvent_GeneratesResolveMethodAsync", "StreamIdGeneratorTests.GeneratedExtractor_WithEvent_GeneratesTryResolveAsGuidAsync", "StreamIdExtractorTests.StreamIdExtractor_GetGenerationPolicy_WithUnknownType_ReturnsDefaultAsync", "StreamIdExtractorTests.StreamIdExtractor_SetStreamId_WithUnknownType_ReturnsFalseAsync"]}
// Generated by StreamIdGenerator into the {YourAssembly}.Generated namespace
public static partial class StreamIdExtractors {
  // Throwing resolution (string form) - used by StreamIdResolver
  public static string Resolve(IEvent @event);
  public static string Resolve(ICommand command);

  // Non-throwing resolution - returns null when no [StreamId] value is available
  public static Guid? TryResolveAsGuid(IEvent? @event);
  public static Guid? TryResolveAsGuid(ICommand? command);
  public static Guid? TryResolveAsGuid(object? message);

  // [GenerateStreamId] support - used by the Dispatcher
  public static (bool ShouldGenerate, bool OnlyIfEmpty) GetGenerationPolicy(object message);
  public static bool SetStreamId(object message, Guid streamId);
}
```

Each per-type extractor uses direct property access (`@event.OrderId`) - no reflection. A `[ModuleInitializer]` registers the assembly's extractor with `StreamIdExtractorRegistry` so extraction works across assemblies.

### 2. Runtime Resolution

Generated extractors are consumed through the static `StreamIdResolver` or the `IStreamIdExtractor` service:

```csharp{title="StreamIdResolver Usage" description="Resolve stream ID from any message" category="Reference" difficulty="INTERMEDIATE" tags=["StreamId", "Runtime"] tests=["StreamIdExtractorTests.ExtractStreamId_EventWithStreamId_ReturnsStreamIdValueAsync"]}
// Static resolution - throws InvalidOperationException when no [StreamId]
// is found or the value is null/empty
string streamKey = StreamIdResolver.Resolve(orderCreatedEvent);

// DI service - non-throwing, returns null when the stream ID cannot be resolved
var extractor = serviceProvider.GetRequiredService<IStreamIdExtractor>();
Guid? streamId = extractor.ExtractStreamId(orderCreatedEvent, orderCreatedEvent.GetType());
```

### 3. Event Store Integration

Stream IDs enable grouping events by aggregate:

```csharp{title="Event Store Usage" description="How stream IDs enable event grouping" category="Reference" difficulty="INTERMEDIATE" tags=["StreamId", "Event-Store"] unverified="event store ReadAsync/AppendAsync usage — event-store persistence API, outside the [StreamId] extractor/generator coverage map"}
// Events are stored per-stream
await foreach (var envelope in eventStore.ReadAsync<OrderShipped>(orderId, fromSequence: 0)) {
  // envelope.Payload is the stored event
}

// Append to a specific stream
await eventStore.AppendAsync(orderId, orderShipped);
```

## Multiple Events for Same Aggregate

All events for the same aggregate should use consistent property names:

```csharp{title="Consistent StreamId" description="Use same property name across aggregate events" category="Usage" difficulty="BEGINNER" tags=["StreamId", "Events", "Aggregates"] tests=["StreamIdGeneratorTests.Generator_WithMultipleMessageTypes_GeneratesAllExtractorsAsync"]}
public record OrderCreated : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }
  public DateTime CreatedAt { get; init; }
}

public record OrderShipped : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }  // Same property name
  public string TrackingNumber { get; init; } = string.Empty;
}

public record OrderCancelled : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }  // Same property name
  public string Reason { get; init; } = string.Empty;
}
```

## Property Types

### Guid (Most Common)

```csharp{title="Guid StreamId" description="Standard Guid stream identifier" category="Usage" difficulty="BEGINNER" tags=["Extending", "Attributes", "C#", "Guid", "StreamId"] tests=["StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync"]}
[StreamId]
public Guid ProductId { get; init; }
```

### Nullable Guid

```csharp{title="Nullable Guid StreamId" description="Nullable Guid for optional stream association" category="Usage" difficulty="INTERMEDIATE" tags=["Extending", "Attributes", "C#", "Nullable", "Guid"] tests=["StreamIdGeneratorTests.Generator_WithNullableGuid_HandlesCorrectlyAsync", "StreamIdGeneratorTests.StreamIdGenerator_ClassWithNullableGuid_GeneratesExtractorAsync"]}
[StreamId]
public Guid? ParentOrderId { get; init; }  // May be null for root orders
```

### WhizbangId Types

```csharp{title="WhizbangId StreamId" description="Strongly-typed ID as stream identifier" category="Usage" difficulty="INTERMEDIATE" tags=["Extending", "Attributes", "C#", "WhizbangId", "StreamId"] unverified="WhizbangId / Vogen value-object stream id — no candidate (nor StreamIdGeneratorCoverageTests) test exercises a strongly-typed value-object [StreamId]; only Guid, nullable-Guid, string, and int underlying types are covered"}
// Using Vogen-generated value object
[StreamId]
public ProductId ProductId { get; init; }
```

## Diagnostics

The source generators validate `[StreamId]` usage:

### WHIZ009: Missing StreamId Attribute

**Warning**: An `IEvent` implementation has no property or constructor parameter marked with `[StreamId]`. Stream ID resolution will fail at runtime.

```csharp{title="Missing StreamId Warning" description="Warning when an event has no StreamId attribute" category="Diagnostics" difficulty="BEGINNER" tags=["StreamId", "Diagnostics", "Warnings"] tests=["StreamIdGeneratorTests.Generator_WithNoStreamIds_OnEvent_ReportsWarningAsync"]}
// Causes WHIZ009
public record InvalidEvent : IEvent {
  public Guid OrderId { get; init; }  // No [StreamId]!
}

// Fixed
public record ValidEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }
}
```

### WHIZ030 / WHIZ031: Perspective Stream Validation

When an event feeds a perspective, `[StreamId]` becomes mandatory and is validated strictly:

- **WHIZ030 (Error)**: Event used in a perspective has no `[StreamId]` property
- **WHIZ031 (Error)**: Event has multiple properties marked with `[StreamId]` - only one is allowed. An event whose
  stream ID is a `[StreamId(Override = true)]` is not reported: the override replaces the inherited one

```csharp{title="Multiple StreamId Error" description="Error when multiple StreamId attributes are used" category="Diagnostics" difficulty="BEGINNER" tags=["StreamId", "Diagnostics", "Errors"] unverified="counter-example — WHIZ031 (multiple [StreamId]) is verified by PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_EventWithMultipleStreamIds_ReportsWHIZ031DiagnosticAsync, outside the current coverage map"}
// Causes WHIZ031
public record InvalidEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }

  [StreamId]  // Error: Only one [StreamId] allowed!
  public Guid CustomerId { get; init; }
}

// Fixed: Choose the primary aggregate
public record ValidEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }  // Primary aggregate

  public Guid CustomerId { get; init; }  // Related entity, not stream ID
}
```

### WHIZ006 and WHIZ016: Inherited Stream IDs

- **[WHIZ006](../../operations/diagnostics/whiz006) (Warning)**: A type has more than one `[StreamId]`, counting the
  inherited one, and only one is used. Mark a derived stream ID `Override = true` when it replaces the inherited one
  on purpose.
- **[WHIZ016](../../operations/diagnostics/whiz016) (Warning)**: `Override = true` where no base type declares a
  `[StreamId]`; there is nothing to override.

### WHIZ033: Perspective Model Missing StreamId

**Warning**: A perspective's model type has no `[StreamId]` property; no runner is generated for that perspective. Perspective models need `[StreamId]` to identify which stream a row represents.

## One Attribute for Storage and Perspectives

`[StreamId]` is the **unified** stream attribute. The same marked property drives both:

| Concern | How `[StreamId]` is used |
|---------|--------------------------|
| Event store stream identification | Events append to and read from the stream identified by the `[StreamId]` value |
| Perspective event ordering | Perspectives group and order events per stream using the same `[StreamId]` property (on events **and** on perspective models) |

```csharp{title="Unified StreamId" description="One StreamId attribute serves storage and perspectives" category="Usage" difficulty="INTERMEDIATE" tags=["Extending", "Attributes", "C#", "StreamId"] tests=["StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync"]}
public record OrderCreated : IEvent {
  [StreamId]  // Event store stream identification AND perspective event ordering
  public Guid OrderId { get; init; }
}
```

An earlier design used a separate `[StreamKey]` attribute for perspective ordering; it has been unified into `[StreamId]` (see [StreamKey Attribute](./streamkey)).

## Best Practices

### Use on Aggregate Root ID

```csharp{title="Aggregate Root ID" description="StreamId should be the aggregate root identifier" category="Best-Practices" difficulty="BEGINNER" tags=["StreamId", "Best-Practices"] tests=["StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync"]}
// OrderId is the aggregate root - use StreamId here
public record OrderEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }

  public Guid CustomerId { get; init; }  // Related entity, not stream ID
}
```

### Consistent Property Names

```csharp{title="Consistent Names" description="Use same property name across aggregate events" category="Best-Practices" difficulty="BEGINNER" tags=["StreamId", "Best-Practices", "Naming"] tests=["StreamIdGeneratorTests.Generator_WithMultipleMessageTypes_GeneratesAllExtractorsAsync"]}
// All order events use "OrderId"
public record OrderCreated : IEvent {
  [StreamId] public Guid OrderId { get; init; }
}

public record OrderUpdated : IEvent {
  [StreamId] public Guid OrderId { get; init; }  // Same name
}
```

### UUID7 for Time-Ordering

```csharp{title="UUID7 Recommendation" description="Use UUID7 for time-ordered stream IDs" category="Best-Practices" difficulty="INTERMEDIATE" tags=["StreamId", "Best-Practices", "UUID7"] unverified="best-practice recommendation — UUID7 default via TrackedGuid.New(); the id-generation guidance is outside the [StreamId] extractor/generator coverage map"}
// UUID7 provides time-ordering which is useful for:
// - Sequential ID generation without coordination
// - Natural ordering by creation time
// - Efficient indexing in databases

[StreamId]
public Guid OrderId { get; init; } = TrackedGuid.New();
```

:::note
Use `TrackedGuid.New()` (UUIDv7 with sub-millisecond precision) rather than `Guid.NewGuid()` or `Guid.CreateVersion7()`. The bundled `GuidUsageAnalyzer` flags the latter two with WHIZ055/WHIZ056 warnings. Alternatively, apply [GenerateStreamId](./generatestreamid) and let the Dispatcher mint the ID.
:::

## Zero Reflection and AOT

The `[StreamId]` attribute enables zero-reflection stream ID extraction:

**Without [StreamId] (reflection)**:
```csharp{title="Zero Reflection and AOT" description="Without [StreamId] (reflection):" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Zero", "Reflection"] unverified="counter-example — runtime reflection anti-pattern the generator replaces; deliberately not test-backed"}
// Runtime reflection - not AOT-compatible
var streamId = @event.GetType()
    .GetProperty("OrderId")
    ?.GetValue(@event) as Guid?;
```

**With [StreamId] (generated)**:
```csharp{title="Zero Reflection and AOT (2)" description="With [StreamId] (generated):" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Zero", "Reflection"] tests=["StreamIdGeneratorTests.GeneratedExtractor_WithEvent_GeneratesTryResolveAsGuidAsync"]}
// Compile-time code generation - AOT-compatible
private static Guid? TryExtractAsGuid(OrderCreated @event) {
  return @event.OrderId;  // Direct property access
}
```

Benefits:
- Works with Native AOT
- Zero runtime overhead
- Type-safe at compile-time
- No reflection allocations

## See Also

- [GenerateStreamId Attribute](./generatestreamid) - Auto-generate StreamIds at dispatch time
- [StreamKey Attribute](./streamkey) - Historical `[StreamKey]` attribute, unified into `[StreamId]`
- Event Sourcing - Understanding aggregates and streams
- Source Generators - How generators create extraction methods
- AOT Compatibility - Native AOT requirements
