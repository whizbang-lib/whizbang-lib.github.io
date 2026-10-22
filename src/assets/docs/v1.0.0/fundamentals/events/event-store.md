---
title: "Event Store"
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: "Core Concepts"
order: 9
description: >-
  The IEventStore interface provides append-only event storage for event sourcing in Whizbang.
  Supports stream-based storage with automatic sequence numbering, polymorphic reads,
  and synchronous verification via AppendAndWaitAsync.
tags: 'event-store, event-sourcing, append-only, streams, IEventStore, persistence'
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Messaging/AppendAndWaitEventStoreDecorator.cs
  - src/Whizbang.Core/Messaging/SecurityContextEventStoreDecorator.cs
  - src/Whizbang.Core/Messaging/SyncTrackingEventStoreDecorator.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPostgresEventStore.cs
  - src/Whizbang.Data.Postgres/Migrations/224_DirectAppendTakesTheStreamLock.sql
  - src/Whizbang.Data.Postgres/Migrations/227_ReceivedStreamsKeepTheProducersOrder.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ReceivedStreamOrderSqlTests.cs
  - tests/Whizbang.Core.Tests/Messaging/AppendAndWaitEventStoreDecoratorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/SecurityContextEventStoreDecoratorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/SyncTrackingEventStoreDecoratorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EventStoreSyncTrackingIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStoreTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventStoreAppendBatchTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EventStoreConcurrentAppendTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/BranchCoverage/EFCore/EventStoreAppendFailureTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPostgresEventStore.RetryTests.cs
lastMaintainedCommit: '01f07906'
---

# Event Store

The `IEventStore` interface provides append-only event storage for event sourcing patterns. It supports stream-based storage with automatic sequence numbering, polymorphic reads, and synchronous verification via `AppendAndWaitAsync`.

## Overview

Whizbang's event store is designed for:

- **Append-only storage** - Events are immutable once written
- **Stream-based organization** - Events grouped by aggregate ID
- **Polymorphic reads** - Read multiple event types from a stream
- **AOT compatibility** - Generic methods avoid reflection
- **Sync verification** - Wait for perspectives to process events

## Basic Usage

### Appending Events

```csharp{title="Appending Events" description="Appending Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "C#", "Appending"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "EFCoreEventStoreTests.AppendAsync_WithRawMessage_CreatesEnvelopeAndAppendsAsync"]}
public class OrderHandler {
  private readonly IEventStore _eventStore;

  public async Task CreateOrder(CreateOrderCommand cmd) {
    var orderId = Guid.NewGuid();
    var evt = new OrderCreatedEvent(orderId, cmd.CustomerId, cmd.Items);

    // Append to stream identified by orderId
    await _eventStore.AppendAsync(orderId, evt);
  }
}
```

### Reading Events

```csharp{title="Reading Events" description="Reading Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "C#", "Reading"] tests=["EFCoreEventStoreTests.ReadAsync_WithExistingEvents_ReturnsEventsInSequenceOrderAsync", "InMemoryEventStoreTests.ReadAsync_ByEventId_WithSpecificEventId_ShouldReturnEventsAfterItAsync"]}
// Read all events of a specific type
await foreach (var envelope in _eventStore.ReadAsync<OrderCreatedEvent>(orderId, fromSequence: 0)) {
  var evt = envelope.Payload;
  // Process event
}

// Read from a specific event ID
await foreach (var envelope in _eventStore.ReadAsync<OrderEvent>(orderId, fromEventId: lastProcessedId)) {
  // Process events after the checkpoint
}
```

## Appending and concurrency {#appending-and-concurrency}

{verified: EventStoreConcurrentAppendTests.ParallelAppendsToOneStream_AllSucceed_WithVersionsZeroToNMinusOneAsync, EventStoreConcurrentAppendTests.ADirectAppend_WaitsForTheEmitChainsStreamLockAsync, DapperPostgresEventStoreRetryTests.AppendAsync_ParallelAppendsToOneStream_AllSucceedWithVersionsZeroToNMinusOneAsync}

