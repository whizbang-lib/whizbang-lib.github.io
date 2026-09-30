---
title: Working on Whizbang with an AI Agent
pageType: guide
audience: [contributor]
status: current
order: 4
description: What an AI agent needs to know before changing Whizbang's tests — how tests here pass without testing anything, how to measure coverage truthfully, and what to verify before believing a result
tags: ai-agents, testing, coverage, flaky-tests, verification
---

# Working on Whizbang with an AI Agent

Whizbang is a large, heavily-tested codebase: roughly 65,000 coverable lines of hand-written
library code and well over 11,000 tests in the core suite alone. That scale makes it a good fit
for agent-driven work, and it makes a specific failure mode expensive: **an agent that reports a
green result which is not real.**

This page collects what repeated agent-driven test and coverage work has established. It is not
general AI advice; every item here is a mistake that was actually made in this repository, and the
evidence that corrected it.

## The headline: a passing test here may be testing nothing

Four distinct shapes of test have been found that pass while pinning no behavior. Three share one
root cause, and all four *count as covered* — they execute the lines, so they inflate the coverage
number while guaranteeing nothing.

### The root cause behind three of them

.NET 10 changed `BackgroundService.StartAsync` to:

```csharp
_executeTask = Task.Run(() => ExecuteAsync(_stoppingCts.Token), _stoppingCts.Token);
```

Two consequences that invalidate a great deal of intuition:

1. `ExecuteAsync` no longer runs synchronously up to its first `await`. `StartAsync` returning
   means the worker was **scheduled**, not that it did anything.
2. `Task.Run(action, token)` **never invokes the delegate** when the token is already canceled.
   The task settles `Canceled`, which satisfies both `IsCompleted == true` and
   `IsFaulted == false`.

Measured on one such test: the constructor read 45/45 lines hit and `ExecuteAsync`'s `MoveNext`
read **0/22**. The test was green.

### The four shapes

| Shape | Why it passes | Count found |
|---|---|---|
| `StartAsync` → `StopAsync` → assert *X did not happen* | Equally true of a worker that ran correctly and one that never ran | 46 |
| `StartAsync` → `CancelAsync` → assert `IsCompletedSuccessfully` | Also produces intermittent **failures**: a never-invoked delegate settles `Canceled` | 24 |
| `await` on the task `StartAsync` *returned*, used as a shutdown barrier | That task is `Task.CompletedTask`; the await is a no-op, so post-shutdown assertions read unsettled state | 103 |
| No assertion at all | Nothing is checked; the body still executes | 141 |

The third shape also appears one level down, inside test **fixtures** — a `StopAsync` helper that
awaits the wrong task. Scans over test method bodies miss those entirely.

### The correct pattern

Wait on a signal the code under test actually emits, then assert:

```csharp
await worker.StartAsync(cts.Token);            // await it, so ExecuteTask is populated
await gate.Entered.WaitAsync(TimeSpan.FromSeconds(10));   // a signal the body emits
await cts.CancelAsync();
await worker.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(30))
  .ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
```

`SuppressThrowing` is deliberate: a task exiting through a cancellation catch settles
`RanToCompletion` **or** `Canceled` depending on thread-pool timing, and either is a clean stop.

If a worker exposes no observable signal, adding a small `internal` test seam to the production
type is acceptable and has precedent (`PerStreamSerializer.RunIdleSweepNowAsync`). `internal`,
never `public`.

## Why this matters beyond tidiness

Vacuous tests **conceal product bugs**. A worker's readiness signal was never settled on the
schema-gate cancellation path, so any caller awaiting it parked forever — a real hang, in
production code. It was invisible because the test covering that path cancelled immediately after
`StartAsync`, so the body never ran and "readiness not settled" held for the wrong reason. The bug
surfaced only when the test was made to wait properly.

Several other production defects were found the same way: dead operator diagnostics, an NRE that
silently dropped every registration in an assembly, generated DDL containing a placeholder string.
**Test-correctness work is one of the more productive sources of product bugs in this repository.**

## Measuring coverage truthfully

- **Never conclude a line is covered from a proxy** — not a `<code-under-test>` tag, not a
  `*Tests.cs` filename, not "that assembly has a suite." Confirm with an actual line hit.
- **A local run only instruments the projects you ran.** The repo has ~35 test projects; a local
  sweep is slow and gets OOM-killed on a developer machine.
- **For a whole-repo number, use CI's artifacts.** Every PR run publishes 11 `coverage-*`
  artifacts (unit plus each integration suite). Download and merge them, treating a line as
  uncovered only if **no** report hit it.
- **Match the repo's own filters** or the number is not comparable: `codecoverage.config` excludes
  `.*\.Testing\.dll$`, and reportgenerator drops `*.g.cs`, `*.Generated.cs` and
  `*/.whizbang-generated/*`.
- **The merged report has occasional false positives** — lines it calls uncovered that a scoped
  local run shows hit. Re-measure before writing a test for one.

### Collector failure modes that look like success

A coverage run can report `failed: 0` and produce a plausible file containing nothing useful:

- A **178-byte** cobertura with `<packages />`, caused by two collectors running concurrently.
- A **~950 KB** file containing only `Whizbang.Testing`, with the assembly you care about absent
  entirely — caused by a missing or mismatched `.pdb` when another process rebuilt the project.

Gate on the XML actually containing `name="Whizbang.Core"` (or your target assembly), **not** on
file size. Note the attribute order: `name=` follows `line-rate`, so a grep for
`<package name="…"` never matches.

Coverage is not expected to reach 100%. `ai-docs/coverage-exclusions.md` in the library repo gives
the decision procedure; a substantial share of what remains is Roslyn API-contract guards in the
source generators that cannot fire on valid input.

## Verification discipline

**Write the precise predicate, then validate it by hand before trusting the total.** A grep-level
scan reported "106 sites, most probably benign"; a precise detector — *is the task awaited after a
cancel or stop, i.e. used as a barrier?* — reported 103 broken and 2 benign, the opposite
conclusion. Another crude count said 171 assertion-free tests; excluding `.Throws`, helper-based
and snapshot assertions gave 141. Before trusting either, the detector was checked against one
file by hand: 28 tests, 17 asserting, 11 flagged — exactly right.

**Audit the auditor.** The detector above was, in the end, right — 139 of the 141 tests it
flagged were genuinely assertion-free. But a follow-up check written to *verify* it reported
"102 false positives," and that check was the broken one: it scanned forward to the next `[Test]`
attribute, so it picked up neighbouring tests' assertions and called them the flagged test's own.
A wrong number was briefly reported with confidence. If you write a second tool to check the
first, it needs the same scrutiny as the first — and where they disagree, resolve it by reading
one case by hand rather than by trusting the newer tool.

A related trap: a detector run against the **working tree** while agents are editing measures the
work in progress, not the baseline. Measure against `HEAD` (or a stashed copy) when you want a
count you can compare to later.

**These races do not reproduce on an idle machine.** A finding that a test is vacuous usually has
to be demonstrated under real CPU load, or by simulating the lost race directly (for instance,
cancelling *before* starting, which is what happens when the work item is dequeued after
cancellation). Several sites were only caught this way.

**Say what you did not verify.** One fixture fix could not be reproduced locally at all — the class
passed with the fix and also passed with it reverted, because the development machine never lost
the race that CI's runner did. CI passing was the real evidence, and the commit said so.

## Things that are worse than doing nothing

- **A manufactured assertion.** One that restates what the line above just did looks like coverage
  and pins nothing. A reasoned "left alone, and here is why" is a good outcome.
- **Weakening an assertion to make a test pass.** If a test starts failing once it genuinely waits
  or genuinely asserts, that is a **finding** — the behavior its name promises may not happen.
  Report and diagnose it; do not adjust it away.
- **Widening a timeout to fix a flake.** Fix the cause. Typical real causes here: a `List<T>`
  written by a worker thread and read by the test thread without a lock; reading state the instant
  an `await` returns when the value comes from work the callee did not await; and depending on a
  wake-up the production code's own comments admit can be lost.
- **Acting on a code comment as if it were evidence.** A comment asserting a race was the sole
  justification for a three-cycle retry workaround. It was wrong: the fake had a single sequential
  claimer writing into an unbounded channel, so the drop it guarded against could not happen.
  Deleting the workaround made the test pass 12/12 where it had been failing.

## Changes investigated and correctly *not* made

Recording these matters as much as recording fixes — each looked obviously right:

- Scaling the test-timeout multiplier under load made things **worse** (8/8 green became 4/8) and
  was reverted in full.
- 47 timed `CancellationTokenSource` backstops of 10–60 seconds were left alone: they are
  backstops, not mechanisms, and removing working safety nets on speculation is net-negative.
- A suspected data-loss path in perspective replay was **disproved** by a probe that forced the
  exact state; both events fired exactly once. No issue was filed.

## Working alongside other sessions

This repository is often worked by more than one agent or session at once.

- Stage by **explicit path**. A `git add -A` while other agents were mid-edit once swept ten
  unverified files into a commit.
- Expect build contention: `MSB3021`/`MSB3027` file locks, ILRepack producing a partially-merged
  assembly (a 33 KB output where 94 KB is correct), and builds queueing for tens of minutes. These
  present as code failures and are not.
- Use private scratch paths. Two agents sharing `/tmp/vcov` overwrote each other's baseline.
- Check whether an issue or file is already claimed before starting.

## Where the detail lives

The library repository's `ai-docs/` holds the deeper technical references, and its `CLAUDE.md`
indexes them:

- `ai-docs/flaky-tests.md` — catalogued flaky patterns and their fixes
- `ai-docs/testing-async-patterns.md` — the async test utilities and their intended use
- `ai-docs/testing-tunit.md` — TUnit and Rocks specifics
- `ai-docs/coverage-exclusions.md` — when an uncovered line is a deliberate decision
- `scratchpad/residue.md` — 100+ entries recording individual lines proven unreachable, with the
  reasoning, so later rounds skip rather than re-derive them
