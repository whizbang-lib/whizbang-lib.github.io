---
title: Loop Waits and the WakeSet
pageType: reference
audience: [contributor]
status: current
order: 7
description: Every long-running loop in the library waits on its wake sources through one primitive, WakeSet, which keeps one pending wait per source and leaves nothing behind. Why a hand-written Task.WhenAny race leaks, what WakeSet guarantees, its sources, and how WHIZ612 makes it the only path.
tags: contributing, async, workers, channels, memory, wakeset, whiz612, gravity
codeReferences:
  - src/Whizbang.Core/Async/WakeSet.cs
  - src/Whizbang.Core/Async/WakeSignal.cs
  - src/Whizbang.Core/Async/WaitSourceAttribute.cs
  - tools/Whizbang.RepoAnalyzers/HandWrittenWaitRaceAnalyzer.cs
testReferences:
  - tests/Whizbang.Core.Tests/Async/WakeSetTests.cs
  - tests/Whizbang.Core.Tests/Async/WakeSetPermitTests.cs
  - tests/Whizbang.RepoAnalyzers.Tests/HandWrittenWaitRaceAnalyzerTests.cs
---

# Loop Waits and the WakeSet

A worker loop waits for one of several things: an item on a channel, a wake signal, a permit, a readiness gate, or a
timeout. Every such wait in the library goes through **`WakeSet`** (`Whizbang.Core.Async`). Racing waits by hand in
`Task.WhenAny` is a build error ([WHIZ612](../v1.0.0/operations/diagnostics/whiz612.md)), so a new loop falls toward
the correct shape: [gravity](gravity.md) applied to waiting.

## Why a hand-written race leaks

`Task.WhenAny` returns the first task to finish and abandons the rest. An abandoned wait does not go away. It stays
registered wherever it waits until it completes or its token is canceled:

| Loser | Held by | Released when |
|---|---|---|
| `ChannelReader.WaitToReadAsync(token)` | the channel's waiting-reader queue | an item is written, or `token` is **canceled** (disposing its source is not enough) |
| `SemaphoreSlim.WaitAsync(token)` | the semaphore's waiter list | a permit reaches it (which it then holds), or `token` is canceled |
| `Task.Delay(due, time, token)` | the timer queue, and a registration on `token` | `due` passes, or `token` is canceled |
| a `TaskCompletionSource`'s task, a gate's wait | a continuation on that task | the task completes |

