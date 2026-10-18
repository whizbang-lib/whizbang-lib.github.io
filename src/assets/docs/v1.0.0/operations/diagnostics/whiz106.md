---
title: 'WHIZ106: Collective apply must not query other perspectives at apply time'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a [CollectiveApplyFor] method calls a member of ICollectiveQuery, such as query.Of<T>().
  A collective apply that reads a sibling perspective cannot be replayed one row at a time.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - purity
  - collective-events
  - replay
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Core/Perspectives/CollectiveApplyForAttribute.cs
  - src/Whizbang.Core/Perspectives/ICollectiveQuery.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveReplayApplier.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/CollectiveReplayApplierGuardTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ106: Collective apply must not query other perspectives at apply time

**Severity**: Error
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

A `[CollectiveApplyFor]` method returns a spec that changes many perspective rows for one collective event. When a
perspective is rebuilt, that spec is folded again for each row, against a single stream in isolation. A query
against a sibling perspective made while the spec runs cannot be reproduced in that setting, so the collective
effect would be lost on rebuild.

WHIZ106 is reported inside any method marked `[CollectiveApplyFor]` wherever a member is accessed on an expression
whose type is `ICollectiveQuery`, which in practice means a call to `query.Of<T>()`. Each such access is reported at
its location.

It is **not** reported when:

- the method takes an `ICollectiveQuery` parameter but never uses it (a self-referential spec whose `Where` and
  `Set` refer only to the row's own columns and the event), or
- the method that uses `ICollectiveQuery` is not marked `[CollectiveApplyFor]`.

The other determinism checks ([WHIZ100](whiz100) to [WHIZ104](whiz104)) also apply to `[CollectiveApplyFor]`
methods.

## Diagnostic Message

```text
Collective apply method '{MethodName}' calls ICollectiveQuery.Of<>() — an apply-time cross-perspective query. This makes the spec non-replayable: it can't be re-evaluated per-row during a single-stream replay/rebuild. Resolve the cross-query BEFORE event creation and bake the result into the event as static payload, so the apply depends only on the row's own state and the event.
```

## Common Causes

1. **Checking a sibling perspective to decide which rows to change**, for example "does any other overlay with
   this template already exist?".
2. **Reading another perspective's value to copy into the rows** being updated.

## How to Fix

Resolve the cross-perspective fact on the command side, when the event is created, and put the result on the
event. The collective apply then depends only on the row's own state and the event.

### Before (causes WHIZ106)

```csharp{title="Collective apply queries a sibling perspective (causes WHIZ106)" description="Calling query.Of<T>() inside a [CollectiveApplyFor] method is an apply-time cross-perspective query." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["Diagnostics", "Perspectives", "Collective Events", "WHIZ106"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_CollectiveApplyUsesCollectiveQuery_ReportsWHIZ106Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_CollectiveApplyUsesCollectiveQuery_ReportsWHIZ106Async"]}
using System;
using System.Linq;
using Whizbang.Core.Perspectives;

public class OverlayModel {
  public Guid Id { get; set; }
  public Guid GlobalTemplateId { get; set; }
  public bool IsActive { get; set; }
}

public class OverlayAppliedEvent {
  public Guid OverlayId { get; set; }
  public Guid GlobalTemplateId { get; set; }
}

public class OverlayHandler {
  [CollectiveApplyFor(ScopeHandling = CollectiveScopeHandling.Custom)]
  public ICollectiveSpec<OverlayModel> ClearSiblings(OverlayAppliedEvent e, ICollectiveQuery query) {
    // WHIZ106: query.Of<>() reads a sibling perspective while the spec runs
    var exists = query.Of<OverlayModel>().Any(o => o.Data.GlobalTemplateId == e.GlobalTemplateId);
    return null!;
  }
}
```

### After (no diagnostic)

```csharp{title="Self-referential collective apply" description="A collective apply that takes ICollectiveQuery but never uses it is replay-safe and not reported." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["Diagnostics", "Perspectives", "Collective Events", "WHIZ106"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_SelfReferentialCollectiveApply_NoWHIZ106Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_SelfReferentialCollectiveApply_NoWHIZ106Async"]}
using System;
using Whizbang.Core.Perspectives;

public class OverlayModel {
  public Guid Id { get; set; }
  public Guid GlobalTemplateId { get; set; }
  public bool IsActive { get; set; }
}

public class OverlayAppliedEvent {
  public Guid OverlayId { get; set; }
  public Guid GlobalTemplateId { get; set; }
}

public class OverlayHandler {
  // Where on the row's own GlobalTemplateId, Set IsActive = (Id == e.OverlayId).
  // The query parameter is kept for signature parity but never touched.
  [CollectiveApplyFor(ScopeHandling = CollectiveScopeHandling.Custom)]
  public ICollectiveSpec<OverlayModel> SetActive(OverlayAppliedEvent e, ICollectiveQuery query) {
    return null!;
  }
}
```

## If the Diagnostic Is Suppressed

The build-time check has a runtime backstop. When the in-memory replay path in the Postgres data package folds a
collective apply, the `ICollectiveQuery` it passes in throws `NotSupportedException` from `Of<T>()`, with a message
that names WHIZ106. A rebuild of a perspective with such a spec stops instead of completing with wrong data.

## Related

- [WHIZ104: Apply method should use event timestamps](whiz104)
- [Collective Events](../../fundamentals/messaging/collective-events)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
