---
title: 'WHIZ103: Apply method cannot call HTTP/network operations'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic when a perspective Apply method (or a [CollectiveApplyFor] method) calls an HTTP client or an
  HTTP-named wrapper. A fold that depends on a remote answer gives different results on each rebuild.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - purity
  - apply
  - http
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveDiscoveryHelper.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ103: Apply method cannot call HTTP/network operations

**Severity**: Error
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

If `Apply` calls a remote service, the model ends up depending on what that service answered while the fold ran.
Two rebuilds of the same event history can then disagree, and every rebuild sends one request per stored event.

WHIZ103 is reported for each matching invocation inside a method named `Apply` on a perspective class
(`IPerspectiveFor`, `IPerspectiveWithActionsFor`, `IPerspectiveBase`, `IGlobalPerspectiveFor`) or inside any method
marked `[CollectiveApplyFor]`. It is reported at the call site.

A call is classified as HTTP/network I/O when either:

- the full name of the method's containing type contains `HttpClient` or `HttpMessageInvoker` (any method), or
- the containing type's name contains `Http` and the method name starts with `Get`, `Post`, `Put` or `Delete`.

The second rule catches your own wrappers, such as an `IHttpPricingGateway.GetPrice` call. Other verbs on an
`Http` type (for example `PatchOrder`) and the same verbs on a type without `Http` in its name are not reported.

## Diagnostic Message

```text
Apply method '{MethodName}' calls '{ContainingType}.{CalledMethod}' which performs HTTP/network I/O. Apply methods must be pure functions.
```

## Common Causes

1. **Validating or enriching the event against a remote API** inside `Apply`.
2. **An injected gateway or client wrapper** whose type name contains `Http`.

A call such as `HttpClient.GetStringAsync` is also an `...Async` method containing `Get`, so it raises
[WHIZ102](whiz102) at the same call site.

## How to Fix

Make the remote call on the command side, before the event is created, and carry the result on the event. `Apply`
then reads the value from the event. Remove the client from the perspective's constructor as well; an injected
`HttpClient` is not a `[PureService]` and raises [WHIZ105](whiz105).

### Before (causes WHIZ103)

```csharp{title="Apply calls HttpClient (causes WHIZ103)" description="Any call on an HttpClient inside Apply is classified as HTTP/network I/O." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ103"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_ApplyCallsHttpClient_ReportsWHIZ103Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_ApplyCallsHttpClient_ReportsWHIZ103Async"]}
using System;
using System.Net.Http;
using Whizbang.Core.Perspectives;

public class Order { public Guid Id { get; set; } public string Status { get; set; } = ""; }
public class OrderUpdated { public Guid OrderId { get; set; } }

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  private readonly HttpClient _http;
  public OrderPerspective(HttpClient http) { _http = http; }

  public Order Apply(Order current, OrderUpdated @event) {
    var task = _http.GetStringAsync("https://example.invalid/status");  // WHIZ103
    return current;
  }
}
```

The same rule applies to a wrapper whose type name contains `Http`:

```csharp{title="Apply calls an HTTP-named gateway (causes WHIZ103)" description="A Get/Post/Put/Delete method on a type whose name contains Http is classified as network I/O." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ103"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_ApplyCallsAnHttpNamedGateway_ReportsWHIZ103Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_ApplyCallsAnHttpNamedGateway_ReportsWHIZ103Async"]}
using System;
using Whizbang.Core.Perspectives;

public interface IHttpPricingGateway {
  decimal GetPrice(Guid sku);
}

public class Order { public Guid Id { get; set; } public decimal Price { get; set; } }
public class OrderUpdated { public Guid OrderId { get; set; } }

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  private readonly IHttpPricingGateway _gateway;
  public OrderPerspective(IHttpPricingGateway gateway) { _gateway = gateway; }

  public Order Apply(Order current, OrderUpdated @event) {
    current.Price = _gateway.GetPrice(@event.OrderId);  // WHIZ103
    return current;
  }
}
```

### After (no diagnostic)

```csharp{title="Apply reads only the event" description="An Apply that folds event data into the current model reports no purity diagnostics." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ103"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_PureApply_ReportsNoImpurityDiagnosticsAsync"]}
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

- [WHIZ102: Apply method cannot call database I/O](whiz102)
- [WHIZ105: Perspective injects non-pure service](whiz105)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
