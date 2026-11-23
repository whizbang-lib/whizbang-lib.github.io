---
title: Sequence Integrity
pageType: concept
verifiedDate: 2026-11-23
order: 10
description: >-
  Whether the outbox publishes an event at once or holds it until the
  commit-order stamper has given it its position, decided per event at the
  origin. Three modes (None, Bounded, UntilStamped), set per dispatch, on the
  event type or by configuration; the default holds each event up to one
  second. A held event holds its stream behind it, the stamp releases it at
  once, and a gauge reports how long the oldest held event has waited.
tags: 'sequence integrity, commit sequence, stamper, outbox, ordering, origin position, hold, bounded'
codeReferences:
  - src/Whizbang.Core/Messaging/SequenceIntegrity.cs
  - src/Whizbang.Core/Messaging/SequenceIntegrityPolicy.cs
  - src/Whizbang.Core/Attributes/SequenceIntegrityAttribute.cs
  - src/Whizbang.Core/Dispatch/DispatchOptions.cs
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Configuration/ProcessWideOptionsBinding.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Observability/SequenceHoldWorker.cs
  - src/Whizbang.Core/Observability/SequenceHoldMetrics.cs
  - src/Whizbang.Generators/MessageTypeCatalogGenerator.cs
  - src/Whizbang.Data.Postgres/Migrations/558_EventsWaitForTheirCommitOrderStamp.sql
testReferences:
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/SequenceIntegrityPolicyTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/DispatcherSequenceIntegrityTests.cs
  - tests/Whizbang.Core.Unit.Dispatcher.Tests/Dispatch/DispatchOptionsSequenceIntegrityTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogGeneratorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SequenceIntegritySqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSequenceHoldTests.cs
  - tests/Whizbang.Core.Component.Tests/Observability/SequenceHoldWorkerTests.cs
  - tests/Whizbang.Core.Tests/Configuration/ProcessWideOptionsBindingTests.cs
---

# Sequence Integrity

Every event a service stores gets a position in that service's commit order: its **commit
sequence**. The commit-order stamper writes it shortly after the event's transaction commits (see
[commit sequence](../work-coordinator/commit-sequence)). A receiver stores that number as the
event's **origin position**, and every ordering decision downstream (replay order, coalesced
children, archive cuts, digest comparison) relies on it.

The outbox and the stamper run independently. When the outbox publishes an event before the stamper
has reached it, the event leaves without a commit sequence and the receiver stores it with no origin
position. Measured on a deployed environment, 16 to 22 percent of received events arrived that way in
steady state. Each one costs approximate ordering at the receiver (event id order, which follows time,
not the stream), and a wrong order costs a perspective rebuild.

**Sequence integrity** is the per-event choice of whether the outbox waits for the stamp. It is
decided **only at the origin**, the service that stores and publishes the event, and it is separate
from [message priority](message-priority): sequence integrity decides which messages are ready to
publish, and priority orders the ones that are.

## The three modes {#the-three-modes}

