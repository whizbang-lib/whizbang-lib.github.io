---
title: Composite Events
version: 1.0.0
category: Messaging
order: 12
description: >-
  Wire-only fan-out optimization — emit one envelope carrying N inner
  events; the receiver expands it before invoking receptors and writing
  the event store. Composite types are never persisted; only the
  expanded inner events are recorded.
tags: 'composite, events, bulk, fan-out, batched-append'
codeReferences:
  - src/Whizbang.Core/Messaging/ICompositeEvent.cs
  - src/Whizbang.Core/Messaging/CompositeEventExpander.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
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

```csharp
public interface ICompositeEvent : IMessage {
  /// Yields the inner events this composite expands into. Receivers
  /// enumerate this exactly once at receive time.
  IEnumerable<IMessage> InnerEvents { get; }

  /// Defensive cap. Producers that accidentally yield 100,000 inner
  /// events from a bug get caught here rather than corrupting the
  /// receiver's batched event-store append. Default 10,000.
  int MaxInnerEventsAllowed => 10_000;
}
```

`ICompositeEvent` extends `IMessage`, so composites flow through the existing dispatcher/outbox/transport surface — no parallel pipeline. The marker is enough; the dispatcher detects it via `payload is ICompositeEvent` and stamps `IsComposite = true` on the resulting `OutboxMessage`. The receiver-side `TransportConsumerWorker` detects the same flag on the `InboxMessage` and triggers expansion.

## Resolved design decisions

| Question | Decision | Rationale |
|---|---|---|
| Failure atomicity | All-or-nothing. If any inner event fails during expansion, the whole composite rolls back. | Simplest; per-inner retry is future work. |
| Inner-event `StreamId` | All inner events inherit the composite's `StreamId`. | Simplest; per-inner producer-supplied override is future work. |
| Ordering | Producer-yielded order (sequential within composite). | Matches single-row outbox storage semantics. |
| Event-store replay | Composite is wire-only; only expanded inner events persist. | Producers can stop emitting a composite type at any time without affecting historical replay. |
| Lifecycle hooks | Fire per-inner-event. | Consistent with "composite is wire-only" — the lifecycle never sees the composite. |

## Receive-side expansion

`CompositeEventExpander.Expand(IMessageEnvelope)` is the non-generic entry point used by the consumer worker (which doesn't know the inner type at compile time). It enumerates `InnerEvents`, validates against `MaxInnerEventsAllowed`, and yields a new `MessageEnvelope<TInnerRuntimeType>` per inner event.

Each inner envelope inherits:

| Field | Behavior |
|---|---|
| `Version`, `DispatchContext`, `SourceServiceId`, `SourceCommitSequence`, `CausedByServiceId`, `CausedByCommitSequence` | Copied from the composite envelope. |
| `Hops` | **Shared by reference**. Composites are received together, audited together; a 5K-inner composite shares one hops list rather than duplicating it 5K times. |
| `MessageId` | Fresh UUIDv7 per inner. Receiver inbox dedup treats each inner event as a distinct message. Reusing the composite's `MessageId` would silently dedup all-but-one inner event on redelivery. |
| `ReceptorInvocations` | Cleared. Each inner event gets independent receptor accounting. |

The composite envelope itself is **never persisted** as an inbox row. The consumer worker generates N inbox rows (one per inner event) which then flow through the normal perspective + receptor machinery.

## Cap enforcement

The expander counts as it iterates. Reaching `MaxInnerEventsAllowed + 1` throws `CompositeInnerEventLimitExceededException` and the partial expansion is discarded — no inner envelopes leak past the failure boundary. The consumer worker catches the exception and dead-letters with `MessageFailureReason.CompositeInnerEventLimitExceeded`.

To raise the cap for a specific composite type, override the property:

```csharp
public class LargeBulkComposite : ICompositeEvent {
  public IEnumerable<IMessage> InnerEvents => /* … */;
  public int MaxInnerEventsAllowed => 50_000;
}
```

## Batched event-store append

For composite expansion at scale (5K inner events), looping `IEventStore.AppendAsync` per inner event would be O(N) round-trips. `IEventStore.AppendBatchAsync<TMessage>` provides a single-call batch entry point:

```csharp
Task AppendBatchAsync<TMessage>(
    IReadOnlyList<(Guid streamId, MessageEnvelope<TMessage> envelope)> entries,
    CancellationToken cancellationToken = default);
```

The default implementation loops `AppendAsync` per entry — correct but slow. Backends MAY override for bulk performance:

| Backend | Bulk strategy |
|---|---|
| EFCore Postgres | `INSERT INTO wh_event_store … SELECT FROM jsonb_array_elements(@payload)` in a single transaction. One fsync per call regardless of entry count. |
| In-memory | Use the default loop — overhead is already zero. |

Atomicity is backend-defined: the default loop is per-item; an overriding backend may use a single transaction for all-or-nothing semantics. The XML doc on the interface flags this so consumers know what to depend on.

## Failure modes

| Failure mode | Reason code | Behavior |
|---|---|---|
| Composite yields more than `MaxInnerEventsAllowed` inner events | `MessageFailureReason.CompositeInnerEventLimitExceeded` | Dead-letter; producer likely has a runaway enumerator. |
| Inner event raises during expansion, or event-store append fails | `MessageFailureReason.CompositeExpansionFailure` | All-or-nothing rollback; no partial inner events recorded. |
