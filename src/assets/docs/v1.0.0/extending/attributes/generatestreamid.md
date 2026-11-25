---
title: GenerateStreamId Attribute
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Attributes
order: 3
description: >-
  Marks an event type or property for automatic StreamId generation at dispatch time,
  replacing the blunt AutoGenerateStreamIds option with per-event-type control
tags: 'attributes, streamid, event-sourcing, source-generator, auto-generation'
codeReferences:
  - src/Whizbang.Core/GenerateStreamIdAttribute.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Core/Validation/StreamIdGuard.cs
  - src/Whizbang.Core/Registry/StreamIdTypeRegistry.cs
  - src/Whizbang.Core/Messaging/GeneratedStreamIdentity.cs
testReferences:
  - tests/Whizbang.Generators.Tests/GenerateStreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdDerivedFirstGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdTypeTableGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Core.Tests/Validation/StreamIdGuardTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/GeneratedStreamIdentityTests.cs
  - tests/Whizbang.Core.Unit.Dispatcher.Tests/Dispatcher/DispatcherDerivedIdentityInHandlingTests.cs
lastMaintainedCommit: '0a29f1a5'
---

# GenerateStreamId Attribute

The `[GenerateStreamId]` attribute marks an event for automatic StreamId generation at dispatch time. It works alongside `[StreamId]` to provide explicit, per-event-type opt-in for stream ID auto-generation.

## Namespace

```csharp{title="Namespace" description="Namespace" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Namespace"] unverified="namespace import — brings [GenerateStreamId] into scope; no behavior under test"}
using Whizbang.Core;
```

## Syntax

```csharp{title="Syntax" description="Syntax" category="Reference" difficulty="INTERMEDIATE" tags=["Extending", "Attributes", "Syntax"] unverified="placement reference (property, OnlyIfEmpty, class-level inherited [StreamId], record parameter); the generated GetGenerationPolicy for each form is verified by GenerateStreamIdGeneratorTests, which is outside the current coverage map"}
// On a property (alongside [StreamId])
public record OrderCreatedEvent : IEvent {
  [StreamId] [GenerateStreamId]
  public Guid OrderId { get; set; }
}

// With OnlyIfEmpty for flexible events
public record InventoryReserved : IEvent {
  [StreamId] [GenerateStreamId(OnlyIfEmpty = true)]
  public Guid ReservationId { get; set; }
}

// On a class (for inherited [StreamId])
[GenerateStreamId]
public record OrderCreatedEvent : BaseEvent {
  // [StreamId] inherited from BaseEvent.StreamId
}

// On record parameters
public record OrderCreated([property: StreamId] [property: GenerateStreamId] Guid OrderId) : IEvent;
```

## Applies To

- Properties on event types (alongside `[StreamId]`)
- Record parameters (using `[property: GenerateStreamId]` target)
- Classes/records (when `[StreamId]` is inherited from a base type)

## Purpose

The `[GenerateStreamId]` attribute replaces the blunt `AutoGenerateStreamIds` option with fine-grained, per-event-type control over when StreamIds are auto-generated. (The legacy `WhizbangOptions.AutoGenerateStreamIds` property still exists for configuration compatibility but is no longer consulted by the pipeline.) This distinction is critical for event-sourced systems where:

1. **Stream-initiating events** should always get a new StreamId
2. **Appending events** must receive a StreamId from their parent (and fail-fast if missing)
3. **Flexible events** may either inherit a StreamId from a cascade or generate their own

## Event Patterns

### Stream-Initiating Events

Events that start a new stream should always generate a new StreamId, even when cascaded from another event:

```csharp{title="Stream-Initiating Events" description="Events that start a new stream should always generate a new StreamId, even when cascaded from another event:" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Stream-Initiating", "Events"] tests=["StreamIdGeneratorTests.Generator_GenerateStreamIdOnMutableProperty_DoesNotReportWHIZ013Async"]}
public record OrderCreatedEvent : IEvent {
  [StreamId] [GenerateStreamId]
  public Guid OrderId { get; set; }
}
```