A loop that makes fresh waits every pass on the host's stopping token, where "canceled" means never, grows by the
losers of every pass. An idle perspective worker held 630,082 abandoned channel waits after 21.5 hours (#2613); the
wake signal had the same bug before it (#728). The per-race fix (a linked token canceled once the race is decided)
works only while every author remembers it, which is the shape gravity rules out.

## What a WakeSet guarantees

```csharp{title="A worker loop on a WakeSet" description="One pending wait per source across passes, one re-armed timer, and everything released when the set is disposed." category="Workers" difficulty="INTERMEDIATE" tags=["WakeSet", "Workers", "Channels", "Gravity"] tests=["WakeSetTests.IdlePasses_EndedByTheTimeout_KeepOneWaitOnTheChannelAndOneTimerAsync", "WakeSetTests.Dispose_ReleasesEveryWaitTheSetMadeAsync"]}
using var wakes = new WakeSet(timeProvider, stoppingToken);
var work = wakes.Add(workReader);   // a channel
wakes.Add(wakeSignal);              // consumed on every wake but a stop
while (true) {
  var wake = await wakes.WaitAsync(pollInterval);
  if (wake.IsStopped) {
    break;
  }
  if (wake.Woke(work)) {
    // drain the channel
  }
}
```

- **One pending wait per source.** A source asks for a new wait only after its last one completed, so a pass that
  another source ends leaves the wait in place for the next pass, never a second one.
- **One timer.** The timeout is a single timer on the injected `TimeProvider`, made on the first pass that has a
  timeout, armed *before* the sources are (time spent arming them counts against the pass) and stopped as soon as
  another source wins. No pass leaves a delay running.
- **Nothing outlives the set.** Every wait the set makes runs on `WakeSet.Token`, linked to the loop's token.
  Disposing the set cancels it, which releases every pending wait where it is held. A set made for one call (a
  batching window, a single wait with a deadline) leaves nothing behind when the call returns. Hand `Token` to a wait
  made outside the set so it is released too.
- **Levels, as with `WhenAny`.** A source wakes every pass until the loop drains, consumes, takes or stops it. Several
  sources can be ready at once; `Wake.Woke(source)` asks about each.
- **The idle path allocates nothing.** A pass that parks reuses the pending waits, the timer and the awaitable
  (`WakeSetTests.AnIdlePark_AllocatesNothingAsync`).
- **It never throws for a source.** A faulted or canceled source is reported as having fired, as `WhenAny` did; a
  channel source's `LastWait` gives the wait's own answer or fault when awaited.

## Sources

| Add | Wakes when | Notes |
|---|---|---|
| `Add(ChannelReader<T>)` | an item can be read, or the channel completed | `IsChannelCompleted`, `LastWait` |
| `Add(WakeSignal)` | the signal is raised | consumed on every wake but a stop |
| `Add(Task)` | the task completed | a gate, or work the loop waits out; waited on through `Token` |
| `Add(SemaphoreSlim)` | a permit was acquired for it | `TryTake()` once per permit; see below |

### Permits are handed back exactly once

A semaphore source acquires a permit for the loop, but the loop owns it only after `PermitWakeSource.TryTake()`. A
permit acquired and not taken is handed back when the set is disposed, or, when the acquire lands after that, as it
lands. `TryTake` returns true once per permit, so a permit is never kept by a source that lost and never released twice.
The work coordinator gate's interactive acquire races its shared and reserved permits this way.

```csharp{title="Whichever permit frees first" description="The shared permit is taken first; a reserved permit acquired alongside it goes straight back." category="Workers" difficulty="ADVANCED" tags=["WakeSet", "Semaphore", "Permits"] tests=["WakeSetPermitTests.TwoSourcesBothAcquired_TheOneNotTaken_IsHandedBackOnDisposeAsync", "WakeSetPermitTests.AQueuedAcquireThatLandsAfterTheSetIsDisposed_IsHandedBackAsync"]}
using var permits = new WakeSet(TimeProvider.System, cancellationToken);
var shared = permits.Add(sharedSemaphore);
var reserved = permits.Add(reserveSemaphore);
await permits.WaitAsync(deadline);
if (shared.TryTake()) {
  return Grant(sharedSemaphore);
}
if (reserved.TryTake()) {
  return Grant(reserveSemaphore);
}
```

## The analyzer {#the-analyzer}

[WHIZ612](../v1.0.0/operations/diagnostics/whiz612.md) reports any `Task.WhenAny` or `Task.WaitAny` in `src/` that
races a wait. A wait is `Task.Delay`, a channel wait, `SemaphoreSlim.WaitAsync`, a `TaskCompletionSource`'s task,
`WakeSignal.WaitAsync`, or a method marked `[WaitSource]` (the readiness gates are), followed through locals,
conditionals and task adapters. A task the rule cannot place is taken as compute and not reported. There is no accepted
shape and no suppression; the one exemption is `src/Whizbang.Core/Async/WakeSet.cs` itself, by exact path. It replaces
WHIZ611, which covered channel waits only.

To prove a loop of your own holds a bounded number of waits, use the verification kit:
[Testing Loop Waits](testing/loop-waits.md).

## Related

- [Gravity, the Design Principle Behind Whizbang's APIs](gravity.md)
- [Repository Checks and Diagnostic IDs](repository-checks.md)
- [Testing Loop Waits](testing/loop-waits.md)