On PostgreSQL, both drivers append through one database function, `wh_append_event`. It takes the stream's advisory lock (the same lock the outbox and inbox emit paths take for that stream) and only then reads the stream's last version and inserts the next one. The version is assigned by the database, so any number of writers can append to one stream at the same moment: they wait their turn and get consecutive versions. None fails with a version conflict, and none retries. A stream written by many instances at once, such as the global system-event stream, needs nothing special.

| Situation | What happens | Verified |
|---|---|---|
| Many writers append to one stream at once | Each waits for the stream's lock; versions are 0, 1, 2, ... with no gap or duplicate | {verified: EventStoreConcurrentAppendTests.ParallelAppendsToOneStream_AllSucceed_WithVersionsZeroToNMinusOneAsync, DapperPostgresEventStoreRetryTests.AppendAsync_ParallelAppendsToOneStream_AllSucceedWithVersionsZeroToNMinusOneAsync} |
| An outbox or inbox emit holds the same stream | The direct append waits, then numbers after the emitted events | {verified: EventStoreConcurrentAppendTests.ADirectAppend_WaitsForTheEmitChainsStreamLockAsync} |
| The caller has an open transaction (EF Core) | The append runs in it and the lock is held until it ends; a rollback removes the event | {verified: EventStoreConcurrentAppendTests.TheAppend_JoinsTheCallersTransactionAsync} |
| The context has other pending changes (EF Core) | They are saved first, as an append always did | {verified: EventStoreConcurrentAppendTests.PendingTrackedChanges_AreStillSavedByTheAppendAsync} |
| The same event id is appended twice | Fails at once with `InvalidOperationException` saying an event with this id is already stored; not retried | {verified: EventStoreAppendFailureTests.Append_RealDuplicateEventId_IsReportedAsADuplicateEvent_NotARaceAsync, DapperPostgresEventStoreRetryTests.AppendAsync_DuplicateEventId_FailsClearly_WithoutRetryingAsync} |

The lock and the insert are separate statements inside the function on purpose: under PostgreSQL's default `READ COMMITTED` isolation each statement sees what was committed before it started, so the insert sees every append that committed while this one waited. Appending inside a `REPEATABLE READ` or `SERIALIZABLE` transaction keeps the snapshot from before the wait and can still fail on the stream's unique version; use the default isolation for transactions that append.

A stream appended directly numbers its events from 0. A stream whose events arrive through the outbox numbers them from 1.

## Received streams keep the producer's order {#received-stream-order}

{verified: ReceivedStreamOrderSqlTests.TwoClaimsOfOneStream_TheHeadsClaimCommitsLast_VersionsFollowTheProducerOrderAsync, ReceivedStreamOrderSqlTests.TwoInstancesShareAStream_TheTailWaitsForThePeersHead_ThenFollowsItAsync, ReceivedStreamOrderSqlTests.RowsBeforeTheFirstUnheldRow_AreStored_AndOnlyTheRowsAfterItWaitAsync, ReceivedStreamOrderSqlTests.AnEarlierCommand_OrAnEarlierEventAlreadyStored_DoesNotHoldTheStreamAsync, ReceivedStreamOrderSqlTests.AWaitingEvent_IsNotFetched_UntilItIsStoredAsync}

A service that receives another service's events stores them through its inbox. Its inbox can split one source stream across several claims at once. That happens when two batches overlap, or when two instances each lease part of a stream. A claim that started later can skip the rows an earlier claim holds and reach the store first.

The receiver still stores the stream in the producer's order, whichever claim commits first:

- **The head is stored first.** For each stream in its batch, a claim finds the first pending event it does not hold itself. That event may be leased by a peer, held by another claim that has not committed, unleased, or under an expired lease. The claim stores its rows that come before that event and **holds back** the rows after it.
- **Held-back rows follow the head.** They stay leased but are not stored, and a later claim stores them once the head is in the store. A stream's head never waits.
- **An event is only handed to receptors once it is stored.** An event waiting behind its head is not dispatched. Dispatch completes an inbox row and removes it, so dispatching a waiting event would lose it from the store. Commands, and rows that have no stream, are not held.

