---
title: SyncMode — Read-After-Write Dispatch
version: 1.0.0
category: Fundamentals
order: 5
description: >-
  The CT-only LocalInvokeAndSyncAsync(message, SyncMode, ct) overload —
  explicit read-after-write expectation at every callsite; no implicit
  timeouts.
tags: 'dispatcher, sync, cqrs, read-after-write, sync-mode'
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Perspectives/Sync/SyncMode.cs
---

# SyncMode — Read-After-Write Dispatch

The dispatcher provides multiple overloads of `LocalInvokeAndSyncAsync` for in-process command/event dispatch with completion synchronization. The W4 `SyncMode`-parameterized overload is the modern shape: CancellationToken-only (no `TimeSpan` timeout), explicit per-call read-after-write expectation.

## The contract

```csharp
public enum SyncMode {
  /// Wait until events are durably written + the local stream version
  /// has caught up. Does NOT wait for perspectives.
  StreamOnly,

  /// Wait until every locally-registered perspective that subscribes
  /// to the emitted event types has finished projecting.
  AllProjections,
}

ValueTask LocalInvokeAndSyncAsync<TMessage>(
    TMessage message,
    SyncMode mode,                              // required (no default)
    CancellationToken cancellationToken = default)
    where TMessage : notnull;
```

`SyncMode` has **no default value**. Every callsite must declare its read-after-write expectation explicitly. Two reasons:

1. **Disambiguation**: a defaulted `SyncMode` would conflict with the legacy timeout-shaped overloads (both methods would match `LocalInvokeAndSyncAsync(cmd)`).
2. **Design intent**: read-after-write vs. fast-path is a meaningful per-call decision. Burying it in a default hides the cost; making it explicit surfaces intent at the callsite.

`CancellationToken` is the **only wait bound**. There is no `TimeSpan` timeout parameter. Perspective health is an observability concern, not a per-call defense — wrap your own `CancellationTokenSource(TimeSpan.FromMinutes(2))` if you want a timeout. The framework doesn't provide one for you.

## When to use which mode

| Mode | Use when | Performance |
|---|---|---|
| `SyncMode.AllProjections` | The caller reads from any local perspective in the same request (the normal CQRS case). | Pays the cost of awaiting every subscribed perspective's signal. |
| `SyncMode.StreamOnly` | The caller doesn't read after writing in this request, or perspective-sync latency is unacceptable for a hot bulk path. | Returns at stream catchup. No perspective wait. |

```csharp
// Read-after-write: dispatch + wait for projections before the next read
await dispatcher.LocalInvokeAndSyncAsync(
    new CreateOrderCommand { /* … */ },
    SyncMode.AllProjections,
    cancellationToken);

var order = await orderRepo.GetByIdAsync(orderId, cancellationToken);
// order is guaranteed to be visible

// Fast path: dispatch + return, no perspective wait
await dispatcher.LocalInvokeAndSyncAsync(
    new BulkUpdateCommand { /* … */ },
    SyncMode.StreamOnly,
    cancellationToken);
// No read after this point in the request; perspectives catch up async
```

## Migration from the timeout-shaped overloads

The three legacy overloads carry `[Obsolete]` attributes pointing at the new API:

```csharp
// LEGACY (Obsolete in W4, removed in next major)
await dispatcher.LocalInvokeAndSyncAsync(
    cmd, timeout: TimeSpan.FromSeconds(30));

// NEW
await dispatcher.LocalInvokeAndSyncAsync(
    cmd, SyncMode.AllProjections, cancellationToken);
```

For callers using the typed-result overload `<TMessage, TResult>`, split into `LocalInvokeAsync<TResult>` plus an optional sync step:

```csharp
// LEGACY
var result = await dispatcher.LocalInvokeAndSyncAsync<CreateOrder, OrderResult>(
    cmd, timeout: TimeSpan.FromSeconds(10));

// NEW (when read-after-write needed)
var result = await dispatcher.LocalInvokeAsync<OrderResult>(cmd);
await dispatcher.LocalInvokeAndSyncAsync(new NoOpSyncSentinel(), SyncMode.AllProjections, cancellationToken);
```

If splitting isn't practical, the legacy overload still functions (it's `[Obsolete]`-warned, not removed). Migrate when convenient.

## Why no implicit timeout

Two failure modes the timeout shape encourages but signal-based dispatch handles correctly:

1. **Cold start.** Docker bootstrap, slot warmup, or first-event-after-deploy can exceed any single fixed default (30s, 60s, even 5min). A `TimeSpan` parameter pushes the caller to guess; getting it wrong fails tests under load that pass on warm machines.
2. **Defensive polling on top of the call.** Callers that don't trust the dispatcher's wait wrap it in `PollUntilAsync(100ms, 15s)` — two timers stacked, neither tuned for the actual workload. The W4 design forces this question to the surface: if the dispatcher's wait isn't fast enough, the issue is the perspective, not the caller.

`CancellationToken`-only means the caller's own request boundaries (HTTP request timeout, hosted-service shutdown CT, etc.) are the wait bound. If you want a 2-minute upper bound for a specific call, construct a linked CTS:

```csharp
using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(httpContext.RequestAborted);
linkedCts.CancelAfter(TimeSpan.FromMinutes(2));

await dispatcher.LocalInvokeAndSyncAsync(cmd, SyncMode.AllProjections, linkedCts.Token);
```

## Observability

The dispatcher emits a histogram `whizbang.dispatcher.sync_wait_ms` tagged by perspective count. P99 tail growth indicates perspectives slowing down — a deploy-time / pager-time signal, not a per-call defense.