When dispatched, `OrderId` is always populated with a new stream id, a UUIDv7. For an event that id derives from the event's own id; for a command sent inside a receptor's handling it derives from the handling; otherwise it is minted ([Derived stream ids](#derived-stream-ids)).

### Appending Events

Events that must belong to an existing stream should NOT have `[GenerateStreamId]`. If the StreamId is `Guid.Empty` at dispatch time, the `StreamIdGuard` will throw an `InvalidStreamIdException`:

```csharp{title="Appending Events" description="Events that must belong to an existing stream should NOT have [GenerateStreamId]." category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Appending", "Events"] tests=["StreamIdGuardTests.ThrowIfEmpty_WithGuidEmpty_ThrowsInvalidStreamIdExceptionAsync", "StreamIdGuardTests.ThrowIfEmpty_WithValidGuid_DoesNotThrowAsync"]}
public record OrderItemAddedEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; set; }  // MUST be provided by caller
}
```

### Flexible Events

Events that may be dispatched independently OR cascaded from a parent event should use `OnlyIfEmpty = true`:

```csharp{title="Flexible Events" description="Events that may be dispatched independently OR cascaded from a parent event should use OnlyIfEmpty = true:" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Flexible", "Events"] unverified="OnlyIfEmpty = true generation policy is verified by GenerateStreamIdGeneratorTests, which is outside the current coverage map"}
public record InventoryReserved : IEvent {
  [StreamId] [GenerateStreamId(OnlyIfEmpty = true)]
  public Guid ReservationId { get; set; }
}
```

- When cascaded: inherits parent's StreamId (not overwritten)
- When standalone: gets a new StreamId auto-generated
- When cascaded from a parent whose stream a strong-id `[StreamId]` refuses (another id type that `InheritFrom` does
  not list, or a value the id's `From` refuses): gets a new StreamId, exactly as when standalone
  {verified: DispatcherStrongIdStreamInheritanceTests.AfterARefusal_AnEventWithGenerateStreamId_MintsItsOwnIdAsync}.
  See [Inheriting a stream of another id type](streamid#inheriting-a-stream-of-another-id-type).

## Derived stream ids {#derived-stream-ids}

{verified: GeneratedStreamIdentityTests.Derive_TheSameMessageId_DerivesTheSameStreamIdAsync, GeneratedStreamIdentityTests.Derive_TwoMessages_DeriveTwoStreamsAsync, GeneratedStreamIdentityTests.Derive_IsNotTheMessageIdItselfAsync, GeneratedStreamIdentityTests.Derive_KeepsTheMessageIdsFirst92Bits_SoTheStreamSortsWithTheMessageThatStartedItAsync, GeneratedStreamIdentityTests.Derive_IsAVersion7IdWithTheRfcVariantAsync, GeneratedStreamIdentityTests.Derive_AnEmptyMessageId_IsRefusedAsync, DispatcherDerivedIdentityInHandlingTests.PublishAsync_GenerateStreamId_InsideAHandling_ARetryStartsTheSameStreamAsync, DispatcherDerivedIdentityInHandlingTests.CascadeMessageAsync_GenerateStreamId_ARetryOfTheHandlingStartsTheSameStreamAsync, DispatcherDerivedIdentityInHandlingTests.PublishAsync_WithOptions_GenerateStreamId_DerivesTheStreamFromThePublishedIdAsync, DispatcherDerivedIdentityInHandlingTests.PublishAsync_GenerateStreamId_OutsideAHandling_StartsANewStreamDerivedFromTheFreshIdAsync, GeneratedStreamIdentityTests.DeriveInHandling_TheSameInputs_DeriveTheSameStreamIdAsync, GeneratedStreamIdentityTests.DeriveInHandling_SortsAtTheCauseThenByOrdinalAsync, GeneratedStreamIdentityTests.DeriveInHandling_IsAVersion7IdWithTheRfcVariantAsync, DispatcherDerivedIdentityInHandlingTests.SendAsync_GenerateStreamId_InsideAHandling_ARedeliveryStartsTheSameStreamAsync, DispatcherDerivedIdentityInHandlingTests.SendAsync_GenerateStreamId_TwoCommandsInOneHandling_StartTwoStreamsInSendOrderAsync, DispatcherDerivedIdentityInHandlingTests.SendAsync_GenerateStreamId_OutsideAHandling_MintsAFreshStreamEachTimeAsync}

An event that starts a stream, whether a receptor returns it or publishes it, takes a stream id **derived from the
event's own id** (`GeneratedStreamIdentity.Derive`, [#2520](https://github.com/whizbang-lib/whizbang/issues/2520)):

- **It sorts with the event.** The stream id keeps the event id's first 92 bits (its millisecond, counter and
  ordinal), so the stream sorts where the event that started it sorts.
- **It is a version 7 id**, accepted everywhere a minted one is, and it differs from the event's own id.
- **A retry starts the same stream.** Inside a receptor's handling the event's id
  [derives from the handling](../../fundamentals/dispatcher/message-cascade#explicit-publish-identity), so a retry of the
  handling (a lapsed lease, a completion that never committed, a repair that re-runs the receptor) re-derives the same
  event id, and with it the same stream id. Before, each run started a new stream that nothing else referred to.
- **Outside a handling** (an API endpoint, a background service), the event's id is minted fresh, so its stream is new
  each time, as before.
- **A command sent inside a handling** derives its stream from the handling, because the command's own id is still
  minted ([#2537](https://github.com/whizbang-lib/whizbang/issues/2537), `GeneratedStreamIdentity.DeriveInHandling`).
  The inputs are the handled message, the service, the handler, the command type, and the command's position among
  the streams the handling starts this way. The stream sorts with the handled message and is a version 7 id. A
  redelivered handling sends its commands on the streams its first run started. These positions are separate from the
  handling's event ordinals, so sending a command never changes the ids of the events the handling returns or
  publishes. Outside a handling, a command's stream is minted fresh, as before.
- **An event invoked locally inside a handling** derives its stream from the handling too
  ([#2552](https://github.com/whizbang-lib/whizbang/issues/2552)). The void `LocalInvokeAsync` builds no envelope, so
  the event has no id to derive from; its stream derives from the handling as a sent command's does, on ordinals the
  handling keeps for invoked events. Invoking such an event therefore changes neither the streams of the commands the
  handling sends nor the ids of the events and commands it emits, and a redelivered handling starts the same stream.
  The same instance invoked twice keeps its stream. Outside a receptor each invoked event still mints a fresh stream,
  with no added allocation on the void path. Before, a locally invoked event minted a fresh stream even inside a
  handling, so a redelivery started a second stream that nothing else referred to.
  {verified: DispatcherDerivedIdentityInHandlingTests.LocalInvokeAsync_GenerateStreamIdEvent_InsideAHandling_ARedeliveryStartsTheSameStreamAsync, DispatcherDerivedIdentityInHandlingTests.LocalInvokeAsync_GenerateStreamIdEvent_TheSameInstanceTwice_KeepsItsStreamAsync, DispatcherDerivedIdentityInHandlingTests.LocalInvokeAsync_GenerateStreamIdEvent_OutsideAHandling_MintsOncePerInstanceAsync, DispatcherDerivedIdentityInHandlingTests.LocalInvokeAsync_GenerateStreamIdEvent_DoesNotShiftTheHandlingsOtherIdsAsync, DispatcherLocalInvokeGeneratedStreamAllocationTests.LocalInvokeAsync_Void_GenerateStreamIdEvent_OutsideAHandling_GeneratingTheStreamAllocatesNothingAsync}
- **A published event's local receptors see the published stream.** One publish gives a `[GenerateStreamId]` event one
  stream everywhere it goes: the stored copy, the delivery receipt and the local receptors all see the stream derived
  from the event's id. Before, in a host with the envelope registry (any host built with `AddWhizbang`), the local
  receptors were handed a second, freshly minted stream ([#2552](https://github.com/whizbang-lib/whizbang/issues/2552)).
  {verified: DispatcherDerivedIdentityInHandlingTests.PublishAsync_GenerateStreamIdEventWithALocalReceptor_TheReceptorSeesTheStreamDerivedFromThePublishedIdAsync, DispatcherDerivedIdentityInHandlingTests.PublishAsync_GenerateStreamIdEventWithALocalReceptor_OutsideAHandling_TheReceptorSeesThePublishedStreamAsync}
- **One message, one stream.** Every envelope a send builds for a message (the local run's, the stored copy's) names
  the same stream, inside or outside a handling ([#2539](https://github.com/whizbang-lib/whizbang/issues/2539)).
  Sending the same instance again keeps that stream; a new instance starts a new one
  {verified: DispatchTangentialParityComponentTests.EverySendThatRunsHereAndWritesACopy_GivesTheCommandOneStreamAsync, GeneratedStreamAssignmentsTests.GetOrAdd_TheSameMessageTwice_DerivesOnceAndKeepsItsStreamAsync}.

The derivation is a compatibility contract: a stored stream id is referenced by every record on its stream, so the
layouts are versioned (`whizbang.generated-stream.v1`, and `whizbang.generated-stream.in-handling.v1` for a command
sent inside a handling) and never change in place.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `OnlyIfEmpty` | `bool` | `false` | When `true`, only generates a StreamId if the current value is `Guid.Empty`. When `false`, generates a StreamId for each new message instance, replacing any value it carries. |

## How It Works

1. **At compile time**: The source generator discovers `[GenerateStreamId]` attributes and generates a `GetGenerationPolicy` method with type-specific switch arms.

2. **At dispatch time**: The Dispatcher calls `GetGenerationPolicy(message)` to determine if auto-generation should occur:
   - `(ShouldGenerate: true, OnlyIfEmpty: false)` → Generate a StreamId for each new message instance
   - `(ShouldGenerate: true, OnlyIfEmpty: true)` → Generate only if current StreamId is `Guid.Empty`
   - `(ShouldGenerate: false, OnlyIfEmpty: false)` → No auto-generation; guard will throw if StreamId is `Guid.Empty`

3. **After generation**: `StreamIdGuard.ThrowIfEmpty` validates that events with `[StreamId]` have a non-empty StreamId at pipeline boundaries (Dispatcher outbox, consumer inbox, work coordinator queues).

## Validation Guards

Events with `[StreamId]` but without `[GenerateStreamId]` are validated at pipeline boundaries:

- **Dispatcher outbox**: `StreamIdGuard.ThrowIfEmpty` throws `InvalidStreamIdException`
- **Consumer inbox**: Guards at `TransportConsumerWorker` and `ServiceBusConsumerWorker`
- **Work coordinator**: `StreamIdGuard.ThrowIfNonNullEmpty` at queue boundaries

The guard distinguishes between:
- `null` StreamId → OK (event has no stream concept, no `[StreamId]` attribute)
- `Guid.Empty` StreamId → Bug (event has `[StreamId]` but no value was provided or generated)
- Valid Guid → OK

## Relationship to Other Attributes

| Attribute | Purpose |
|---|---|
| `[StreamId]` | Marks which property IS the stream ID |
| `[GenerateStreamId]` | Controls whether the stream ID is AUTO-GENERATED |

`[GenerateStreamId]` requires `[StreamId]` to be present (either on the same property or inherited from a base class).

A message's policy is the one recorded for its exact type
([How a message type finds its stream ID](streamid#how-a-message-type-finds-its-stream-id)), so a derived type's own
`[GenerateStreamId]` is used ahead of its base's
{verified: StreamIdDerivedFirstGeneratorTests.ADerivedTypesOwnGenerationPolicy_IsNotShadowedByTheBaseAsync}. A derived
type that declares its own `[StreamId]` (plain or `Override = true`) but no `[GenerateStreamId]` does not inherit the
base's policy and is not auto-generated; declare `[GenerateStreamId]` on it to auto-generate. A derived type with no
`[StreamId]` of its own inherits the base's stream ID and policy
{verified: StreamIdDerivedFirstGeneratorTests.ADerivedTypeWithItsOwnStreamIdAndNoGenerateStreamId_DoesNotInheritTheBasesGenerateStreamIdAsync, StreamIdDerivedFirstGeneratorTests.ADerivedTypeWithNoStreamIdOfItsOwn_InheritsTheBasesGenerateStreamIdAsync}.

Both hold wherever the base type is compiled: a derived type in another assembly uses its own policy, including the
opt-out, and one with no `[StreamId]` of its own inherits its base's
{verified: StreamIdTypeTableGeneratorTests.ADerivedTypeInAnotherAssemblyWithItsOwnStreamId_UsesItsOwnPropertyAndPolicyAsync, StreamIdTypeTableGeneratorTests.ADerivedTypeInAnotherAssemblyWithNoStreamIdOfItsOwn_InheritsTheBasesAsync}.

## Zero Reflection / AOT

The `[GenerateStreamId]` attribute is fully AOT-compatible:

- Discovery happens at compile time via the source generator
- The policy is read from the generated per-type entry for the message's type (no reflection)
- Generation derives a UUIDv7 from the starting event's id (`GeneratedStreamIdentity`), or mints one with `TrackedGuid.New()` for a command, so ids stay time-ordered and database-friendly

## See Also

- [StreamId Attribute](streamid.md) — Marks the stream ID property
- [Stream ID Concepts](../../fundamentals/events/stream-id.md) — Stream ID concepts and ordering
