---
title: Composite Events
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Messaging
order: 12
description: >-
  Wire-only fan-out optimization — emit one envelope carrying N inner
  events; the receiver expands it at the dispatch seam before invoking
  receptors and writing the event store. Composite types are never
  persisted in the event store; only the expanded inner events are
  recorded.
tags: 'composite, events, bulk, fan-out, batched-append'
codeReferences:
  - src/Whizbang.Core/Messaging/ICompositeEvent.cs
  - src/Whizbang.Core/Messaging/CompositeEventBase.cs
  - src/Whizbang.Core/Messaging/CompositeInboxFanout.cs
  - src/Whizbang.Core/Messaging/FanoutControl.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/CompositeEventContractTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeEventBaseTests.cs
  - tests/Whizbang.Core.Tests/Messaging/CompositeInboxFanoutTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventStoreAppendBatchTests.cs
  - tests/Whizbang.Core.Tests/Messaging/NoRebroadcastGuardTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerWorkerCompositeNoExpandTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherCompositePublishFanoutTests.cs
---

# Composite Events

A **composite event** is a wire-only optimization for bulk operations that produce many domain events. Instead of emitting N envelopes (one per inner event), the producer emits a single envelope carrying an `IEnumerable<IMessage> InnerEvents`. The receiver expands it into N envelopes inheriting the composite's identity context, then proceeds as if each inner event arrived independently.

Composite types are **never persisted in the event store** — only the expanded inner events. Replay reads inner events back as if no composite existed.

## When to use

Composites pay off when the per-message overhead (network round-trip, broker dispatch, outbox row, inbox row, serialization framing) dominates the actual processing cost. Bulk operations are the canonical case:

- A bulk import producing N `JobCreatedEvent` instances.
- A migration tool that updates N records in a single transactional unit.
- A batch operation that emits one event per affected row.

Use the [body offload feature](/docs/fundamentals/offloads/message-body-store) alongside composites for high inner-event counts — a 5,000-inner-event composite easily exceeds the Azure Service Bus Standard 256 KB ceiling, and the offload path moves the body to blob storage transparently.

## The contract

```csharp{
title: "The ICompositeEvent contract"
description: "Marker interface a composite event implements — yields inner events for receive-side expansion and carries a defensive inner-event cap."
framework: "NET10"
category: "Messaging"
difficulty: "INTERMEDIATE"
tags: ["composite-events", "icompositeevent", "contract", "bulk-operations"]
tests: ["CompositeEventBaseTests.StampsStreamId_AndYieldsInnerInProducerOrderAsync", "CompositeEventBaseTests.MaxInnerEventsAllowed_DefaultsTo10K_AndIsOverridableAsync"]
}
public interface ICompositeEvent : IMessage {
  /// Yields the inner events this composite expands into. Receivers
  /// enumerate this exactly once at receive time, in producer-yielded order.
  IEnumerable<IMessage> InnerEvents { get; }

  /// Defensive cap. Producers that accidentally yield 100,000 inner
  /// events from a bug get caught here rather than corrupting the
  /// receiver's batched event-store append. Default 10,000.
  int MaxInnerEventsAllowed => 10_000;

  /// How fan-out is triggered. Auto (default) fans out InnerEvents
  /// automatically at the dispatch seam; Manual defers to a pre-fanout
  /// receptor that drives fan-out via DispatchFanoutControl.
  FanoutMode FanoutMode => FanoutMode.Auto;

  /// Per-child failure policy. Independent (default) drops a child that
  /// fails to serialize and fans out the rest; Atomic dead-letters the
  /// whole composite on any child failure (all-or-nothing).
  FanoutAtomicity Atomicity => FanoutAtomicity.Independent;
}
```

`ICompositeEvent` extends `IMessage`, so composites flow through the existing dispatcher/outbox/transport surface — no parallel pipeline. The marker is enough; the builders detect it via `payload is ICompositeEvent` and stamp `EventFlags.Composite` on the envelope. A convenience base class, `CompositeEventBase`, implements the interface with sensible defaults. On the receiver, the composite arrives as an **ordinary inbox row**; `InboxDispatchWorker` detects the composite payload at the dispatch seam and triggers fan-out — `TransportConsumerWorker` deliberately does **not** expand composites.

## Resolved design decisions

| Question | Decision | Rationale |
|---|---|---|
| Failure atomicity | Configurable via `Atomicity`: `Independent` (default) drops a failed child and fans out the rest; `Atomic` dead-letters the whole composite on any child failure. A cap breach always dead-letters the whole composite. | Bulk imports usually prefer partial progress; opt into all-or-nothing per type. |
| Inner-event `StreamId` | All inner events inherit the composite's `StreamId`. | Simplest; producers needing per-inner stream IDs emit separate envelopes. |
| Ordering | Producer-yielded order (sequential within composite). | Matches single-row outbox storage semantics. |
| Event-store replay | Composite is wire-only for the event store; only expanded inner events persist. | Producers can stop emitting a composite type at any time without affecting historical replay. |
| Lifecycle hooks | The composite is dispatchable and hookable: a pre-fanout `IReceptor<TComposite>` fires before any child exists; after fan-out the per-inner-event lifecycle runs normally. | Lets a receptor validate, transform, or veto fan-out; downstream sees only children. |

