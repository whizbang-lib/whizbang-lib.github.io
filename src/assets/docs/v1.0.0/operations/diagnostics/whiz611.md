---
title: 'WHIZ611: Channel Wait Raced in Task.WhenAny Is Never Released'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: library code races a channel wait in Task.WhenAny and
  nothing cancels it when another task wins, so the channel keeps the waiter
  for as long as its token lives
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - channels
  - memory
  - analyzer
codeReferences:
  - tools/Whizbang.RepoAnalyzers/AbandonedChannelWaitAnalyzer.cs
  - src/Whizbang.Core/Async/PendingChannelWait.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/AbandonedChannelWaitAnalyzerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ChannelWaitReleaseTests.cs
---

# WHIZ611: Channel Wait Raced in Task.WhenAny Is Never Released

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own library code. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. Tests, tools, samples and benchmarks are outside it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A wait on a channel (`WaitToReadAsync`, `ReadAsync`, `WaitToWriteAsync` or `WriteAsync` on a `ChannelReader<T>` or `ChannelWriter<T>`) is turned into a task with `AsTask()` and raced in `Task.WhenAny`, directly or through a local, and its token is not one the method cancels once the race is decided:

```csharp{title="The race WHIZ611 reports" description="Each pass that the delay wins abandons a wait the channel keeps until the stopping token is canceled." category="Diagnostics" difficulty="ADVANCED" tags=["whiz611", "repository-check", "channels", "analyzer"] tests=["AbandonedChannelWaitAnalyzerTests.WaitHeldInALocal_ThenRaced_ReportsAsync", "AbandonedChannelWaitAnalyzerTests.WaitRacedDirectly_OnALongLivedToken_ReportsAsync"]}
while (!stopping.IsCancellationRequested) {
  var wait = reader.WaitToReadAsync(stopping).AsTask();
  await Task.WhenAny(wait, Task.Delay(idle, stopping));
  // ...
}
```

## Why it matters

When another task wins the race, the channel wait is abandoned, but the channel does not know that. An unbounded or bounded channel keeps every waiting reader queued until an item is written or the reader's token is canceled. A loop that asks for a fresh wait on the host's stopping token every pass, and is woken by a timeout or a signal, queues one more waiter per idle pass for the life of the process. Each one keeps a few small objects alive, and an idle worker passing about twice a second grows by several megabytes an hour without bound (#2613).

Disposing a linked `CancellationTokenSource` does not cancel its token, so a `using` declaration alone does not release the wait. The source has to be canceled.

## How to fix it

Keep one pending wait across passes and ask for a new one only once it has completed. `PendingChannelWait<T>` does exactly that, the way `WakeSignal` does for the wake signal:

```csharp{title="Clearing WHIZ611 by reusing one wait" description="The pending wait carries over to the next pass, so the channel never holds more than one waiter from this loop." category="Diagnostics" difficulty="ADVANCED" tags=["whiz611", "repository-check", "channels", "analyzer"] tests=["AbandonedChannelWaitAnalyzerTests.WaitHeldInAFieldThenRaced_ReportsNothingAsync", "PendingChannelWaitTests.WaitAsync_RepeatedWhilePending_ReturnsTheSameTaskAsync"]}
var waits = new PendingChannelWait<int>(reader);
while (!stopping.IsCancellationRequested) {
  await Task.WhenAny(waits.WaitAsync(stopping), Task.Delay(idle, stopping));
  // ...
}
```

Or give each race a token of its own and cancel it once `WhenAny` returns, which suits a batching window that ends for good when its deadline passes:

```csharp{title="Clearing WHIZ611 with a per-race token" description="Canceling the linked source takes the losing wait off the channel's queue; disposing it alone would not." category="Diagnostics" difficulty="ADVANCED" tags=["whiz611", "repository-check", "channels", "analyzer"] tests=["AbandonedChannelWaitAnalyzerTests.WaitOnALinkedToken_CanceledWithCancelAsync_ReportsNothingAsync", "AbandonedChannelWaitAnalyzerTests.WaitOnALinkedToken_WhoseSourceIsOnlyDisposed_ReportsAsync"]}
using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(stopping);
var arrival = reader.WaitToReadAsync(waitCts.Token).AsTask();
await Task.WhenAny(arrival, Task.Delay(window, timeProvider, waitCts.Token));
await waitCts.CancelAsync();
```

## What it cannot see

The rule follows a wait from the call that makes it to `Task.WhenAny` within one method. A wait stored in a field, returned from a helper, or held as a `ValueTask` before `AsTask()` is not traced, and a token is accepted only when it is the `Token` of a local source that the same method cancels.

## Related

- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
