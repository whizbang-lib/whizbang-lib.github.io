---
title: 'WHIZ100: Apply method must be synchronous'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a perspective Apply method (or a [CollectiveApplyFor] method) returns Task or ValueTask.
  Apply is replayed during rebuilds and must be a synchronous, pure function.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - purity
  - apply
  - async
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveDiscoveryHelper.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ100: Apply method must be synchronous

**Severity**: Error
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

A perspective's `Apply` method folds one event into the model and returns the new model. The framework calls it
for live events and calls it again for every stored event when a perspective is rebuilt, so it has to be a pure,
synchronous function. WHIZ100 is reported when that method returns a task instead of the model.

The `PerspectivePurityAnalyzer` checks:

- every method named `Apply` declared on a class that implements `IPerspectiveFor<TModel, TEvent...>`,
  `IPerspectiveWithActionsFor<TModel, TEvent...>`, `IPerspectiveBase<TModel, TEvent...>` or
  `IGlobalPerspectiveFor<TModel, TPartitionKey, TEvent...>`, and
- every method marked `[CollectiveApplyFor]`, whatever its name.

The diagnostic fires when the return type is `Task`, `Task<T>`, `ValueTask` or `ValueTask<T>`. It is reported on
the method name. Methods with any other name on a perspective class are not checked.

## Diagnostic Message

```text
Apply method '{MethodName}' returns '{ReturnType}' but must be synchronous for purity. Change the return type to '{ModelType}'.
```

`{ReturnType}` is the method's actual return type, so `Task<Order>`, `ValueTask<Order>`, `Task` and `ValueTask` are
each named as written. `{ModelType}` is the type argument of the returned task. For a non-generic `Task` or
`ValueTask` there is none, and the message uses the placeholder `TModel`.

For example, an Apply method that returns `ValueTask<Order>` reads:

```text
Apply method 'Apply' returns 'ValueTask<Order>' but must be synchronous for purity. Change the return type to 'Order'.
```

## Common Causes

1. **An `async` Apply written to await a lookup.** The method was made `async Task<TModel>` so it could call a
   service. That service call is itself impure (see [WHIZ101](whiz101), [WHIZ102](whiz102), [WHIZ103](whiz103)).
2. **A signature copied from a receptor.** Receptor handlers are asynchronous; perspective `Apply` methods are not.
3. **`Task.FromResult` used to satisfy an imagined async contract.** Even a task that completes immediately is
   reported, because the check is on the return type.

## How to Fix

Return the model directly and remove any asynchronous work from the method. Data the fold needs should already be
on the event or on the current model.

### Before (causes WHIZ100)

```csharp{title="Async Apply method (causes WHIZ100)" description="An Apply method that returns Task<Order> is reported as WHIZ100." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ100"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_AsyncApplyMethod_ReportsWHIZ100ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_AsyncApplyMethod_ReportsWHIZ100ErrorAsync"]}
using System;
using System.Threading.Tasks;
using Whizbang.Core.Perspectives;

public class Order {
  public Guid Id { get; set; }
}

public class OrderUpdated {
  public Guid OrderId { get; set; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  public async Task<Order> Apply(Order current, OrderUpdated @event) {  // WHIZ100 (and WHIZ101 for the await)
    await Task.Delay(1);
    return current;
  }
}
```

### After (no diagnostic)

```csharp{title="Synchronous Apply method" description="A synchronous Apply that folds event data into the model reports no purity diagnostics." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ100"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync"]}
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
- [WHIZ102: Apply method cannot call database I/O](whiz102)
- [WHIZ103: Apply method cannot call HTTP/network operations](whiz103)
- [WHIZ104: Apply method should use event timestamps](whiz104)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