| Mode | What the outbox does | Why you would choose it |
|---|---|---|
| `None` | Publishes at once, racing the stamp. | The event's order does not matter to anyone who receives it (a heartbeat, a notification nobody replays), and the lowest publish latency matters more than an origin position. This is how every event was published before sequence integrity existed. |
| `Bounded` | Holds the event until it is stamped or its hold time passes, then publishes it anyway. **The default, holding up to 1 second.** | Almost every event. The stamp normally lands within milliseconds, and the stamper wakes the outbox the moment it does, so the hold costs only as long as stamping takes. The hold time caps the cost when the stamper is slow or stopped: the event is published anyway, without its position, rather than waiting indefinitely. |
| `UntilStamped` | Holds the event until it is stamped, however long that takes. | Events whose position is a correctness requirement at the receiver: a ledger posting, anything a receiver folds in order and cannot afford to rebuild. The cost is that under a bulk import the stamper can fall hours behind, and these events wait with it. [Watch the held age](#watching-held-messages). |

Only an event that is published can be held. A command is never held (it has no commit sequence), and
neither is an event that is only stored and never sent.

## Where it is set {#precedence}

{verified: SequenceIntegrityPolicyTests.TheDispatchsSetting_BeatsTheTypeAndTheDefaultAsync, SequenceIntegrityPolicyTests.TheTypesAttribute_BeatsTheConfiguredDefaultAsync, SequenceIntegrityPolicyTests.TheConfiguredDefault_AppliesToATypeThatDeclaresNoneAsync, SequenceIntegrityPolicyTests.OutOfTheBox_AnEventIsHeldBoundedForOneSecondAsync, DispatcherSequenceIntegrityTests.Publish_TheConfiguredDefault_TheTypesAttribute_AndTheDispatch_InOrderOfPrecedenceAsync}

The most specific setting wins:

1. **The dispatch**, for an event whose need depends on the call (`DispatchOptions.WithSequenceIntegrity`).
2. **The event type**, with `[SequenceIntegrity]`.
3. **The configured default**, `Whizbang:Core:SequenceIntegrity`.
4. **Out of the box**: `Bounded`, holding up to 1 second.

The hold time of a `Bounded` hold follows the same order on its own: the dispatch's hold time, else
the one the type's attribute names, else `Whizbang:Core:SequenceHoldTime`. So a dispatch can shorten
the hold of a type that sets `Bounded` without naming the mode again.

### Per dispatch {#per-dispatch}

```csharp{title="Choose sequence integrity for one dispatch" description="A dispatch overrides the type and the configured default" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging","Sequence Integrity"] tests=["DispatchOptionsSequenceIntegrityTests.WithSequenceIntegrity_SetsTheMode_AndTheHoldTimeOnlyWhenGivenAsync","SequenceIntegrityPolicyTests.TheDispatchsSetting_BeatsTheTypeAndTheDefaultAsync"]}
// This one posting must reach the ledger in order, whatever its type says.
await dispatcher.PublishAsync(
    new LedgerPosted(ledgerId),
    new DispatchOptions().WithSequenceIntegrity(SequenceIntegrity.UntilStamped));

// Hold briefly, but no longer than 400 ms.
await dispatcher.PublishAsync(
    new OrderPlaced(orderId),
    new DispatchOptions().WithSequenceIntegrity(SequenceIntegrity.Bounded, TimeSpan.FromMilliseconds(400)));
```

`WithSequenceIntegrity` sits beside `WithPriority`. A negative hold time is refused. A batch call
(`PublishManyAsync`) applies the setting to every event in the batch.

### On the event type {#on-the-event-type}

```csharp{title="Choose sequence integrity on the event type" description="The attribute, with an optional hold time in milliseconds" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging","Sequence Integrity"] tests=["SequenceIntegrityPolicyTests.TheTypesAttribute_BeatsTheConfiguredDefaultAsync","MessageTypeCatalogGeneratorTests.Generator_StampsSequenceIntegrityOnEntriesAsync"]}
[SequenceIntegrity(SequenceIntegrity.UntilStamped)]
public record LedgerPosted([property: StreamId] Guid LedgerId) : IEvent;

[SequenceIntegrity(SequenceIntegrity.None)]
public record HeartbeatRecorded([property: StreamId] Guid MonitorId) : IEvent;

// Bounded, holding up to 2.5 seconds instead of the configured hold time.
[SequenceIntegrity(SequenceIntegrity.Bounded, 2500)]
public record ShipmentDispatched([property: StreamId] Guid ShipmentId) : IEvent;
```

The attribute is read at compile time into the message type catalog, so there is no reflection at
run time. It is inherited: a type derived from `LedgerPosted` holds until stamped too. The second
argument is the hold time in milliseconds; zero or less (the default) takes the configured hold time.

### The configured default {#the-configured-default}

```json{title="Configure the default sequence integrity" description="The service-wide default and hold time" category="Configuration" difficulty="BEGINNER" tags=["Messaging","Sequence Integrity","Configuration"] tests=["SequenceIntegrityPolicyTests.TheConfiguredDefault_AppliesToATypeThatDeclaresNoneAsync","SequenceIntegrityPolicyTests.OutOfTheBox_AnEventIsHeldBoundedForOneSecondAsync"]}
{
  "Whizbang": {
    "Core": {
      "SequenceIntegrity": "Bounded",
      "SequenceHoldTime": "00:00:01"
    }
  }
}
```

Or `Whizbang__Core__SequenceIntegrity` and `Whizbang__Core__SequenceHoldTime` as environment
variables. Both are in the [configuration reference](../../operations/configuration/configuration-reference#whizbangcoreoptions).
Setting the default to `None` restores the behavior from before sequence integrity, for every type
that does not ask for more.

## How the hold works {#how-the-hold-works}

{verified: SequenceIntegritySqlTests.Store_WritesEachModesHoldOntoAnEventsRow_AndNeverOntoACommandsAsync, SequenceIntegritySqlTests.Fetch_AnUnstampedEventWithNoHold_IsPublishedAtOnceAsync, SequenceIntegritySqlTests.Fetch_AnUnstampedEventWithinItsHold_IsHeld_AndPublishedOnceStampedAsync, SequenceIntegritySqlTests.Fetch_ABoundedHoldThatRanOut_IsPublishedUnstampedAsync, SequenceIntegritySqlTests.Fetch_AHoldWithNoStoredEvent_HoldsNothingAsync, SequenceIntegritySqlTests.Continue_StopsAStreamAtItsHeldEvent_AsTheFetchDoesAsync}

The dispatcher decides the hold when it writes the event to the outbox, and the row carries it as
`wh_outbox.sequence_hold_until`: empty for no hold, `infinity` for a hold until stamped, and
otherwise the instant a bounded hold runs out, taken from the database's clock when the row is
stored.

The outbox drain fetches a stream's rows with the event store row each one already joins. An event is
**held** while its hold has not run out and its event store row has no commit sequence. The fetch
returns the stream's rows up to its first held event and stops there; the held rows stay leased to
the instance and come back with the next offer. A row with no event store row is never held, because
nothing would ever stamp it.

The test costs nothing extra: the fetch already reads the event store row by its key to carry the
commit sequence onto the wire, and the cut is a window over the rows it returns. No new index and no
new scan was added to the drain.

### A held event holds its stream {#a-held-event-holds-its-stream}

{verified: SequenceIntegritySqlTests.Fetch_ARowBehindAHeldEvent_IsHeldWhateverItsOwnSettingAsync}

Every row after a held event in the same stream waits with it, **whatever its own mode**: an event
set to `None` and a command alike. A receiver must never see a stream out of order, and publishing a
later event ahead of a held one would do exactly that. Other streams are not affected.

### Released by the stamp {#released-by-the-stamp}

{verified: SequenceIntegritySqlTests.Stamp_AStreamWithPendingOutboxRows_RingsItsOutboxOwnerAsync, SequenceIntegritySqlTests.Stamp_AStreamWithNoPendingOutboxRows_DoesNotRingTheOutboxAsync}

The stamper already rings the perspective doorbell of each stream it stamps. It now also rings the
**outbox** doorbell of each stamped stream that still has pending outbox rows, which wakes the
instance holding them. A held event therefore goes out as soon as its stamp lands, not when its hold
runs out: a `Bounded` hold's deadline is the fallback for a stamper that is slow or stopped, not the
normal path. The probe is one index lookup per stamped stream.

## Watching held messages {#watching-held-messages}

{verified: SequenceHoldWorkerTests.OnItsInterval_ReadsThisInstancesOldestHold_AndPublishesItsAgeAsync, SequenceHoldWorkerTests.AHoldOlderThanTheWarningAge_IsLoggedAsAWarningAsync, SequenceHoldWorkerTests.NothingHeld_ReadsZero_AndAFailedReading_ReportsNothingAsync, SequenceIntegritySqlTests.OldestHeld_IsTheArrivalOfTheOldestEventThisInstanceHoldsForItsStampAsync, SequenceIntegritySqlTests.OldestHeld_StopsAtItsBoundAsync}

Each instance measures how long the oldest outbox event it holds for its stamp has waited:

| Instrument | Meter | Unit | Meaning |
|---|---|---|---|
| `whizbang.outbox.sequence_hold.oldest_age_seconds` | `Whizbang.SequenceIntegrity` | `s` | Age of the oldest event this instance holds for its stamp; `0` when it holds none; no value when the reading failed |

Past `Whizbang:Core:SequenceHoldWarningAge` (default 1 minute) the instance logs a warning. A
healthy service reads near zero: `Bounded` events wait milliseconds and the stamp releases them. A
rising value means the stamper is behind or not running, and `UntilStamped` events, and every stream
they hold, are waiting for it.

The reading is taken every `Whizbang:Core:SequenceHoldSampleInterval` (default 15 seconds; zero
turns it off). It walks only the instance's own pending rows, in arrival order through the index the
claim already uses, and stops after 1,000 rows, so it costs the same whatever the outbox holds. The
first held row in that order is the oldest one.

## Configuration {#configuration}

| Key | Type | Default | Meaning |
|---|---|---|---|
| `Whizbang:Core:SequenceIntegrity` | `None`, `Bounded`, `UntilStamped` | `Bounded` | The mode of an event whose type and dispatch set none |
| `Whizbang:Core:SequenceHoldTime` | `TimeSpan` | `00:00:01` | The longest a `Bounded` event is held when nothing more specific names a hold time |
| `Whizbang:Core:SequenceHoldWarningAge` | `TimeSpan` | `00:01:00` | The held age past which the instance logs a warning |
| `Whizbang:Core:SequenceHoldSampleInterval` | `TimeSpan` | `00:00:15` | How often each instance measures the held age; zero or less turns it off |

## What it does not do {#what-it-does-not-do}

- **It does not position events published without a stamp.** An event set to `None`, a `Bounded`
  hold that ran out, and history published before sequence integrity existed still arrive without an
  origin position. Filling those in afterwards, through the integrity engine's request and answer
  exchange, is separate work.
- **It is not decided at the receiver.** A receiver cannot ask an origin to wait; the origin knows
  what its events need.
