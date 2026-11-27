---
title: 'WHIZ611: Channel Wait Raced in Task.WhenAny Is Never Released (retired)'
pageType: troubleshooting
version: 1.0.0
description: >-
  Retired. WHIZ611 was a repository check on channel waits raced in Task.WhenAny. It was folded into WHIZ612,
  which reports every wait raced by hand; the ID is never reused.
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - repository-check
  - channels
  - memory
  - analyzer
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - tools/Whizbang.RepoAnalyzers/HandWrittenWaitRaceAnalyzer.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
  - tests/Whizbang.RepoAnalyzers.Tests/HandWrittenWaitRaceAnalyzerTests.cs
---

# WHIZ611: Channel Wait Raced in Task.WhenAny Is Never Released (retired)

**Status**: Retired in [#2617](https://github.com/whizbang-lib/whizbang/issues/2617). No longer reported.
**Former severity**: Error (repository check)

## Retired

WHIZ611 is **retired**. It was folded into [WHIZ612](whiz612.md), which reports a `Task.WhenAny` or `Task.WaitAny` over
any wait in the library (a delay, a channel wait, a semaphore wait, a completion source's task, a wake signal or a
readiness gate), not only a channel wait. Every such race in the library now goes through a
[WakeSet](../../../contributors/loop-waits.md).

The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for it can never match a
different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ611 reported a channel wait (`WaitToReadAsync`, `ReadAsync`, `WaitToWriteAsync` or `WriteAsync`) turned into a task
and raced in `Task.WhenAny`, unless its token was the `Token` of a local `CancellationTokenSource` the method canceled.
A wait that lost the race stayed queued in the channel until its token was canceled, which on a worker's stopping token
is the life of the process (#2613). It accepted two fixes: one pending wait kept across passes, or a per-race token
canceled once the race was decided. WHIZ612 accepts neither: the race is written once, in `WakeSet`.

## Related

- [WHIZ612: Wait Raced in Task.WhenAny by Hand Instead of on a WakeSet](whiz612.md)
- [Loop Waits and the WakeSet](../../../contributors/loop-waits.md)
- [Repository Checks and Diagnostic IDs](../../../contributors/repository-checks.md)