Order means message id, which is also what versions are numbered by. An event that fans out of a composite gets an id built from the composite's id and its position, so the children sort in the producer's order even though they carry no origin commit sequence.

| Situation | What happens | Verified |
|---|---|---|
| Two claims split one stream, and the claim with the head commits last | The later events wait; the stream is stored in the producer's order | {verified: ReceivedStreamOrderSqlTests.TwoClaimsOfOneStream_TheHeadsClaimCommitsLast_VersionsFollowTheProducerOrderAsync} |
| Another instance holds the stream's head | The tail waits for the peer to store the head, then follows it | {verified: ReceivedStreamOrderSqlTests.TwoInstancesShareAStream_TheTailWaitsForThePeersHead_ThenFollowsItAsync} |
| A claim holds rows on both sides of an event it does not hold | The rows before it are stored now; only the rows after it wait | {verified: ReceivedStreamOrderSqlTests.RowsBeforeTheFirstUnheldRow_AreStored_AndOnlyTheRowsAfterItWaitAsync} |
| The earlier row is a command, or an event already stored | Nothing waits | {verified: ReceivedStreamOrderSqlTests.AnEarlierCommand_OrAnEarlierEventAlreadyStored_DoesNotHoldTheStreamAsync} |
| An event is waiting behind its head | It is not fetched for dispatch until it is stored | {verified: ReceivedStreamOrderSqlTests.AWaitingEvent_IsNotFetched_UntilItIsStoredAsync} |

**What it does not cover:**

- **An event that has not reached the inbox yet.** If the transport reorders separate deliveries, the receiver can store later events before an earlier one arrives, because there is no row to wait for. Waiting out that gap needs the producer's stream position on the wire ([#1627](https://github.com/whizbang-lib/whizbang/issues/1627)).
- **Ids minted out of commit order.** When a producer has two transactions on one stream whose ids were minted in the opposite order to their commits, message-id order can differ from the producer's version order.

