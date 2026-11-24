---
title: Stream version ordering
pageType: concept
audience: consumer
status: current
version: 1.0.0
category: Fundamentals
order: 1
description: >-
  A stream's version is its position, and an id is never one. The event store numbers a stored batch in the order its
  events were emitted and a received stream in its origin's order, and every read and worker hands a stream on by the
  position each event or message carries.
tags: 'event-store, stream-order, versions, emission-order, receive-order, dispatch-order, StreamOrder, uuidv7'
codeReferences:
  - src/Whizbang.Core/Messaging/StreamOrder.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/SlidingWindowOutboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/CoalescingOutboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/SlidingWindowInboxBatchStrategy.cs
  - src/Whizbang.Data.Postgres/Migrations/580_StreamsAreVersionedInEmissionOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/581_ReceivedStreamsAreVersionedInReceiveOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/582_StreamReadsFollowStreamOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/583_LiveReadsCarryTheirStreamOrder.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EmissionOrderVersioningSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ReceiveOrderVersioningSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/FetchInboxBatchStreamOrderSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StreamOrderNeverByIdGuardTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/StreamOrderTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/StreamOrderSourceGuardTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowOutboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/CoalescingOutboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowInboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/PerspectiveWorkerOrderingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ReconcileRewindDeclarationSqlTests.cs
---

# Stream version ordering

