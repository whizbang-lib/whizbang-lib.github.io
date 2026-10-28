---
title: Inbox dispatch
pageType: concept
order: 6
version: 1.0.0
description: >-
  How the inbox dispatch worker runs the rows the drain queues, and how it keeps the leases of every
  row the process holds so a row waiting in memory is neither charged another attempt nor run twice.
tags: 'work-coordinator, inbox, dispatch, leases, lease-renewal, held-rows, attempts, logging'
codeReferences:
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Messaging/IInboxChannelWriter.cs
  - src/Whizbang.Core/Messaging/InboxChannelWriter.cs
  - src/Whizbang.Core/Messaging/InboxLeaseSweep.cs
  - src/Whizbang.Core/Workers/InboxHandlerWorker.cs
  - src/Whizbang.Core/Workers/LeaseHandleOptions.cs
  - src/Whizbang.Core/Workers/LeaseRenewalWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/InboxChannelWriterHeldRowsTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerHeldLeaseTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDispatchWorkerLeaseKeeperTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxHandlerWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerCacheLifetimeTests.cs
---

# Inbox dispatch

The inbox dispatch worker runs the inbox rows the [per-stream drain](per-stream-drain.md) queues. It
reads the inbox channel, routes each row to a partition by stream so one stream's rows run in order,
invokes the receptors and lifecycle stages, and hands each row's completion to the batched
[handler commit](handler-commit.md).

Between the claim that leases a row and the commit that completes it, the row lives in this
process's memory. This page covers how the process keeps those rows' leases for as long as it holds
them.

## Held rows {#held-rows}

A row the drain writes to the inbox channel is **held** by this process until it is finished here.
A held row is in one of three states:

| State | Meaning | Ends when |
|---|---|---|
| Queued | Written to the inbox channel, waiting for a dispatch consumer. | A consumer takes it, or its renewals run out. |
| Dispatching | A consumer is running its receptors. | The dispatch ends: a completion handed to the commit channel moves it to awaiting commit; any other ending releases it. |
| Awaiting commit | Dispatched; its completion waits in the batched commit channel. | The commit flush ends, whether the commit landed or failed. |

A row also stops being held when its renewals run out (below), or when nothing has renewed it for
600 seconds. {verified: InboxChannelWriterHeldRowsTests.EndDispatch_ReleasesTheRow_UnlessItsCommitIsPendingAsync, InboxChannelWriterHeldRowsTests.ARenewedRow_IsNotAgedOutOfTheHeldSetAsync, InboxHandlerWorkerTests.CommitFlush_ReleasesTheHeldRow_WhetherItCommittedOrNotAsync}

```mermaid{caption="A held inbox row: queued by the drain, dispatched once, and released when its commit flush ends. In every state the lease keeper renews it until its renewals for that state run out." tests=["InboxChannelWriterHeldRowsTests.TheFirstCopyTakesTheDispatchTicket_ADuplicateCopyDoesNotAsync", "InboxChannelWriterHeldRowsTests.EndDispatch_ReleasesTheRow_UnlessItsCommitIsPendingAsync", "InboxDispatchWorkerHeldLeaseTests.Dispatch_HandingTheCommitOn_KeepsTheRowHeldUntilTheCommitLandsAsync", "InboxChannelWriterHeldRowsTests.Sweep_PastTheCap_ReleasesTheRowAndReportsItsStateAndTypeAsync"]}
stateDiagram-v2
  [*] --> Queued: drain writes the row
  Queued --> Dispatching: first copy takes the dispatch ticket
  Queued --> [*]: renewals run out (handed back, attempt refunded)
  Dispatching --> AwaitingCommit: completion handed to the commit channel
  Dispatching --> [*]: dispatch ends without a commit
  Dispatching --> [*]: renewals run out (lapse logged)
  AwaitingCommit --> [*]: commit flush ends (landed or failed)
  AwaitingCommit --> [*]: renewals run out (lapse logged)
```

### The lease keeper

Before held rows were tracked, nothing renewed an inbox lease. A row that waited in a dispatch queue
longer than its lease lost it without ever being dispatched, was claimed again with another attempt
charged, and could reach the attempt bound without a receptor ever running.

