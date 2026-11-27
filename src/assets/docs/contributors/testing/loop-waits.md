---
title: Testing Loop Waits
pageType: reference
audience: [contributor]
status: current
order: 1
description: The verification kit in Whizbang.Testing that proves a long-running loop leaves no wait behind - a counting channel reader, a counting clock, a wait budget and a garbage-collector release check - and how to use it on a hosted service of your own.
tags: contributing, testing, async, workers, channels, memory, wakeset
codeReferences:
  - src/Whizbang.Testing/Async/CountingChannelReader.cs
  - src/Whizbang.Testing/Async/CountingTimeProvider.cs
  - src/Whizbang.Testing/Async/LoopWaitBudget.cs
  - src/Whizbang.Testing/Async/ReleaseCheck.cs
testReferences:
  - tests/Whizbang.Testing.Tests/Async/LoopWaitProbeTests.cs
---

# Testing Loop Waits

A loop that leaves a wait behind on each pass fails only when memory does, hours into an idle instance. The kit in
`Whizbang.Testing.Async` turns that into an exact, synchronous assertion: count what the loop still holds after each
pass, never by timing and never by reading the heap. The library's own loops are held to it (see
[Loop Waits and the WakeSet](../loop-waits.md)).

## The tools

| Type | What it counts or checks |
|---|---|
| `CountingChannelReader<T>(inner, onWait?)` | `WaitCalls` and `OutstandingWaits` (waits neither completed nor canceled), passing reads, peeks and counts to the channel's own reader. `onWait` runs as each wait is made, numbered from one. |
| `CountingTimeProvider(inner)` | Over a fake clock: `LiveTimers`, `ArmedTimers` (given a due time and neither fired, stopped nor disposed), `CreatedTimers`, `TimesArmed`, and the signals `Created(n)` and `Armed(n)`. A losing delay left running is an armed timer; a loop on a `WakeSet` re-arms one timer, so step it with `Armed(n)`. |
| `LoopWaitBudget` | `.AtMost(name, count, k)` for any number of counters, then `RunAsync(passes, pass)`: drives the passes, checks every counter after each, throws `LoopWaitBudgetExceededException` naming the counter and pass, and returns each counter's highest count. |
| `ReleaseCheck.IsReleased(abandon)` | Makes and drops an object in a frame of its own and runs a full collection: whether anything still keeps it. For holders no seam can count, such as token registrations and task continuations. |

Every released case needs a kept control under the same helpers, and a release has to be complete when `abandon`
returns: a completion that finishes on the thread pool reads as kept for a moment. Make it synchronous (a channel with
`AllowSynchronousContinuations`, a `Cancel` rather than a `CancelAsync`), or wait on the work's own signal first.

## On a hosted service of your own

The service has to take its channel reader and its clock by injection, which is what the gravity principle asks of it
already. Then each idle pass is driven by the clock and the budget holds the waits:

```csharp{title="An application's own pump held to a wait budget" description="One hundred idle passes, each ended by its timeout on the fake clock, may hold at most one wait on the inbox and one armed timer." category="Testing" difficulty="INTERMEDIATE" tags=["Testing", "WakeSet", "Workers", "Channels"] tests=["LoopWaitProbeTests.Budget_ALoopThatReusesItsWait_StaysWithinItAndReportsTheHighestCountAsync", "LoopWaitProbeTests.Budget_ALoopThatAsksForAFreshWaitEachPass_FailsOnTheFirstPassOverItAsync"]}
var fake = new FakeTimeProvider();
var clock = new CountingTimeProvider(fake);
var inbox = Channel.CreateUnbounded<Order>();
var reader = new CountingChannelReader<Order>(inbox.Reader);
var service = new OrderPump(reader, clock);
await service.StartAsync(CancellationToken.None);

await new LoopWaitBudget()
  .AtMost("inbox waits", () => reader.OutstandingWaits, 1)
  .AtMost("armed timers", () => clock.ArmedTimers, 1)
  .RunAsync(100, async pass => {
    await clock.Armed(pass);                  // the pass is parked on its timeout
    fake.Advance(TimeSpan.FromSeconds(1));    // which ends it
  });
```

A budget that is exceeded fails on the first pass over it, with the counter's name, so the leak is found on pass 2,
not after an hour.

## Limits

`Whizbang.Testing` is the repository's shared test library and is not published as a package today, because it brings
the test frameworks and container tooling the repository's own tests use. The kit lives there so the library's tests
use it; making it available to applications is a separate decision.

## Related

- [Loop Waits and the WakeSet](../loop-waits.md)
- [Gravity, the Design Principle Behind Whizbang's APIs](../gravity.md)
