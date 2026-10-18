---
title: 'WHIZ105: Perspective injects non-pure service'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective's constructor takes a service whose type is not marked [PureService].
  Perspectives are replayed, so anything they depend on must be deterministic and free of side effects.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - purity
  - pure-service
  - dependency-injection
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectivePurityAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveDiscoveryHelper.cs
  - src/Whizbang.Core/Attributes/PureServiceAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerBranchTests.cs
  - tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ105: Perspective injects non-pure service

**Severity**: Warning
**Category**: Perspective Purity (`Whizbang.Purity`)

## Description

Perspectives may be replayed during recovery and rebuilds. A service injected into a perspective can be called
from `Apply`, so it has to give the same answer for the same input and have no side effects. The `[PureService]`
attribute (in `Whizbang.Core.Attributes`) is how you state that a service meets that contract.

WHIZ105 is reported for each constructor parameter of a perspective class (one implementing `IPerspectiveFor`,
`IPerspectiveWithActionsFor`, `IPerspectiveBase` or `IGlobalPerspectiveFor`) whose type is not marked
`[PureService]`. The diagnostic points at the parameter.

A parameter is **not** reported when:

- its type is a value type, an enum, or a built-in type such as `string`;
- its type carries `[PureService]`; or
- its type is a class or interface that implements an interface marked `[PureService]`.

A generic type parameter is reported, because the analyzer cannot see a `[PureService]` attribute on it.
Constructors of classes that are not perspectives are not checked.

## Diagnostic Message

```text
Perspective '{PerspectiveName}' injects '{ServiceType}' which is not marked with [PureService]. Services injected into perspectives must be pure for replay determinism.
```

## Common Causes

1. **An application or domain service** injected so `Apply` can call it.
2. **Infrastructure types** such as an `HttpClient`, a store, or a logger. These are not pure, and calls to some of
   them from `Apply` also raise [WHIZ102](whiz102) or [WHIZ103](whiz103).
3. **A pure helper that has not been marked.** The service really is deterministic but nobody added the attribute.

## How to Fix

- Prefer a perspective with no injected dependencies. `Apply` should need only the event and the current model.
- If the dependency genuinely is pure (a stateless calculation, a read-only lookup over immutable data), mark its
  type, or an interface it implements, with `[PureService]`. The optional `Reason` property records why.

### Before (causes WHIZ105)

```csharp{title="Perspective injects an unmarked service (causes WHIZ105)" description="A constructor parameter whose type is not marked [PureService] is reported as WHIZ105." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ105", "PureService"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_NonPureServiceInjection_ReportsWHIZ105WarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_NonPureServiceInjection_ReportsWHIZ105WarningAsync"]}
using System;
using Whizbang.Core.Perspectives;

// Service without [PureService]
public interface IOrderService {
  void ProcessOrder();
}

public record Order {
  public Guid Id { get; set; }
  public string Status { get; set; }
}

public class OrderUpdated {
  public Guid OrderId { get; set; }
  public string NewStatus { get; set; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  private readonly IOrderService _orderService;

  public OrderPerspective(IOrderService orderService) {  // WHIZ105 on the parameter
    _orderService = orderService;
  }

  public Order Apply(Order current, OrderUpdated @event) {
    return current with { Status = @event.NewStatus };
  }
}
```

### After (no diagnostic)

```csharp{title="Perspective injects a [PureService]" description="A constructor parameter whose type is marked [PureService] is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ105", "PureService"] testFile="PerspectivePurityAnalyzerTests.cs" testMethod="Analyzer_PureServiceInjection_NoWarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectivePurityAnalyzerTests.cs" tests=["PerspectivePurityAnalyzerTests.Analyzer_PureServiceInjection_NoWarningAsync", "PerspectivePurityAnalyzerTests.Analyzer_ClassImplementingPureServiceInterface_NoWarningAsync"]}
using System;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

[PureService]
public interface IExchangeRateService {
  decimal GetRate(string currency, DateTimeOffset date);
}

public record Order {
  public Guid Id { get; set; }
  public decimal Total { get; set; }
}

public class OrderUpdated {
  public Guid OrderId { get; set; }
  public string Currency { get; set; }
  public DateTimeOffset UpdatedAt { get; set; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderUpdated> {
  private readonly IExchangeRateService _exchangeRates;

  public OrderPerspective(IExchangeRateService exchangeRates) {
    _exchangeRates = exchangeRates;
  }

  public Order Apply(Order current, OrderUpdated @event) {
    var rate = _exchangeRates.GetRate(@event.Currency, @event.UpdatedAt);
    return current with { Total = current.Total * rate };
  }
}
```

## Suppressing

Marking the type with `[PureService]` is the preferred way to clear this warning, because it documents the
contract on the service itself. Suppress instead only when you cannot change the service's type (it comes from
another library) and you are certain it is deterministic and free of side effects. Do not suppress for a logger,
a store, or a network client: those are what the warning exists to catch.

For one constructor:

```csharp{title="Suppress WHIZ105 with a pragma" description="Disables WHIZ105 around a perspective constructor." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Purity", "WHIZ105", "Suppression"] unverified="suppression syntax, standard Roslyn behavior not exercised by a WHIZ105 test"}
#pragma warning disable WHIZ105
public OrderPerspective(IThirdPartyCalculator calculator) {
  _calculator = calculator;
}
#pragma warning restore WHIZ105
```

For a whole project, in `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.WHIZ105.severity = none
```

## Related

- [WHIZ102: Apply method cannot call database I/O](whiz102)
- [WHIZ103: Apply method cannot call HTTP/network operations](whiz103)
- [Perspectives: Pure Function Pattern](../../fundamentals/perspectives/perspectives#pure-services)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