A stream's **version** is its position: the order its events were written in, which is the order a replay folds them
in. An event or message **id** is time-ordered and never a position
([#2551](https://github.com/whizbang-lib/whizbang/issues/2551)). An id derived inside a handling
([#2520](https://github.com/whizbang-lib/whizbang/issues/2520), [#2543](https://github.com/whizbang-lib/whizbang/issues/2543))
sorts at its cause, so the event a cause's local receptor emits can sort ahead of the cause itself. A store that
numbered a stream by id would then give the effect the lower version.

So every layer orders a stream by a position, and only by a position:

```mermaid{caption="Where each position comes from and who follows it: the producer's batch order versions an emitted stream, the origin's order versions a received one, and the reads hand each event or message on with its position." tests=["EmissionOrderVersioningSqlTests.Store_ACauseAndItsDerivedEffectInOneBatch_TheCauseTakesTheLowerVersionAsync", "ReceiveOrderVersioningSqlTests.OverManyArrangements_TheStoredOrderIsTheReplaysOrder_SoTheTwoDefinitionsCannotDriftAsync", "FetchInboxBatchStreamOrderSqlTests.AStreamsEventsAndCommands_EachKindKeepsItsOrder_InTheArrivalSlotsItHoldsAsync", "FetchInboxBatchStreamOrderSqlTests.GetStreamEvents_CarriesEachEventsVersion_InStreamOrderAsync"]}
flowchart LR
    P[Producer batch<br/>emission order] -->|position in the batch| V[(wh_event_store.version)]
    O[Received events<br/>origin order, arrival slots] -->|receive order| V
    V -->|stream_position| I[Inbox drain<br/>InboxBatchRow.StreamPosition]
    A[Commands<br/>wh_inbox.arrival_position] -->|stream_position| I
    V -->|out_version| W[Perspective drain<br/>LocalStreamVersion]
    I --> S[StreamOrder.InStreamOrder]
    W --> S
```

| Where | Position it orders by | Section |
|---|---|---|
| Storing a batch the producer wrote | The event's place in the batch | [Emission order](#emission-order) |
| Storing a received stream | The origin's commit sequence, dealt into arrival slots | [Receive order](#receive-order) |
| The perspective reads | The stored version | [Reads](#reads) |
| The inbox fetch and the workers | The position each row or envelope carries | [Dispatch order](#dispatch-order) |

## Emission order {#emission-order}
{verified: EmissionOrderVersioningSqlTests.Store_ACauseAndItsDerivedEffectInOneBatch_TheCauseTakesTheLowerVersionAsync, EmissionOrderVersioningSqlTests.CommitHandlerResult_ACauseAndItsDerivedEffect_TheCauseTakesTheLowerVersionAsync, EmissionOrderVersioningSqlTests.EmitChain_EventsListedAgainstTheirIdOrder_AreVersionedInTheOrderListedAsync, EmissionOrderVersioningSqlTests.EmitChain_AnIdListedTwice_KeepsItsFirstPositionAsync, SlidingWindowOutboxBatchStrategyTests.AppendAsync_SameStream_SingleBatchKeepsTheOrderAppendedAsync, CoalescingOutboxBatchStrategyTests.WithinAFlush_MessagesAreGroupedByStream_EachInTheOrderAppendedAsync, StreamSealingSqlTests.OutboxBatch_EventsAfterATerminalEvent_AreDeadLettered_AndTheOnesBeforeItAreStoredAsync}

A batch of events stored together is versioned **in the order the producer emitted them**: each event's position in
the batch it is stored in (migration 580).

- **The producer keeps the batch in emission order.** Each outbox strategy flushes a stream's messages in the order
  they were appended, and none sorts them by id. The outbox follows emission order end to end: what is stored, and what
  is published, is the order the stream was written in.
- **The store numbers by position.** `store_outbox_messages` takes each element's position in the array it is handed
  (`WITH ORDINALITY`) once, at its entry, and `_emit_event_store_chain` numbers each stream by that position. An id
  listed twice keeps its first position. `commit_handler_result` stores through `store_outbox_messages`, so a
  handler's commit is versioned the same way.
- **The refusals judge by position too.** "After the first terminal event" (a [sealed stream](../events/stream-end-of-life#a-sealed-stream-refuses-appends)),
  "the first event decides the stream's kind" (a mixed stream), and the order an archived stream's refusals are
  reported in, are all read by position, not by id.

**Why no position field is added.** The array the producer stores already holds the order. A field beside it would be
a second source that could disagree with it, and the order only has to live for the one call that stores the batch.
Nothing is added to the wire or to `wh_outbox`.

**Cost.** The same rows are read. The store adds one in-memory sort of the arrays it already holds, and only when it
inserted more than one event.

## Receive order {#receive-order}
{verified: ReceiveOrderVersioningSqlTests.OneClaim_AnOriginsEvents_AreVersionedByTheOriginsSequence_NotByIdAsync, ReceiveOrderVersioningSqlTests.AnUnpositionedEvent_TakesTheReplaysPlace_AmongItsOriginsPositionedEventsAsync, ReceiveOrderVersioningSqlTests.TwoOrigins_KeepTheirArrivalSlots_EachDealtInItsOwnOrderAsync, ReceiveOrderVersioningSqlTests.AnOriginsEarlierEvent_HeldElsewhere_HoldsBackTheLaterOne_WhateverTheIdsAsync, ReceiveOrderVersioningSqlTests.ALaterArrivalHeldElsewhere_DoesNotHoldBackAnEarlierArrivalOfAnotherOriginAsync, ReceiveOrderVersioningSqlTests.OverManyArrangements_TheStoredOrderIsTheReplaysOrder_SoTheTwoDefinitionsCannotDriftAsync}

A stream a service receives from other services is versioned **in its origin's order** (migration 581), the same order
a replay folds a received stream in, so the store and the replay agree:

1. **Each origin's events in the origin's order:** the commit sequence each event carries from the service that wrote
   it.
2. **Between origins, by arrival:** each origin's events are dealt into the arrival slots that origin holds in the
   batch, so one origin never jumps another's earlier arrival.
3. **An event with no origin position** (a fan-out child, or a redelivery that lost it) goes before the first of its
   origin's positioned events whose id sorts after its own. That is the replay's documented fallback, and the only
   place an id decides anything, because nothing positional exists for that event.

**The hold-back uses the same order.** A claim that does not hold an earlier event of the stream
([received streams keep the producer's order](../events/event-store#received-stream-order)) compares that head with its
rows by the strict total key (arrival, origin, origin position, id), so two claims never wait for each other, and a row
that waits holds back every row after it in receive order, whatever the ids.

**A straggler is found by the same order.** An event stored below a perspective cursor flags that cursor for a rewind.
Whether it is below is judged against the origin's latest event at or below the cursor's version, by origin position,
never by id ([rewind detection](../perspectives/rewind#detection)).
{verified: ReconcileRewindDeclarationSqlTests.InboxEmitChain_LateEventBelowCursor_DeclaresRewindOnTheCursorAsync, ReconcileRewindDeclarationSqlTests.InboxEmitChain_EventAboveCursor_DoesNotDeclareRewindAsync}

**One definition, tested against the other.** A test stores many arrangements of origins, positions and arrivals, and
fails when the stored order differs from the order the replay (`ReplayEventOrder`) folds the same events in.

## Reads {#reads}
{verified: StreamOrderNeverByIdGuardTests.NoStoreReceiveOrReplayFunction_OrdersAStreamById_InItsLatestDefinitionAsync, StreamOrderNeverByIdGuardTests.TheGuard_FlagsEachWayOfOrderingAStreamById_AndPassesPositionalOrdersAsync, PerspectiveWorkerOrderingTests.GroupAndDedupe_GivenShuffledEventsForOneStream_ReturnsTheGroupInVersionOrder_NotByIdAsync}

The perspective reads return a stream's events **by version** (migration 582):

| Read | Order |
|---|---|
| `get_stream_events`, `wh_collective_sink_queue` | Commit sequence, then version. The version breaks the tie the commit sequence leaves for the unstamped events the reads admit past the stamp cutoff, where the id used to |
| `fetch_events_by_ids`, `fetch_pending_perspective_events`, `claim_and_fetch_pending_perspective_events` | Version |

Only the `ORDER BY` changed, and each key is a column of a row already in hand, so the sort costs what it did. A guard
test reads the latest definition of every store, receive and replay function in the migrations, and fails on one that
orders a stream by id.

## Dispatch order {#dispatch-order}
{verified: FetchInboxBatchStreamOrderSqlTests.ReceivedEvents_AreFetchedInTheirStoredOrder_WithTheirStreamPositionAsync, FetchInboxBatchStreamOrderSqlTests.Commands_AreFetchedInTheOrderTheyArrived_NotByIdAsync, FetchInboxBatchStreamOrderSqlTests.AStreamsEventsAndCommands_EachKindKeepsItsOrder_InTheArrivalSlotsItHoldsAsync, FetchInboxBatchStreamOrderSqlTests.GetStreamEvents_CarriesEachEventsVersion_InStreamOrderAsync, StreamOrderTests.InboxRows_AreOrderedByTheirStreamPosition_NotByIdAsync, StreamOrderTests.InboxRows_WithoutAPosition_KeepTheFetchsOrder_AfterThePositionedOnesAsync, StreamOrderTests.Events_AreOrderedByTheirVersion_NotByIdAsync, InboxDrainWorkerGapTests.ExecuteAsync_AStreamsRows_AreDispatchedByTheirStreamPosition_NeverByIdAsync}

The live paths hand a stream on in the same order, and the rank travels with each item, so no worker has to work it
out again (migration 583).

**The inbox fetch ranks a stream by kind.** `fetch_inbox_batch_in_stream_order` ranks a stream's **received events by
their stored version** and its **commands by their arrival**, and deals each kind into the arrival slots it holds. It
returns the rank as `stream_position`, which the drivers read into `InboxBatchRow.StreamPosition`; the byte budget's
running total follows the same order. A command has no version, so its position is its arrival:
`wh_inbox.arrival_position`, a value from the sequence `wh_inbox_arrival_seq` that `store_inbox_messages` takes for
each element in the order it is handed the delivery, so the lock order of its inserts decides nothing.

For example, a stream whose rows arrived in the order E2, C1, E1 (events E1 and E2 at versions 1 and 2, command C1):

| Arrival slot | 1 | 2 | 3 |
|---|---|---|---|
| Kind that holds it | event | command | event |
| Dispatched | E1 (version 1) | C1 | E2 (version 2) |

The events keep their version order in the slots events hold, and the command keeps its arrival slot.

**The perspective read carries each event's version.** `get_stream_events_in_stream_order` returns each event's version
(`out_version`), which the drivers carry as `StreamEventData.Version` onto the envelope's `LocalStreamVersion`, so the
perspective drain applies a stream by the version each event carries.

**New names, because a function's result never changes under its name.** `fetch_inbox_batch` and `get_stream_events`
keep their results, now read through the new functions in the same order, for a caller built before them. The
drivers call the new ones.

**Every worker orders through `StreamOrder`.** `StreamOrder.InStreamOrder` orders fetched inbox rows by
`StreamPosition`, or one stream's envelopes by `LocalStreamVersion`. Both are stable: an item with no position keeps
the order the read returned it in, after the positioned ones. The inbox and perspective drains, the runners and the
batch strategies take that order or the order the read returned; none re-sorts a stream by message id. A source guard
(`StreamOrderSourceGuardTests`) reads every worker, runner, the messaging layer and every driver, and fails on any sort
or comparison of ids outside the documented fallbacks
([event ordering](../../extending/internals/event-ordering-invariant#documented-fallbacks)).
{verified: StreamOrderSourceGuardTests.NoWorkerRunnerOrDriver_OrdersAStreamById_OutsideTheReplaysFallbackAsync, StreamOrderSourceGuardTests.TheGuard_FlagsEachWayOfOrderingById_AndPassesAPositionOrderAndACommentAsync}

```csharp{title="Order a stream by its position" description="StreamOrder.InStreamOrder replaces OrderByMessageId: it orders by the position each item carries, never by id" category="API" difficulty="INTERMEDIATE" tags=["Event store", "Stream order", "Inbox"] tests=["StreamOrderTests.InboxRows_AreOrderedByTheirStreamPosition_NotByIdAsync", "StreamOrderTests.Events_AreOrderedByTheirVersion_NotByIdAsync"]}
// Inbox rows of one stream, by the position the fetch ranked them at.
List<InboxBatchRow> rows = StreamOrder.InStreamOrder(fetched);

// One stream's events, by the version each envelope carries.
List<MessageEnvelope<IEvent>> events = StreamOrder.InStreamOrder(envelopes);
```

**Cost.** The store adds one sequence value per element and one column per row, with no index. The fetch adds one
primary-key probe of `wh_event_store` per leased row and three window passes over the rows it already reads. The
stream read returns a column it already reads.

## Upgrading {#upgrading}

- **`MessageOrderingExtensions` is removed.** Order a stream with `StreamOrder.InStreamOrder`, or keep the order the
  read returned. See the [upgrade guide](../../upgrading/upgrade-guide#stream-order).
- **Stored streams keep their versions.** Nothing is renumbered.
- **A mixed deploy.** A stream written after the upgrade by a producer still on the previous release is versioned in
  the order its batches are listed.
- **Inbox rows already queued** take their arrival position once, during the migration, in the order they were
  dispatched in until now (received time, then id), so a backlog drains as it would have.

## Related

- [Event store: stream versions](../events/event-store#stream-versions)
- [Event ordering invariant](../../extending/internals/event-ordering-invariant): the rule in the workers and runners
- [Perspective rewind: one order for a stream](../perspectives/rewind#one-order-for-a-stream)
- [Resequencing received streams](../../operations/infrastructure/resequencing-received-streams)
