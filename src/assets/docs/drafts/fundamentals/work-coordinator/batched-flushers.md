---
title: Batched flushers
order: 4
---

# Batched flushers

Four batched flush workers turn high-frequency completion writes into coalesced batches with one fsync per batch. All built on the same `BatchFlusher<T>` primitive (Nagle pattern over a bounded channel).

## The pattern

```
Producer enqueues item     ─┐
                            ├──►  BatchFlusher<T> (bounded channel)
Producer enqueues item     ─┤      ─ wait for first item
Producer enqueues item     ─┘      ─ then coalesce additional items for CoalesceWindowMs
                                   ─ OR until MaxBatchSize OR ImmediateFlushThreshold
                                                  │
                                                  ▼
                                          await FlushAsync(IReadOnlyList<T>, ct)
                                                  │
                                                  ▼
                                          IWorkCoordinator.<MethodPerCategory>(batch)
```

## The four batched flush workers

| Worker | Channel item | SQL function | Default tuning |
|---|---|---|---|
| `OutboxCompletionFlushWorker` | `Guid` (outbox message id) | `complete_outbox_published` | 500 max / 10 ms / 250 immediate |
| `PerspectiveCompletionFlushWorker` | `PerspectiveCompletionItem` (event_work_id OR cursor) | `complete_perspective` | 1000 max / 25 ms / 500 immediate |
| `FailureFlushWorker` | `CategorizedFailure` (category + MessageFailure) | `report_failures` per category | 100 max / 100 ms / 50 immediate |
| `LeaseRenewalWorker` | `CategorizedLeaseRenewal` (category + Guid) | `renew_leases` per category | 200 max / 200 ms / 100 immediate |

Each follows the same shape: a `BackgroundService` exposing a channel-writer interface, owning a `BatchFlusher<T>` that calls the appropriate `IWorkCoordinator` method per batch.

## Tuning knobs

Each flusher has `BatchFlusherOptions`:

| Knob | Effect |
|---|---|
| `ChannelCapacity` | Bounded back-pressure when full. |
| `MaxBatchSize` | Cap on items per flush call. |
| `CoalesceWindowMs` | Max wait coalescing additional items after the first. |
| `ImmediateFlushThreshold` | Flush early when batch reaches this size. |

Override via `Whizbang:Flushers:<Worker>:Flusher:<Knob>`.

## Why this pattern wins

Each flush call costs: round-trip + fsync (typically 3-10 ms). Doing one round-trip per completion at 1000 completions/sec = 1000 fsyncs/sec; postgres can't keep up.

With Nagle (25 ms window, 1000 max): 1000 completions/sec coalesces into 40 calls/sec; 25× fewer round-trips, 25× fewer fsyncs. Latency for any individual completion rises from ~3-10 ms to ~25-35 ms — acceptable for fire-and-forget completion semantics.

## Composite flush

When the C# layer has multiple categories buffered, `flush_completions` SQL function combines them into one round-trip (covered by a single fsync at the outer commit). Used by future work that wires multiple flushers to a shared connection; today the per-worker flushers commit independently.

## Failure handling

If a flush throws:
- `BatchFlusher` logs a warning and continues to the next batch.
- The items in the failed batch are LOST — caller's responsibility to make the flush idempotent.

For Whizbang's coordinator methods, all flush calls are idempotent (UPDATE WHERE processed_at IS NULL — already-processed rows ignored). So lost items get retried on the next claim tick when their lease expires and they're re-claimed.

## InboxHandlerWorker — special case

`InboxHandlerWorker` is also a batched flusher (uses the same `BatchFlusher<T>` primitive) but its SQL call is `commit_handler_batch` which has SAVEPOINT-per-handler isolation. Per-handler failures are routed to `FailureFlushWorker` for retry tracking instead of being silently lost. See [Handler commit](handler-commit.md).

## Related

- [Handler commit](handler-commit.md)
- [Configuration reference](configuration-reference.md)
- [Performance tuning](performance-tuning.md)
