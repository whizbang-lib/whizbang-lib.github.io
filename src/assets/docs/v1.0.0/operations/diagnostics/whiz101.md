---
title: 'WHIZ101: Apply method cannot use async/await'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a perspective Apply method (or a [CollectiveApplyFor] method) contains an await expression.
  Apply must be a synchronous, pure function so that replay produces the same model every time.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - purity
  - apply
  - await
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveDiscoveryHelper.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ101: Apply method cannot use async/await

**Severity**: Error
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

An `await` inside `Apply` means the fold waits on something outside the event and the current model. On a rebuild
the framework runs `Apply` once per stored event, so every awaited call is repeated across the whole history, and
whatever it returns is today's answer rather than the answer at the time the event happened.

WHIZ101 is reported once per method when the method body contains at least one `await` expression. It applies to
the same methods as [WHIZ100](whiz100): a method named `Apply` on a perspective class (`IPerspectiveFor`,
`IPerspectiveWithActionsFor`, `IPerspectiveBase`, `IGlobalPerspectiveFor`) and any method marked
`[CollectiveApplyFor]`. It is reported on the method name.

An `async Task<TModel> Apply(...)` that awaits gets both WHIZ100 (for the return type) and WHIZ101 (for the
`await`). The two are reported independently.

## Diagnostic Message

```text
Apply method '{MethodName}' uses 'await' keyword but must be a pure function. Remove all async operations.
```

## Common Causes

1. **Awaiting a lookup** such as a store read, a lens query or a service call, to enrich the model.
2. **Awaiting a delay or other async helper** left over from copying receptor code.

## How to Fix

Remove the `await` and the work behind it. Data the fold needs belongs on the event: resolve it on the command
side, before the event is created, and carry the result in the event payload. Then make the method synchronous so
it returns the model directly.

### Before (causes WHIZ101)

```csharp{title="Apply awaits inside its body (causes WHIZ101)" description="An await inside Apply is reported as WHIZ101, separately from the async return type." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ101"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_ApplyAwaitsInsideBody_ReportsWHIZ101Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_ApplyAwaitsInsideBody_ReportsWHIZ101Async"]}
using System;
using System.Threading.Tasks;
using Whizbang.Core.Perspectives;

public class Order { public Guid Id { get; set; } }
public class OrderUpdated { public Guid OrderId { get; set; } }

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  public async Task<Order> Apply(Order current, OrderUpdated @event) {
    await Task.Delay(1);  // WHIZ101
    return current;
  }
}
```

### After (no diagnostic)

```csharp{title="Synchronous Apply with no await" description="A synchronous Apply that only reads the event and the current model is not reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ101"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_SynchronousApply_DoesNotReportWHIZ101Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_SynchronousApply_DoesNotReportWHIZ101Async"]}
using System;
using Whizbang.Core.Perspectives;

public class Order { public Guid Id { get; set; } public string Status { get; set; } = ""; }
public class OrderUpdated { public Guid OrderId { get; set; } public string NewStatus { get; set; } = ""; }

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  public Order Apply(Order current, OrderUpdated @event) {
    current.Status = @event.NewStatus;
    return current;
  }
}
```

## Related

- [WHIZ100: Apply method must be synchronous](whiz100)
- [WHIZ102: Apply method cannot call database I/O](whiz102)
- [WHIZ103: Apply method cannot call HTTP/network operations](whiz103)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
