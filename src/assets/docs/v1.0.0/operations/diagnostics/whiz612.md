---
title: 'WHIZ612: Wait Raced in Task.WhenAny by Hand Instead of on a WakeSet'
pageType: troubleshooting
version: 1.0.0
description: >-
  A repository check: library code races a wait (a delay, a channel wait, a
  semaphore wait, a completion source's task, a wake signal, or a readiness
  gate) in Task.WhenAny or Task.WaitAny by hand, and the loser stays registered
  wherever it waits
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - async
  - memory
  - analyzer
  - wakeset
codeReferences:
  - tools/Whizbang.RepoAnalyzers/HandWrittenWaitRaceAnalyzer.cs
  - src/Whizbang.Core/Async/WakeSet.cs
  - src/Whizbang.Core/Async/WaitSourceAttribute.cs
testReferences:
  - tests/Whizbang.RepoAnalyzers.Tests/HandWrittenWaitRaceAnalyzerTests.cs
  - tests/Whizbang.Core.Component.Tests/Async/WakeSetTests.cs
---

# WHIZ612: Wait Raced in Task.WhenAny by Hand Instead of on a WakeSet

**Severity**: Error
**Raised by**: `Whizbang.RepoAnalyzers` (Roslyn analyzer)

This is a check on the Whizbang repository's own library code. It runs only in this repository's builds and never ships in a package, so an application that uses Whizbang never sees it. Tests, tools, samples and benchmarks are outside it. See [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md) for the whole block.

## What it means

A `Task.WhenAny` or `Task.WaitAny` in `src/` races a **wait**: a task that completes when something happens elsewhere. The rule knows `Task.Delay`, a channel's `WaitToReadAsync`, `ReadAsync`, `WaitToWriteAsync` and `WriteAsync`, `SemaphoreSlim.WaitAsync`, a `TaskCompletionSource`'s `Task`, `WakeSignal.WaitAsync`, and any method marked `[WaitSource]` (the readiness gates are). It follows them through locals, conditionals, `?.`, `??`, arrays, collection expressions and the adapters `AsTask`, `WaitAsync`, `ContinueWith` and `ConfigureAwait`.

```csharp{title="A race WHIZ612 reports" description="Each pass the delay wins leaves a wait on the channel until the stopping token is canceled." category="Diagnostics" difficulty="ADVANCED" tags=["whiz612", "repository-check", "wakeset", "analyzer"] tests=["HandWrittenWaitRaceAnalyzerTests.AWaitHeldInALocal_AssignedOrInitialized_ThenRaced_ReportsAsync", "HandWrittenWaitRaceAnalyzerTests.ADelayRaced_ReportsTheRaceAndNamesTheWaitAsync"]}
while (!stopping.IsCancellationRequested) {
  var wait = reader.WaitToReadAsync(stopping).AsTask();
  await Task.WhenAny(wait, Task.Delay(idle, timeProvider, stopping));
  // ...
}
```

No shape of a hand-written race is accepted. That includes a per-race token canceled once the race is decided, which only works while every author remembers it.

## Why it matters

A wait that loses the race is abandoned, but it stays registered wherever it waits until it completes or its token is canceled. A channel keeps the queued reader, a semaphore keeps the waiter, and a delay keeps its timer and its registration on the token. On a worker's stopping token that is the life of the process, so a loop that races fresh waits every pass grows by the losers of every pass. An idle worker grew by several megabytes an hour this way (#2613).

## How to fix it

Wait on a [WakeSet](../../../contributors/loop-waits.md). It keeps one pending wait per source across passes, uses one timer on the injected clock that it stops when another source wins, and releases every wait it made when it is disposed:

```csharp{title="Clearing WHIZ612 with a WakeSet" description="The same loop on a WakeSet: one channel wait and one timer, whatever the number of passes." category="Diagnostics" difficulty="ADVANCED" tags=["whiz612", "repository-check", "wakeset", "analyzer"] tests=["WakeSetTests.IdlePasses_EndedByTheTimeout_KeepOneWaitOnTheChannelAndOneTimerAsync", "WakeSetTests.Passes_WonByAChannel_StopTheTimerSoNoStaleTimeoutEndsALaterPassAsync"]}
using var wakes = new WakeSet(timeProvider, stopping);
var work = wakes.Add(reader);
while (true) {
  var wake = await wakes.WaitAsync(idle);
  if (wake.IsStopped) {
    break;
  }
  // ...
}
```

A window that races one wait against a deadline uses a set per window (`using var window = new WakeSet(...)`). A semaphore race uses permit sources (`Add(SemaphoreSlim)` and `TryTake()`). A single task with a deadline needs no race at all: `task.WaitAsync(timeout, timeProvider, token)`.

There is no suppression. The one exemption is `src/Whizbang.Core/Async/WakeSet.cs` itself, by exact path.

## What it cannot see

A task that the rule cannot place is taken as compute and not reported: a parameter, a field, or the result of any method that is not a known wait or marked `[WaitSource]`. Mark a new gate's wait method with `[WaitSource]` so a race over it is caught.

## Related

- [Loop Waits and the WakeSet](../../../contributors/loop-waits.md)
- [WHIZ611](whiz611.md), the channel-only rule this one replaces
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