The dispatch worker now runs a lease keeper for as long as it runs. The keeper makes one pass when
the worker starts and another every sixth of a lease (every 50 seconds with the default 300-second
`Whizbang:Workers:LeaseRenewal:LeaseSeconds`). Each pass renews, in one store call, every held row
whose lease is half spent since its last renewal or its arrival (150 seconds by default).
{verified: InboxDispatchWorkerLeaseKeeperTests.Keeper_RenewsAtStartAndOnEachTick_AndEndsWithTheWorkerAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_RenewsAQueuedRowsLease_OnceHalfOfItIsSpentAsync, InboxChannelWriterHeldRowsTests.Sweep_RenewsARowOnceItsLeaseIsHalfSpent_ThenNotAgainUntilTheNextHalfAsync}

When a renewed row is dispatching, the keeper also extends its in-process dispatch deadline to the
new lease expiry, so lease-tied cancellation does not stop a handler whose lease was just kept.
{verified: InboxDispatchWorkerHeldLeaseTests.Keeper_ExtendsTheDispatchDeadlineOfARowBeingDispatchedAsync}

A renewal that fails is logged and not thrown. The rows keep their current expiry, and the next pass
tries again. {verified: InboxDispatchWorkerHeldLeaseTests.Keeper_RenewalFailure_IsLoggedWithWhatItCosts_NotThrownAsync}

### The renewal cap

Renewals are capped per state by `Whizbang:Workers:LeaseHandle:MaxRenewalsPerWork` (default 6), the
same cap that bounds deadline extensions for every other category. A row that starts dispatching, or
whose completion is handed to the commit channel, gets a fresh set of renewals. With the defaults, a
row can wait queued for roughly seven half-leases (about 17 minutes) before it lapses.
{verified: InboxChannelWriterHeldRowsTests.Sweep_StartingDispatch_GivesTheRowAFreshSetOfRenewalsAsync}

When a row has used every renewal it is allowed in its state, it stops being held and the lapse is
logged with the row's id, message type, renewals used and what the lapse means:

- **Queued** (never dispatched): the row is handed back to the store with the attempt its claim took
  refunded, so the next claim offers it again without charging it.
- **Dispatching**: the handler is still running. Its lease lapses at its current expiry.
- **Awaiting commit**: the commit has not landed. Its lease lapses at its current expiry.

One pass logs the first five lapses individually and counts the rest in one summary line.
{verified: InboxDispatchWorkerHeldLeaseTests.Keeper_PastTheCap_ReleasesANeverDispatchedRowUncharged_AndLogsItAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_PastTheCap_DoesNotReleaseARowWhoseHandlerIsRunning_ButLogsItAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ManyLapsesInOneSweep_LogTheFirstIndividually_ThenASummaryAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ReleaseFailure_IsLoggedWithWhatItCosts_NotThrownAsync}

### One dispatch per row

