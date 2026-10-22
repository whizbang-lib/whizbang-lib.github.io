---
title: 'WHIZ133: Stream mixes ephemeral and Sourced events'
pageType: troubleshooting
verifiedAgainstCommit: a7c4e090
verifiedDate: 2026-10-22
description: >-
  Runtime refusal when storing an event would make one stream hold both ephemeral and Sourced events. A write its
  caller awaits fails with MixedStreamEventException; any other write dead-letters the refused event and stores the
  rest.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - ephemeral
  - event-sourcing
  - streams
  - dead-letter-queue
  - runtime-guard
codeReferences:
  - src/Whizbang.Core/Messaging/MixedStreamEventException.cs
  - src/Whizbang.Core/Messaging/MessageFailureReason.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorFlushHelper.cs
  - src/Whizbang.Core/Messaging/DeadLetterRecoveryTypes.cs
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
  - src/Whizbang.Data.Postgres/MixedStreamRefusal.cs
  - src/Whizbang.Data.Postgres/DirectAppendKind.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPostgresEventStore.cs
  - src/Whizbang.Data.Postgres/Migrations/226_StreamsNeverMixEphemeralAndSourcedEvents.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MixedStreamGuardSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperMixedStreamGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DirectAppendMixedStreamGuardTests.cs
  - tests/Whizbang.Core.Tests/Messaging/MixedStreamRefusalTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorFlushHelperTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/WorkTablesAreLockedInOneOrderTests.CallGraph.cs
lastMaintainedCommit: 'a7c4e090'
---

# WHIZ133: Stream mixes ephemeral and Sourced events

**Severity**: Error (runtime)
**Category**: Ephemeral Events

## Description

An event was refused because storing it would make its stream hold both **ephemeral** and **Sourced** (ordinary,
event-sourced) events.

One ephemeral event marks its whole stream *state-based*: the stream's current state, not its log, is the source of
truth. Every rebuild and rewind then skips the stream, so a Sourced event on it would be silently left out of every
replay, and an ephemeral event on a Sourced stream would hide that stream's whole history from rebuilds. A stream
therefore never mixes the two kinds. The rule holds in either order and there is no opt-in.

Which events reach a stream is only known when they are stored, so this is checked at run time, not by the build, on
every path that stores an event: the step that copies outbox and inbox events into the event store, and a direct
`IEventStore.AppendAsync` on either driver. Each compares the event's kind with the kind its stream already holds,
read from the stream's newest stored event. A stream with nothing stored yet takes the kind of its
first event in the write, so a first write that mixes both kinds keeps the first event's kind and refuses the others.
{verified: MixedStreamGuardSqlTests.Store_SourcedEventOnAnEphemeralStream_DeadLettersTheSourcedEventAsync, MixedStreamGuardSqlTests.Store_EphemeralEventOnASourcedStream_DeadLettersTheEphemeralEventAsync, MixedStreamGuardSqlTests.Store_FirstWriteMixesBothKinds_KeepsTheFirstKindAndDeadLettersTheOtherAsync}

Only the ephemeral flag decides the kind. A compaction origin (the `Compacted` event a stream compaction writes at the
head of a stream) is neither kind: it is never refused and never decides the stream's kind, so a compacted stream
keeps taking the kind of the events around it. A Sourced stream with a carry-forward head keeps receiving Sourced
events, and an ephemeral stream that was compacted keeps receiving ephemeral events.
{verified: MixedStreamGuardSqlTests.Store_SourcedEventOnACompactedStream_IsStoredAsync, DirectAppendMixedStreamGuardTests.DirectAppend_CompactionOriginOnAnEphemeralStream_IsStored_AndTheStreamStaysEphemeralAsync}

## What happens to the refused event

What "refused" means depends on whether anyone is waiting for the write:

