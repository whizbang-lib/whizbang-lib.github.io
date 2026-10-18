---
title: 'WHIZ102: Apply method cannot call database I/O'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a perspective Apply method (or a [CollectiveApplyFor] method) calls something the analyzer
  classifies as database I/O. A fold that reads the store cannot be rebuilt faithfully.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - purity
  - apply
  - database
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveDiscoveryHelper.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ102: Apply method cannot call database I/O

**Severity**: Error
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

A perspective that reads the database to compute its next state cannot be rebuilt: during a rebuild the read
returns whatever the database holds now, not what it held when the event happened. The runner already loads the
current model and passes it to `Apply` as the `current` parameter, so `Apply` never needs to read it again.

WHIZ102 is reported for each invocation inside the method that the analyzer classifies as database I/O. It applies
to a method named `Apply` on a perspective class (`IPerspectiveFor`, `IPerspectiveWithActionsFor`,
`IPerspectiveBase`, `IGlobalPerspectiveFor`) and to any method marked `[CollectiveApplyFor]`. Each offending call is
reported at the call site, so a method with two store reads gets two diagnostics.

The classification is a name heuristic on the called method. A call is reported when either:

- the full name of the method's containing type contains `DbContext`, `DbSet`, `IPerspectiveStore` or
  `ILensQuery` (any method on that type), or
- the method name ends with `Async` and contains `Save`, `Insert`, `Update`, `Delete`, `Upsert`, `Query`, `Get` or
  `Find` (on any type).

A synchronous `Save()` or an `...Async` method with none of those words (for example `RenderAsync`) is not
reported. A call through a function pointer is not classified at all.

## Diagnostic Message

```text
Apply method '{MethodName}' calls '{ContainingType}.{CalledMethod}' which performs database I/O. Apply methods must be pure functions.
```

## Common Causes

1. **Reading the current row again** through a perspective store or lens instead of using the `current` parameter.
2. **Looking up related data** (another aggregate, a reference table) to denormalize it into the model.
3. **A false positive from the name rule.** Any `...Async` method whose name contains `Get` or `Find`, on any type,
   matches. For example, `HttpClient.GetStringAsync` matches this rule as well as the HTTP rule of
   [WHIZ103](whiz103).

## How to Fix

- Use the `current` parameter for the model's existing state.
- Put related data on the event when the command side creates it, so `Apply` only reads the event and the model.
- Remove the injected store or lens from the perspective's constructor. A non-`[PureService]` dependency there
  also raises [WHIZ105](whiz105).

### Before (causes WHIZ102)

```csharp{title="Apply reads the perspective store (causes WHIZ102)" description="A call on an IPerspectiveStore inside Apply is classified as database I/O." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ102"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_ApplyCallsPerspectiveStore_ReportsWHIZ102Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_ApplyCallsPerspectiveStore_ReportsWHIZ102Async", "PerspectivePurityAnalyzerTests.Analyzer_WHIZ102_NamesTheOffendingCallAsync"]}
using System;
using System.Threading.Tasks;
using Whizbang.Core.Perspectives;

public interface IPerspectiveStore {
  Task<Order> GetAsync(Guid id);
}

public class Order { public Guid Id { get; set; } public string Status { get; set; } = ""; }
public class OrderUpdated { public Guid OrderId { get; set; } public string NewStatus { get; set; } = ""; }

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  private readonly IPerspectiveStore _store;
  public OrderPerspective(IPerspectiveStore store) { _store = store; }

  public Order Apply(Order current, OrderUpdated @event) {
    var task = _store.GetAsync(@event.OrderId);  // WHIZ102
    current.Status = @event.NewStatus;
    return current;
  }
}
```

### After (no diagnostic)

```csharp{title="Apply folds only the event into the current model" description="Using the current parameter and event data reports no purity diagnostics." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ102"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync"]}
using System;
using Whizbang.Core.Perspectives;

public class Order {
  public Guid Id { get; set; }
  public string Status { get; set; } = "";
  public int Version { get; set; }
}

public class OrderUpdated {
  public Guid OrderId { get; set; }
  public string NewStatus { get; set; } = "";
  public DateTimeOffset OccurredAt { get; set; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  public Order Apply(Order current, OrderUpdated @event) {
    current.Id = @event.OrderId;
    current.Status = @event.NewStatus;
    current.Version++;
    return current;
  }
}
```

## Related

- [WHIZ101: Apply method cannot use async/await](whiz101)
- [WHIZ103: Apply method cannot call HTTP/network operations](whiz103)
- [WHIZ105: Perspective injects non-pure service](whiz105)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
