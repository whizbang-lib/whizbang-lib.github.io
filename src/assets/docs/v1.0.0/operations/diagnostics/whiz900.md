---
title: 'WHIZ900: Perspective Sync in Inline Receptor'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a receptor that fires at an Inline lifecycle stage calls WaitForStreamAsync, WaitAsync or
  WaitForAppliedAsync on the perspective sync awaiter. Waiting for perspectives from an Inline stage deadlocks the work coordinator.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - receptors
  - perspective-sync
  - lifecycle
  - deadlock
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveSyncInReceptorAnalyzer.cs
  - src/Whizbang.Core/Perspectives/Sync/IPerspectiveSyncAwaiter.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveSyncInReceptorAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveSyncInReceptorAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ900: Perspective Sync in Inline Receptor

**Severity**: Error
**Category**: Receptor Safety (`Whizbang.ReceptorSafety`)

## Description

An Inline lifecycle stage holds up the work that triggered it until the receptor finishes. If that receptor waits
for a perspective to catch up, it waits on perspective commits that the work coordinator cannot process while it is
blocked by the receptor. The result is a deadlock. Waiting is safe from a Detached stage, which runs without
holding up the pipeline.

The `PerspectiveSyncInReceptorAnalyzer` reports WHIZ900 at each call site that matches all of these:

- the called method is named `WaitForStreamAsync`, `WaitAsync` or `WaitForAppliedAsync`, and its containing type's
  name contains `PerspectiveSyncAwaiter` (so both `IPerspectiveSyncAwaiter` and a concrete awaiter class match;
  `SemaphoreSlim.WaitAsync` does not);
- the call is inside a class that implements `IReceptor<...>` or `ISyncReceptor<...>` (any member of the class);
- the class fires at an Inline stage:
  - with one or more `[FireAt]` attributes, at least one of them names an Inline stage. A stage is Inline when its
    name ends in `Inline`, so every Inline `LifecycleStage` member counts, including `PreDestructionInline` and
    `PostDestructionInline`. The first Inline stage found is the one reported;
  - with no `[FireAt]` attribute, the analyzer treats the receptor as Inline and reports `LocalImmediateInline`.

A receptor whose `[FireAt]` attributes are all Detached stages is not reported. A struct, or a class that is not a
receptor, is not reported. `IsCaughtUpAsync` does not wait, so it is not reported.

The suggested stage in the message is the reported stage with `Inline` replaced by `Detached`, for example
`PostInboxInline` becomes `PostInboxDetached`.

## Diagnostic Message

```text
Receptor '{ReceptorName}' calls {MethodName} but fires at Inline stage '{InlineStage}'. This will deadlock. Use [FireAt(LifecycleStage.{DetachedStage})] or event enrichment.
```

## Common Causes

1. **A receptor with `[FireAt(...Inline)]`** that waits for a perspective before reading it through a lens.
2. **A receptor with no `[FireAt]`** that calls the awaiter directly. The analyzer reports these as Inline (see the
   note below).
3. **Mixed stages.** A receptor with `[FireAt(PostInboxDetached)]` and `[FireAt(PostAllPerspectivesInline)]` is
   reported for the Inline stage.

## How to Fix

- Move the receptor to a Detached stage, for example `[FireAt(LifecycleStage.PostInboxDetached)]`, as the message
  suggests. Remove any Inline `[FireAt]` that remains on the class.
- Or use event enrichment: carry the data the receptor needs on the event, so it does not have to query a
  perspective at all.

### Before (causes WHIZ900)

```csharp{title="Inline receptor waits for a perspective (causes WHIZ900)" description="WaitForStreamAsync inside a receptor that fires at PostInboxInline is reported as WHIZ900." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Receptors", "Perspective Sync", "WHIZ900"] testFile="PerspectiveSyncInReceptorAnalyzerTests.cs" testMethod="Analyzer_InlineStageReceptor_WaitForStreamAsync_ReportsDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PerspectiveSyncInReceptorAnalyzerTests.cs" tests=["PerspectiveSyncInReceptorAnalyzerTests.Analyzer_InlineStageReceptor_WaitForStreamAsync_ReportsDiagnosticAsync"]}
using System;
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;
using Whizbang.Core.Messaging;
using Whizbang.Core.Perspectives.Sync;

public class MyEvent : IEvent { }

[FireAt(LifecycleStage.PostInboxInline)]
public class InlineStageReceptor : IReceptor<MyEvent> {
  private readonly IPerspectiveSyncAwaiter _awaiter;
  public InlineStageReceptor(IPerspectiveSyncAwaiter awaiter) => _awaiter = awaiter;

  public async ValueTask HandleAsync(MyEvent message, CancellationToken ct) {
    // WHIZ900: suggests [FireAt(LifecycleStage.PostInboxDetached)]
    await _awaiter.WaitForStreamAsync(typeof(object), Guid.NewGuid(), null, TimeSpan.FromSeconds(5), null, ct);
  }
}
```

### After (no diagnostic)

```csharp{title="Detached receptor waits for a perspective" description="The same wait from a receptor that fires at PostInboxDetached is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Receptors", "Perspective Sync", "WHIZ900"] testFile="PerspectiveSyncInReceptorAnalyzerTests.cs" testMethod="Analyzer_DetachedStageReceptor_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/Analyzers/PerspectiveSyncInReceptorAnalyzerTests.cs" tests=["PerspectiveSyncInReceptorAnalyzerTests.Analyzer_DetachedStageReceptor_NoDiagnosticAsync"]}
using System;
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;
using Whizbang.Core.Messaging;
using Whizbang.Core.Perspectives.Sync;

public class MyEvent : IEvent { }

[FireAt(LifecycleStage.PostInboxDetached)]
public class DetachedReceptor : IReceptor<MyEvent> {
  private readonly IPerspectiveSyncAwaiter _awaiter;
  public DetachedReceptor(IPerspectiveSyncAwaiter awaiter) => _awaiter = awaiter;

  public async ValueTask HandleAsync(MyEvent message, CancellationToken ct) {
    await _awaiter.WaitForStreamAsync(typeof(object), Guid.NewGuid(), null, TimeSpan.FromSeconds(5), null, ct);
  }
}
```

## Note on Receptors Without `[FireAt]`

The analyzer treats a receptor with no `[FireAt]` as Inline and reports it, naming `LocalImmediateInline` and
suggesting `LocalImmediateDetached`. That matches the generator, which registers such a receptor at
`LocalImmediateInline` and `PostInboxDetached`, and a local caller waits for it. Moving the wait to
`[FireAt(LocalImmediateDetached)]` makes the receptor a background hook that runs after the message's handler, so it
no longer is the handler: give the message another handler, or move the wait out of the handler with event
enrichment (see [Lifecycle Stages](../../fundamentals/lifecycle/lifecycle-stages#localimmediatedetached)).

## Related

- [Perspective Sync](../../fundamentals/perspectives/perspective-sync)
- [Lifecycle Stages](../../fundamentals/lifecycle/lifecycle-stages)
- [Lifecycle Receptors](../../fundamentals/receptors/lifecycle-receptors)
- [Receptors](../../fundamentals/receptors/receptors)