| Write | Result | Verified |
|-------|--------|----------|
| A direct append: `IEventStore.AppendAsync` on the EF Core and Dapper drivers | Throws `MixedStreamEventException` and stores nothing. The appended event's kind is stored with it, as the other paths store it, including `[Ephemeral]` declared on a type. | {verified: DirectAppendMixedStreamGuardTests.DirectAppend_SourcedEventOnAnEphemeralStream_ThrowsAndStoresNothingAsync, DirectAppendMixedStreamGuardTests.DirectAppend_EphemeralEventOnASourcedStream_ThrowsAsync, DirectAppendMixedStreamGuardTests.DirectAppend_EventTheResolverDeclaresEphemeral_IsRefusedOnASourcedStreamAsync, DapperMixedStreamGuardTests.AppendAsync_SourcedEventOnAnEphemeralStream_ThrowsAndStoresNothingAsync, DapperMixedStreamGuardTests.AppendAsync_EphemeralEventOnASourcedStream_ThrowsAndStoresNothingAsync} |
| A flush its caller awaits: the immediate and scoped strategies' `FlushAsync`, which the dispatcher awaits when publishing | Throws `MixedStreamEventException`. The whole write rolls back and nothing of it is kept, including events on other streams, and the strategy does not offer it to a later flush. | {verified: MixedStreamGuardSqlTests.Store_DirectCommitOfASourcedEventOnAnEphemeralStream_ThrowsMixedStreamEventExceptionAsync, MixedStreamGuardSqlTests.Store_DirectCommitOfAnEphemeralEventOnASourcedStream_ThrowsMixedStreamEventExceptionAsync, ImmediateWorkCoordinatorStrategyTests.FlushAsync_RefusedForMixingAStream_TheNextFlushDoesNotWriteTheRefusedWorkAsync, ScopedWorkCoordinatorStrategyTests.FlushAsync_RefusedForMixingAStream_DisposalDoesNotWriteTheRefusedWorkAsync} |
| Every other write: the interval and batch strategies, the scoped strategy's disposal safety net, handler commits and the inbox claim | Dead-letters only the refused row and stores the rest of the write. A refused outbox row is moved to the dead-letter table, so it is never published. A refused inbox row is recorded in the dead-letter table and completed where it stands, so it is never applied or offered again; it leaves the inbox with the other completed rows at the next maintenance pass, and a redelivery of it is deduplicated. | {verified: MixedStreamGuardSqlTests.Store_RefusedEventInABatch_LeavesTheOtherStreamsStoredAsync, MixedStreamGuardSqlTests.CommitHandlerResult_HandlerEmitsASourcedEventOnAnEphemeralStream_CommitsAndDeadLettersTheEventAsync, MixedStreamGuardSqlTests.InboxChain_SourcedEventOnAnEphemeralStream_DeadLettersTheRowAndStoresTheRestAsync, MixedStreamGuardSqlTests.InboxChain_RefusedMessageRedelivered_IsNotRefusedAgainAsync, MixedStreamGuardSqlTests.InboxChain_RefusedRow_IsRemovedByTheCompletedInboxPurgeAsync, ScopedWorkCoordinatorStrategyTests.DisposeAsync_SafetyNetFlush_LeavesARefusalToBeDeadLetteredAsync} |

A dead-lettered refusal is recorded in `wh_dead_letters` with the reason `MixedStreamRefused` (22) and an error text
starting with `WHIZ133`. The default recovery policy holds it for review instead of retrying it: the same event on
the same stream is refused every time.
{verified: DefaultDeadLetterRecoveryPolicyTests.GetPolicy_MixedStreamRefused_HoldsForReviewWithoutRetryAsync}

`MixedStreamEventException` carries the stream (`StreamId`) and the refused event (`EventId`), and its message is the
same text a dead-lettered refusal records.
{verified: MixedStreamRefusalTests.RunAsync_StoreRefusesAnEvent_ThrowsMixedStreamEventExceptionNamingTheStreamAndEventAsync, DapperMixedStreamGuardTests.StoreOutboxMessagesAsync_DirectCommitOfASourcedEventOnAnEphemeralStream_ThrowsMixedStreamEventExceptionAsync}