The claim re-offers every stream whose rows this instance holds, so the same row can reach the inbox
channel more than once. Only the first copy to reach a dispatch consumer runs: it takes the row's
dispatch ticket. A later copy, or a copy of a row whose renewals ran out and was handed back, is
skipped and logged at Debug. The [drain](per-stream-drain.md#working-set-budget) also skips rows this
process already holds, so duplicate copies are rare.
{verified: InboxChannelWriterHeldRowsTests.TheFirstCopyTakesTheDispatchTicket_ADuplicateCopyDoesNotAsync, InboxChannelWriterHeldRowsTests.ARowNotHeld_HasNoTicketAsync, InboxDispatchWorkerHeldLeaseTests.Dispatch_ADuplicateCopy_IsNotDispatchedAgainAsync}

A dispatch that throws is routed to the failure channel and releases the row. A dispatch interrupted
by shutdown is not a failure: it records nothing, and the row's lease lapses for the next owner.
{verified: InboxDispatchWorkerHeldLeaseTests.Dispatch_ThatThrows_IsRoutedToTheFailureChannel_AndReleasesTheRowAsync, InboxDispatchWorkerHeldLeaseTests.Dispatch_InterruptedByShutdown_PropagatesWithoutRecordingAFailureAsync}

When a row completes, its parsed payload is dropped from the deserialize cache, so finished rows do
not occupy the cache's byte budget. {verified: InboxDispatchWorkerCacheLifetimeTests.Dispatch_CachesThePayloadWithItsSize_AndDropsItWhenTheRowCompletesAsync, InboxDispatchWorkerCacheLifetimeTests.Dispatch_HandingACommitOn_DropsItsCacheEntryAsync, InboxDispatchWorkerCacheLifetimeTests.Dispatch_DeadLetteringARow_DropsItsCacheEntryAsync}

### Throughput is what dispatch finishes

The [claim backpressure](../../operations/workers/claim-backpressure.md) budget sizes how many rows
an instance may hold from the rate it drains them. A row retired at the attempt bound is dropped or
dead-lettered without being tried, in microseconds. Those rows are no longer counted as drain
throughput, so a flood of exhausted rows cannot raise the budget past what dispatch can finish
within one lease. {verified: InboxDispatchWorkerHeldLeaseTests.Meter_AttemptCapDrops_AreNotCountedAsDrainAsync, InboxDispatchWorkerHeldLeaseTests.Meter_WithNoAttemptBound_CountsEveryDispatchAsync}

### Turning the keeper off

The keeper has no setting of its own. The lease renewal killswitch,
`Whizbang:Workers:LeaseRenewal:Enabled`, turns it off along with lease renewal for every other
category. With it off, held rows keep only the lease their claim gave them.

```json{title="Lease keeper settings" description="The keys the inbox lease keeper reads, shown with their defaults: the renewal killswitch and lease length, and the per-state renewal cap" category="Configuration" difficulty="INTERMEDIATE" tags=["Inbox", "Leases", "Configuration"] tests=["InboxDispatchWorkerLeaseKeeperTests.Keeper_WithRenewalDisabled_RenewsNothingAsync", "InboxDispatchWorkerLeaseKeeperTests.Keeper_RenewsAtStartAndOnEachTick_AndEndsWithTheWorkerAsync", "InboxChannelWriterHeldRowsTests.Sweep_PastTheCap_ReleasesTheRowAndReportsItsStateAndTypeAsync"]}
{
  "Whizbang": {
    "Workers": {
      "LeaseRenewal": {
        "Enabled": true,
        "LeaseSeconds": 300
      },
      "LeaseHandle": {
        "MaxRenewalsPerWork": 6
      }
    }
  }
}
```

{verified: InboxDispatchWorkerLeaseKeeperTests.Keeper_WithRenewalDisabled_RenewsNothingAsync, InboxDispatchWorkerLeaseKeeperTests.Keeper_StopsOnShutdown_WithoutFaultingTheWorkerAsync}

## Log events {#log-events}

Category `Whizbang.Core.Workers.InboxDispatchWorker`. The events below concern held rows and the
control-plane drop line.

| EventId | Level | When |
|---|---|---|
| 11 | Warning | A control-plane message was dropped at the attempt bound instead of dead-lettered. Carries the last cause and last error; see [Internal DLQ](../../operations/dead-letter-queue/internal-dlq.md#control-plane-drops). |
| 78 | Warning | The keeper could not renew the leases of held rows. They lapse at their current expiry unless the next pass renews them. |
| 79 | Warning | A held row used every renewal it is allowed in its state. Carries the id, message type, renewals and the consequence. |
| 80 | Warning | Summary of the lapses in one pass beyond the first five. |
| 81 | Warning | The keeper could not hand back never-dispatched rows whose renewals ran out; their next claim charges each an attempt. |
| 82 | Debug | A copy of a row was skipped because the row is already dispatching, committing, or no longer held here. |

{verified: InboxDispatchWorkerHeldLeaseTests.Keeper_RenewalFailure_IsLoggedWithWhatItCosts_NotThrownAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ManyLapsesInOneSweep_LogTheFirstIndividually_ThenASummaryAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ReleaseFailure_IsLoggedWithWhatItCosts_NotThrownAsync, InboxDispatchWorkerControlPlaneDropLogTests.Drop_WithARecordedFailure_LogsTheErrorAndNamesItAsARecordedFailureAsync}

## Related

- [Per-stream drain](per-stream-drain.md)
- [Handler commit](handler-commit.md)
- [Batched flushers](batched-flushers.md)
- [Claim backpressure](../../operations/workers/claim-backpressure.md)
- [Configuration reference](configuration-reference.md#inbox-memory)
- [Logging categories](../../operations/observability/logging-categories.md#inbox-pipeline-events)