## Dispatch-seam fan-out

`CompositeInboxFanout.TryExpand(composite, sourceEnvelope, scope)` is the fan-out entry point used by `InboxDispatchWorker`. It enumerates `InnerEvents`, validates against `MaxInnerEventsAllowed`, and builds one child `InboxMessage` per inner event (each wrapped in a concrete `MessageEnvelope<IMessage>` — no runtime reflection on this path). The handler-commit path stores the children while deleting the composite row.

Each child envelope inherits:

| Field | Behavior |
|---|---|
| `Version`, `DispatchContext`, `SourceServiceId`, `SourceCommitSequence`, `CausedByServiceId`, `CausedByCommitSequence` | Copied from the composite envelope. |
| `Hops` | A composite-lineage hop chain: one fresh creation hop pointing back to the composite (`CausationId` = composite `MessageId`, `CausationType` = composite type name) followed by the composite's own hops. Built once and **shared by reference** across all children — no per-child duplication for a 5K-inner composite. |
| `MessageId` | Fresh per child. Receiver inbox dedup treats each inner event as a distinct message. Reusing the composite's `MessageId` would silently dedup all-but-one inner event on redelivery. |
| `Flags` | Stamped `EventFlags.NoRebroadcast`: children are confined to the inbox → event-store → local-processing path and are never re-published to the outbox (the composite already crossed the wire). |

Before fan-out, any registered pre-fanout receptor (`IReceptor<TComposite>`) fires. It can impose a `FanoutDirective` via `DispatchFanoutControl` — `Proceed`, `Skip`, or `ReplaceWith(children)` — which takes precedence over the composite's declarative `FanoutMode`. With `FanoutMode.Manual` and no directive, no automatic fan-out occurs.

## Cap enforcement

The fan-out counts as it iterates. Reaching `MaxInnerEventsAllowed + 1` returns `FanoutOutcome.CapExceeded` and the partial expansion is discarded — no child inbox rows leak past the failure boundary. `InboxDispatchWorker` dead-letters the composite with `MessageFailureReason.CompositeInnerEventLimitExceeded`. Cap breaches are treated as producer bugs (runaway enumerator), so the whole composite dead-letters regardless of the `Atomicity` setting.

To raise the cap for a specific composite type, override the property:

```csharp{
title: "Raise the inner-event cap for a specific composite type"
description: "Overrides MaxInnerEventsAllowed on one composite class to permit larger expansions without changing the global default."
framework: "NET10"
category: "Messaging"
difficulty: "BEGINNER"
tags: ["composite-events", "max-inner-events", "cap-override"]
tests: ["CompositeEventBaseTests.MaxInnerEventsAllowed_DefaultsTo10K_AndIsOverridableAsync"]
}
public class LargeBulkComposite : ICompositeEvent {
  public IEnumerable<IMessage> InnerEvents => /* … */;
  public int MaxInnerEventsAllowed => 50_000;
}
```

## Batched event-store append

For composite expansion at scale (5K inner events), looping `IEventStore.AppendAsync` per inner event would be O(N) round-trips. `IEventStore.AppendBatchAsync<TMessage>` provides a single-call batch entry point:

```csharp{
title: "IEventStore.AppendBatchAsync batch append signature"
description: "Single-call batch entry point that lets backends persist a composite's expanded inner events without O(N) per-event round-trips."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["composite-events", "event-store", "batch-append", "performance"]
unverified: "verified by EventStoreAppendBatchTests, which is outside the current coverage map"
}
Task AppendBatchAsync<TMessage>(
    IReadOnlyList<(Guid streamId, MessageEnvelope<TMessage> envelope)> entries,
    CancellationToken cancellationToken = default);
```

The default implementation loops `AppendAsync` per entry — correct but slow. Backends MAY override for bulk performance (as of this commit no backend overrides it yet; the interface XML docs sketch the intended EFCore Postgres bulk strategy — `INSERT INTO wh_event_store … SELECT FROM jsonb_array_elements(@payload)` in a single transaction — as follow-up work).

Atomicity is backend-defined: the default loop is per-item; an overriding backend may use a single transaction for all-or-nothing semantics. The XML doc on the interface flags this so consumers know what to depend on.

## Failure modes

| Failure mode | Reason code | Behavior |
|---|---|---|
| Composite yields more than `MaxInnerEventsAllowed` inner events | `MessageFailureReason.CompositeInnerEventLimitExceeded` | Dead-letter the whole composite (regardless of `Atomicity`); producer likely has a runaway enumerator. |
| Child is null or fails to serialize during fan-out | `Atomicity == Independent` (default): child is dropped, the rest fan out. `Atomicity == Atomic`: `MessageFailureReason.CompositeExpansionFailure` | Under `Atomic`, all-or-nothing — the whole composite dead-letters and no partial children are recorded. |
