---
title: Per-stream drain
pageType: concept
order: 6
version: 1.0.0
description: >-
  How the drain workers turn claimed stream ids into ordered work, how stream signals are batched,
  and how the inbox drain bounds the payload bytes a process holds in memory.
tags: 'work-coordinator, drain, inbox, outbox, streams, ordering, memory, working-set, backpressure'
codeReferences:
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Core/Messaging/IInboxDrainChannel.cs
  - src/Whizbang.Core/Messaging/IOutboxDrainChannel.cs
  - src/Whizbang.Core/Messaging/IInboxChannelWriter.cs
  - src/Whizbang.Core/Messaging/InboxChannelWriter.cs
  - src/Whizbang.Core/Messaging/InboxPayload.cs
  - src/Whizbang.Core/Workers/SlidingWindowBatcher.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Tests/Messaging/InboxChannelWriterHeldRowsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/InboxPayloadTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDeserializeCacheByteBudgetTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowBatcherTests.cs
---

# Per-stream drain

The [claim loop](claim-loop.md) leases work and returns the ids of the streams it touched, not the
rows themselves. The drain workers turn those stream ids into work: the outbox drain feeds the
publisher, and the inbox drain feeds the [inbox dispatch worker](inbox-dispatch.md).

For each signalled stream, a drain fetches the stream's leased rows in order, rebuilds each row as a
unit of work, and writes it to the next stage in that order. One drain task handles a stream at a
time, so a stream's rows are never reordered. The inbox drain is the only source of inbox work:
disabling it (`Whizbang:Workers:InboxDrain:Enabled`) stops inbox dispatch.

## Sliding window {#sliding-window}

Stream signals are batched before the drain fetches. When a stream id arrives, the drain waits up to
the sliding window for more signals, so more rows can accumulate before one fetch. The batch is
bounded by a maximum wait from its first signal and a maximum size.

| Key | Default | Effect |
|---|---|---|
| `Whizbang:Workers:InboxDrain:Batcher:SlidingWindow` | 50 ms | Wait after the last signal before fetching. |
| `Whizbang:Workers:InboxDrain:Batcher:MaxWait` | 1 s | Longest wait from the first signal in a batch. |
| `Whizbang:Workers:InboxDrain:Batcher:MaxSize` | 100 | Most stream ids in one batch. |

The outbox drain reads the same shape from `Whizbang:Workers:OutboxDrain:Batcher`. See
[SlidingWindowBatcherOptions](../../operations/configuration/configuration-reference.md#sliding-window-options)
for the full option list.

## Rows this process already holds

The claim re-offers every stream whose rows this instance holds on every poll, and the inbox fetch
returns every leased, unprocessed row of the stream. Without a check, a row already waiting in a
dispatch queue would be copied into it again on each poll. The inbox drain skips any row this process
already [holds](inbox-dispatch.md#held-rows), so a row is queued once however often its stream is
offered. {verified: InboxDrainWorkerGapTests.ExecuteAsync_ARowAlreadyHeld_IsNotQueuedAgainAsync, InboxDrainWorkerGapTests.ExecuteAsync_RepeatedRowsAtCap_HeldRowsAreNotQueuedTwiceAsync}

## Working-set budget {#working-set-budget}

The claim and fetch bounds count rows, not bytes. A storm of large messages could therefore fill a
process with payloads waiting for a dispatch consumer. The inbox drain bounds the payload bytes of
the rows this process holds (queued, dispatching, or awaiting their commit) by
`Whizbang:Workers:InboxDrain:MaxHeldPayloadBytes`, default 128 MiB. Each payload is measured as its
UTF-8 JSON length, read without copying. {verified: InboxChannelWriterHeldRowsTests.HeldPayloadBytes_SumTheHeldPayloads_AndAreReleasedWithTheRowsAsync, InboxChannelWriterHeldRowsTests.HeldPayloadBytes_AreReleasedByALapseAndByTheAgeOutAsync, InboxPayloadTests.Bytes_IsTheUtf8LengthOfThePayloadJsonAsync}

When a fetched row would take the held total past the budget:

- The row is not queued, and neither is the rest of its stream in that fetch, so the stream's order
  holds. The drain does not fetch further from that stream in the same cycle.
- Those rows are handed back to the store with the attempt their claim took refunded. They stay on
  streams this instance owns, so the next claim offers them here again once the working set drains.
- When nothing is held, one row is always admitted, however large, so an oversized message cannot
  stall its stream.

{verified: InboxDrainWorkerGapTests.WorkingSetFull_TheStreamIsNotQueued_AndIsHandedBackUnchargedAsync, InboxDrainWorkerGapTests.WorkingSetFull_InTheInnerLoop_TheRestOfTheStreamIsHandedBackAsync, InboxDrainWorkerGapTests.WorkingSetFull_OnAFullPage_TheStreamIsNotFetchedFurtherAsync, InboxDrainWorkerGapTests.NothingHeld_OneRowIsAdmittedHoweverLarge_ThenTheRestOfItsStreamWaitsAsync}

Each cycle that turns rows away logs one Information line with the held bytes, the budget and the
number of rows handed back. If the hand-back itself fails, it is logged as a Warning: those rows stay
leased until their leases lapse, and the next claim charges each an attempt.
{verified: InboxDrainWorkerGapTests.HandingBackFails_IsLoggedWithWhatItCostsAsync}

Zero (or a negative value) turns the budget off.
{verified: InboxDrainWorkerGapTests.BudgetDisabled_EverythingIsQueuedAsync}

```json{title="Inbox memory budgets" description="The working-set budget for rows held for dispatch and the byte budget of the deserialize cache, shown with their defaults (134217728 bytes = 128 MiB, 67108864 bytes = 64 MiB)" category="Configuration" difficulty="INTERMEDIATE" tags=["Inbox", "Memory", "Configuration", "Backpressure"] tests=["InboxDrainWorkerGapTests.WorkingSetFull_TheStreamIsNotQueued_AndIsHandedBackUnchargedAsync", "InboxDrainWorkerGapTests.BudgetDisabled_EverythingIsQueuedAsync", "InboxDeserializeCacheByteBudgetTests.Options_DefaultTheBudgetTo64MebibytesAsync"]}
{
  "Whizbang": {
    "Workers": {
      "InboxDrain": {
        "MaxHeldPayloadBytes": 134217728
      },
      "InboxDeserializeCache": {
        "MaxBytes": 67108864
      }
    }
  }
}
```

The budget bounds what the drain admits, not what the claim acquires. While the working set is
full, rows the drain turns away are released and claimed again on later polls. No attempts are
charged, but the store sees the extra round trips.

## Log events {#log-events}

Category `Whizbang.Core.Workers.InboxDrainWorker`.

| EventId | Level | When |
|---|---|---|
| 62 | Information | The working set is full: fetched rows were not queued and are handed back uncharged. Carries the held bytes, the budget and the row count. |
| 63 | Warning | Handing back the rows the budget turned away failed; they stay leased until their leases lapse, and the next claim charges each an attempt. |

{verified: InboxDrainWorkerGapTests.WorkingSetFull_TheStreamIsNotQueued_AndIsHandedBackUnchargedAsync, InboxDrainWorkerGapTests.HandingBackFails_IsLoggedWithWhatItCostsAsync}

## Related

- [Claim loop](claim-loop.md)
- [Inbox dispatch](inbox-dispatch.md)
- [Configuration reference](configuration-reference.md#inbox-memory)
- [Claim backpressure](../../operations/workers/claim-backpressure.md)