**Cost of waiting.** A row that waits longer than its lease (300 seconds by default) is claimed again, which spends an attempt ([#1630](https://github.com/whizbang-lib/whizbang/issues/1630)).

### Repairing a stream stored before the fix {#received-stream-repair}

Before this, a receiver could store a stream with a later event ahead of an earlier one, for example a record's creation after its field changes. A rebuild does not repair such a stream: replay follows the stored version, and origin order is only used when every event has an origin commit sequence, which fanned-out events do not.

Re-delivering the events does not help either. The receiver skips an event id it already has.

The producer's order can be recovered from the event ids. For a stream the producer wrote in one transaction, event-id order is the producer's order. To repair such a stream:

1. Under the stream's lock, renumber its versions by event id. Do it in two steps, first negative versions and then `ROW_NUMBER() OVER (ORDER BY event_id)`, because `(stream_id, version)` is unique.
2. Rebuild or rewind the stream's perspectives.

This is only sound for a stream with a single origin. Whether W! ships it as a tool is an open question ([#1629](https://github.com/whizbang-lib/whizbang/issues/1629)).

## AppendAndWaitAsync {#append-and-wait}

The `AppendAndWaitAsync` method appends an event and waits for a perspective to process it. This enables synchronous-feeling APIs over event sourcing.

### AppendAndWaitEventStoreDecorator

The `AppendAndWaitAsync` functionality is provided by the `AppendAndWaitEventStoreDecorator`, which wraps the base event store implementation. This decorator:

- **Waits for a specific perspective** via `IPerspectiveSyncAwaiter`
- **Waits for ALL perspectives** via `IEventCompletionAwaiter` (single-type-parameter overload)
- **Times out gracefully** if perspective processing takes too long
- **Returns sync results** with timing and event count details

The decorator is automatically applied when using `DecorateEventStoreWithSyncTracking()`, which is called by data providers during registration.

### Usage

```csharp{title="Usage" description="Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Usage"] tests=["AppendAndWaitEventStoreDecoratorTests.AppendAndWaitAsync_WaitsForPerspectiveSyncAsync", "AppendAndWaitEventStoreDecoratorTests.AppendAndWaitAsync_AppendsEventToInnerStoreAsync", "AppendAndWaitEventStoreDecoratorTests.AppendAndWaitAsync_UsesProvidedTimeoutAsync"]}
var syncResult = await _eventStore.AppendAndWaitAsync<OrderCreatedEvent, OrderProjection>(
    streamId: orderId,
    message: new OrderCreatedEvent(orderId, customerId, items),
    timeout: TimeSpan.FromSeconds(10));

// Event has been appended AND OrderProjection has processed it
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `streamId` | `Guid` | The stream/aggregate ID |
| `message` | `TMessage` | The event to append |
| `timeout` | `TimeSpan?` | Maximum wait time (default: 30 seconds) |
| `onWaiting` | `Action<SyncWaitingContext>?` | Optional callback invoked when waiting begins (only if there are events to wait for) |
| `onDecisionMade` | `Action<SyncDecisionContext>?` | Optional callback always invoked when the sync decision is made, regardless of outcome |
| `cancellationToken` | `CancellationToken` | Cancellation token |

### Waiting for All Perspectives {#append-and-wait-all}

The single-type-parameter overload `AppendAndWaitAsync<TMessage>` waits for **all** registered perspectives to process the event, rather than a specific one:

```csharp{title="Wait for All Perspectives" description="Append and wait for all perspectives to process" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "AppendAndWait", "All"] unverified="Single-parameter all-perspectives AppendAndWaitAsync overload; its coverage lives in AppendAndWaitEventStoreDecoratorCallbackTests, not this page's referenced tests"}
var syncResult = await _eventStore.AppendAndWaitAsync(
    streamId: orderId,
    message: new OrderCreatedEvent(orderId, customerId, items),
    timeout: TimeSpan.FromSeconds(10));

// Event has been appended AND all perspectives have processed it
```

This uses `IEventCompletionAwaiter` internally to wait for all perspectives.

### SyncResult

Returns a `SyncResult` with the outcome:

```csharp{title="SyncResult" description="Returns a SyncResult with the outcome:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "SyncResult"] tests=["AppendAndWaitEventStoreDecoratorTests.AppendAndWaitAsync_WaitsForPerspectiveSyncAsync", "AppendAndWaitEventStoreDecoratorTests.AppendAndWaitAsync_WhenTimeoutOccurs_ReturnsTimedOutResultAsync"]}
var result = await eventStore.AppendAndWaitAsync<OrderCreatedEvent, OrderProjection>(
    streamId, evt);

switch (result.Outcome) {
  case SyncOutcome.Synced:
    Console.WriteLine($"Synced {result.EventsAwaited} events in {result.ElapsedTime}");
    break;
  case SyncOutcome.TimedOut:
    Console.WriteLine("Event appended but perspective sync timed out");
    break;
  case SyncOutcome.NoPendingEvents:
    Console.WriteLine("No events to process");
    break;
}
```

### When to Use

Use `AppendAndWaitAsync` when:

- You need to verify a specific projection processed an event before returning
- Implementing request-response patterns over event sourcing
- Building APIs that need immediate consistency with a particular read model

For higher-level patterns that wait for ALL perspectives, see [LocalInvokeAndSyncAsync](../dispatcher/dispatch-patterns.md#local-invoke-and-sync).

## Security Context Propagation

When appending events with the message-only overload (`AppendAsync<TMessage>(streamId, message)`), the event store automatically propagates security context from the ambient scope.

This happens via the `SecurityContextEventStoreDecorator`:

```csharp{title="Security Context Propagation" description="This happens via the SecurityContextEventStoreDecorator:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Security", "Context"] tests=["SecurityContextEventStoreDecoratorTests.AppendAsync_WithMessage_WithAmbientSecurityContext_PropagatesContextAsync"]}
// Security context from ScopeContextAccessor.CurrentContext is auto-propagated
await _eventStore.AppendAsync(orderId, new OrderCreatedEvent(...));

// The envelope will contain SecurityContext with UserId and TenantId
```

This ensures:
- **Audit trails** - Events record who performed the action
- **Multi-tenancy** - Events are tagged with tenant ID
- **Traceability** - Security context flows through the event chain

### When Context is Propagated

Security context is propagated when:
1. `ScopeContextAccessor.CurrentContext` contains an `ImmutableScopeContext`
2. The context has `ShouldPropagate = true`

```csharp{title="When Context is Propagated" description="Security context is propagated when: 1." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "When", "Context"] tests=["SecurityContextEventStoreDecoratorTests.AppendAsync_WithMessage_WithAmbientSecurityContext_PropagatesContextAsync", "SecurityContextEventStoreDecoratorTests.AppendAsync_WithMessage_WithNonPropagatingContext_DoesNotPropagateAsync"]}
// Context is set by middleware or scope initialization
var extraction = new SecurityExtraction {
  Scope = new PerspectiveScope { UserId = "user-123", TenantId = "tenant-456" },
  // ...
};
ScopeContextAccessor.CurrentContext = new ImmutableScopeContext(extraction, shouldPropagate: true);

// Events now include this security context
await _eventStore.AppendAsync(orderId, evt);
```

## IEventStore Interface

```csharp{title="IEventStore Interface" description="IEventStore Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "IEventStore", "Interface"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "EFCoreEventStoreTests.AppendAsync_WithValidEnvelope_AppendsEventToStreamAsync", "InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync", "EFCoreEventStoreTests.GetLastSequenceAsync_WithExistingEvents_ReturnsHighestSequenceAsync", "AppendAndWaitEventStoreDecoratorTests.AppendAndWaitAsync_WaitsForPerspectiveSyncAsync"]}
public interface IEventStore {
  // Append with envelope (full control)
  Task AppendAsync<TMessage>(Guid streamId, MessageEnvelope<TMessage> envelope, CancellationToken ct = default);

  // Append with message (auto-creates envelope with security context)
  Task AppendAsync<TMessage>(Guid streamId, TMessage message, CancellationToken ct = default)
      where TMessage : notnull;

  // Append and wait for specific perspective sync
  Task<SyncResult> AppendAndWaitAsync<TMessage, TPerspective>(
      Guid streamId, TMessage message, TimeSpan? timeout = null,
      Action<SyncWaitingContext>? onWaiting = null,
      Action<SyncDecisionContext>? onDecisionMade = null,
      CancellationToken ct = default)
      where TMessage : notnull
      where TPerspective : class;

  // Append and wait for ALL perspectives to process
  Task<SyncResult> AppendAndWaitAsync<TMessage>(
      Guid streamId, TMessage message, TimeSpan? timeout = null,
      Action<SyncWaitingContext>? onWaiting = null,
      Action<SyncDecisionContext>? onDecisionMade = null,
      CancellationToken ct = default)
      where TMessage : notnull;

  // Read by sequence number
  IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(
      Guid streamId, long fromSequence, CancellationToken ct = default);

  // Read after event ID (checkpoint-based)
  IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(
      Guid streamId, Guid? fromEventId, CancellationToken ct = default);

  // Read multiple event types
  IAsyncEnumerable<MessageEnvelope<IEvent>> ReadPolymorphicAsync(
      Guid streamId, Guid? fromEventId, IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

  // Get events between checkpoints (single type)
  Task<List<MessageEnvelope<TMessage>>> GetEventsBetweenAsync<TMessage>(
      Guid streamId, Guid? afterEventId, Guid upToEventId, CancellationToken ct = default);

  // Get events between checkpoints (polymorphic - multiple event types)
  Task<List<MessageEnvelope<IEvent>>> GetEventsBetweenPolymorphicAsync(
      Guid streamId, Guid? afterEventId, Guid upToEventId,
      IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

  // Get last sequence number (-1 if the stream is empty)
  Task<long> GetLastSequenceAsync(Guid streamId, CancellationToken ct = default);

  // Batch append across (potentially different) streams.
  // Default implementation loops AppendAsync serially; backends override for bulk performance.
  Task AppendBatchAsync<TMessage>(
      IReadOnlyList<(Guid streamId, MessageEnvelope<TMessage> envelope)> entries,
      CancellationToken ct = default);

  // Resolve the commit_sequence stamped on an event (null if not stamped / not tracked)
  Task<long?> GetCommitSequenceAsync(Guid eventId, CancellationToken ct = default);

  // Deserialize raw stream event data (drain mode) into typed envelopes
  List<MessageEnvelope<IEvent>> DeserializeStreamEvents(
      IReadOnlyList<StreamEventData> streamEvents,
      IReadOnlyList<Type> eventTypes);
}
```

### Read order {#read-order}

{verified: DapperPostgresEventStoreEdgeCaseTests.ReadPolymorphicAsync_IdsAndCommitsRunBackwardToVersions_ReadsInStreamOrderAsync, EventStoreReadPolymorphicTests.ReadPolymorphicAsync_WhenCommitSequencesRunBackward_ReturnsEventsInStreamOrderAsync, EventStoreReadPolymorphicTests.ReadPolymorphicAsync_CarriesEachEventsStreamVersionAsync, InMemoryEventStoreReplayOrderTests.ReadPolymorphicAsync_IdsRunBackwardToAppends_ReturnsTheStreamInAppendOrderAsync}

`ReadPolymorphicAsync` reads a stream in its own order: the `version` each event was appended at, `event_id`
breaking ties, and each envelope carries that version as `MessageEnvelope.LocalStreamVersion` (read-time, not
serialized). The EF Core, Dapper Postgres and in-memory stores all read it that way, so a replay applies a stream
in the order it was written.

Neither of the other two orders will do:

- **Event id.** An id is minted before the event is stored, so two producers can append in the opposite order to
  their ids, and reading by id would replay them backward.
- **Commit sequence.** It records when the stamper reached a row, not where the row sits in its stream. Rows
  stamped as they were written follow their versions, but rows stamped after the fact can run backward against
  them, and a replay in that order folded a stream's last write first.

The typed `ReadAsync` and the between-checkpoint reads keep `event_id` order.

## Decorator Stack

Whizbang applies decorators to enhance event store functionality:

```mermaid{caption="Event store decorator stack — your IEventStore call passes through AppendAndWait, SecurityContext, SyncTracking, and Upcasting decorators before reaching the base store."}
graph TB
    A["IEventStore (your code calls this)"]
    B["AppendAndWaitEventStoreDecorator (enables AppendAndWaitAsync)"]
    C["SecurityContextEventStoreDecorator (turns a message into an envelope with the security context)"]
    D["SyncTrackingEventStoreDecorator (tracks the id of the envelope the store writes)"]
    E["UpcastingEventStoreDecorator (transforms stored events on read)"]
    F["Base IEventStore (e.g., EFCoreEventStore, DapperEventStore)"]

    A --> B --> C --> D --> E --> F

    style A fill:#d4edda,stroke:#28a745
    style F fill:#fff3cd,stroke:#ffc107
```

The upcasting layer only participates when upcasters are registered — see [Event Upcasting](event-upcasting.md).

Sync tracking sits inside the security-context layer on purpose. Appending a bare message, the security-context layer builds the envelope the store writes, and the tracker records that envelope's id, so a perspective sync waits on the id that was actually stored.

These decorators are automatically applied when using `DecorateEventStoreWithSyncTracking()`, which is called by data providers.

## Registration

Event stores are registered by data providers:

```csharp{title="Registration" description="Event stores are registered by data providers:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Registration"] unverified="DI registration / provider wiring — configures the EFCoreEventStore + decorator stack, not an event-store behavior exercised by these tests"}
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres;  // Registers EFCoreEventStore with decorators
```

The decorators are applied automatically by `DecorateEventStoreWithSyncTracking()`.

## Related Documentation

- [Dispatcher](../dispatcher/dispatch-patterns.md#local-invoke-and-sync) - LocalInvokeAndSyncAsync for request-response patterns
- [Perspectives](../perspectives/perspectives.md) - Read model projections
- [Event Store Query](./event-store-query) - Querying events
- [Message Security](../security/message-security.md) - Security context