## Diagnostic Message

```text{title="WHIZ133 message" description="The text MixedStreamEventException carries and a dead-lettered refusal records." category="Diagnostics" difficulty="BEGINNER" tags=["ephemeral", "WHIZ133", "dead-letter-queue"] tests=["MixedStreamGuardSqlTests.Store_SourcedEventOnAnEphemeralStream_DeadLettersTheSourcedEventAsync"]}
WHIZ133: stream {StreamId} holds {StreamKind} events ({StreamEventType}), so the {EventKind} event {EventType} (event {EventId}) was refused. A stream never mixes ephemeral and Sourced events: publish the ephemeral events on their own stream.
```

`{StreamKind}` and `{EventKind}` are `ephemeral` or `Sourced`. `{StreamEventType}` is the type of the stream's newest
stored event, or of its first event in the write when nothing is stored yet.

## Common Causes

1. **A signal shares its aggregate's stream.** A presence, progress or typing event uses the order's or document's
   id as its stream id, next to the order's Sourced events.
2. **An event type became ephemeral** while streams that already hold its Sourced history keep receiving it, or the
   reverse.
3. **A receptor emits both kinds onto one stream**, for example a Sourced business event and an ephemeral progress
   ping keyed on the same id.

## How to Fix

Publish the ephemeral events on a stream of their own. Give them a stream id that no Sourced event uses, for example
an id derived from the aggregate's id, or a dedicated id for the signal.

### Before (refused)

```csharp{title="Ephemeral signal on the aggregate's stream" description="An ephemeral event keyed on the same stream id as the aggregate's Sourced events is refused with WHIZ133." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "streams", "WHIZ133"] tests=["MixedStreamGuardSqlTests.Store_DirectCommitOfAnEphemeralEventOnASourcedStream_ThrowsMixedStreamEventExceptionAsync"]}
public record OrderPlaced([StreamId] Guid OrderId) : IEvent;

[Ephemeral]
public record OrderBeingViewed([StreamId] Guid OrderId, Guid UserId) : IEvent;  // same stream: WHIZ133
```

### After

```csharp{title="Ephemeral signal on its own stream" description="The ephemeral event uses a stream id of its own, so the order's stream stays Sourced." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "streams", "WHIZ133"] unverified="stream layout illustration; the refusal and the unaffected separate stream are verified in the tables above"}
public record OrderPlaced([StreamId] Guid OrderId) : IEvent;

[Ephemeral]
public record OrderBeingViewed([StreamId] Guid ViewingStreamId, Guid OrderId, Guid UserId) : IEvent;
```

To find refusals that were dead-lettered, look for the reason in the dead-letter table:

```sql{title="Find WHIZ133 dead letters" description="Lists dead-lettered rows refused for mixing ephemeral and Sourced events on one stream." category="Diagnostics" difficulty="BEGINNER" tags=["dead-letter-queue", "WHIZ133", "sql"] tests=["MixedStreamGuardSqlTests.InboxChain_SourcedEventOnAnEphemeralStream_DeadLettersTheRowAndStoresTheRestAsync"]}
SELECT source_table, source_id, stream_id, message_type, error_text, dead_lettered_at
FROM wh_dead_letters
WHERE failure_reason = 22
ORDER BY dead_lettered_at DESC;
```

## Suppressing

WHIZ133 cannot be suppressed and has no opt-in. A stream that holds both kinds cannot be rebuilt correctly, so the
refusal is the only safe outcome.

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](whiz130)
- [WHIZ131: Rebuild or rewind of an ephemeral-only perspective](whiz131)
- [WHIZ132: Receptor turns an ephemeral message into a Sourced event](whiz132)
- [Ephemeral events](../../fundamentals/events/ephemeral-events)
- [Internal dead-letter queue](../dead-letter-queue/internal-dlq)
